import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listArticles, readArticle, saveArticle } from "../lib/content-store.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

const DMM_ITEMLIST_URL = "https://api.dmm.com/affiliate/v3/ItemList";
const DEFAULT_LIMIT = 500;
const DEFAULT_REQUEST_DELAY_MS = 750;
const MAX_REQUEST_DELAY_MS = 5000;
const REQUEST_TIMEOUT_MS = 30000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const args = parseArgs(process.argv.slice(2));

main().catch((error) => {
  console.error(`[dmm-affiliate] ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  await loadDotEnv(path.join(PROJECT_ROOT, ".env"));

  const apiId = String(args.apiId || process.env.DMM_API_ID || "").trim();
  const affiliateId = String(args.affiliateId || process.env.DMM_AFFILIATE_ID || "").trim();
  const linkAffiliateId = String(
    args.linkAffiliateId ||
      process.env.DMM_LINK_AFFILIATE_ID ||
      process.env.DMM_SITE_AFFILIATE_ID ||
      process.env.DMM_WEB_AFFILIATE_ID ||
      affiliateId
  ).trim();
  const dryRun = Boolean(args.dryRun);
  const force = Boolean(args.force);
  const limit = positiveInteger(args.limit, DEFAULT_LIMIT);
  const delayMs = boundedNonNegativeInteger(
    args.delayMs,
    DEFAULT_REQUEST_DELAY_MS,
    MAX_REQUEST_DELAY_MS
  );

  if (!apiId) {
    throw new Error("DMM_API_ID is missing. Set it in .env or pass --api-id.");
  }
  if (!affiliateId) {
    throw new Error("DMM_AFFILIATE_ID is missing. Set it in .env or pass --affiliate-id.");
  }
  if (!isApiAffiliateId(affiliateId)) {
    throw new Error("DMM_AFFILIATE_ID must end with -990 through -999 for DMM Web Service API.");
  }

  const articles = await listArticles();
  const candidates = articles
    .filter((article) => collectProductIds(article).length)
    .filter((article) => force || !isDmmAffiliateLink(article.affiliate_url))
    .slice(0, limit);

  const summary = {
    dryRun,
    force,
    limit,
    seen: candidates.length,
    updated: 0,
    skipped: 0,
    failed: 0,
    apiRequests: 0,
  };

  console.log(
    `[dmm-affiliate] start seen=${summary.seen} limit=${limit} delay-ms=${delayMs}${
      dryRun ? " dry-run" : ""
    }${force ? " force" : ""}`
  );

  let processed = 0;
  for (const metadata of candidates) {
    processed += 1;
    const productIds = collectProductIds(metadata);
    const label = `${processed}/${candidates.length} ${metadata.slug}`;

    try {
      if (!productIds.length) {
        summary.skipped += 1;
        console.log(`[dmm-affiliate] skip ${label} (product-id-not-found)`);
        continue;
      }

      await waitBeforeRequest(summary.apiRequests, delayMs);
      const lookup = await lookupDmmAffiliateItem({
        apiId,
        affiliateId,
        productIds,
        sourceUrl: metadata.source_url || metadata.affiliate_url || "",
      });
      summary.apiRequests += lookup.requests;

      if (!lookup.item) {
        const fallbackUrl = buildDmmAffiliateUrl(metadata.source_url || metadata.affiliate_url, linkAffiliateId);
        if (!fallbackUrl) {
          summary.failed += 1;
          console.error(
            `[dmm-affiliate] failed ${label} (${productIds.join(", ")}): ${
              lookup.errors[0] || "affiliateURL not found"
            }`
          );
          continue;
        }

        if (dryRun) {
          summary.updated += 1;
          console.log(`[dmm-affiliate] update-fallback(dry-run) ${label} -> ${fallbackUrl}`);
          continue;
        }

        const article = await readArticle(metadata.slug);
        await saveArticle({
          ...article.metadata,
          old_slug: article.metadata.slug,
          source_url: article.metadata.source_url || metadata.source_url || "",
          affiliate_url: fallbackUrl,
          body: article.body,
        });

        summary.updated += 1;
        console.log(`[dmm-affiliate] updated-fallback ${label}`);
        continue;
      }

      const affiliateUrl = normalizeDmmAffiliateUrlForLink(
        String(lookup.item.affiliateURL || lookup.item.affiliateURLsp || "").trim(),
        lookup.item.URL || metadata.source_url || metadata.affiliate_url,
        linkAffiliateId
      );
      const sourceUrl = String(metadata.source_url || lookup.item.URL || "").trim();
      if (!affiliateUrl) {
        summary.failed += 1;
        console.error(`[dmm-affiliate] failed ${label}: affiliateURL is empty`);
        continue;
      }

      if (!force && metadata.affiliate_url === affiliateUrl) {
        summary.skipped += 1;
        console.log(`[dmm-affiliate] skip ${label} (already-current)`);
        continue;
      }

      if (dryRun) {
        summary.updated += 1;
        console.log(`[dmm-affiliate] update(dry-run) ${label} -> ${affiliateUrl}`);
        continue;
      }

      const article = await readArticle(metadata.slug);
      await saveArticle({
        ...article.metadata,
        old_slug: article.metadata.slug,
        source_url: sourceUrl,
        affiliate_url: affiliateUrl,
        body: article.body,
      });

      summary.updated += 1;
      console.log(`[dmm-affiliate] updated ${label}`);
    } catch (error) {
      summary.failed += 1;
      console.error(`[dmm-affiliate] failed ${label}: ${error.message}`);
    }
  }

  console.log(
    `[dmm-affiliate] done seen=${summary.seen} updated=${summary.updated} skipped=${summary.skipped} failed=${summary.failed} api_requests=${summary.apiRequests}`
  );

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

async function lookupDmmAffiliateItem(options) {
  const errors = [];
  let requests = 0;

  for (const productId of options.productIds) {
    for (const config of lookupConfigs(productId)) {
      try {
        requests += 1;
        const payload = await fetchDmmItemList({
          apiId: options.apiId,
          affiliateId: options.affiliateId,
          productId,
          ...config,
        });
        const item = selectDmmItem(payload, productId, options.sourceUrl);
        if (item?.affiliateURL || item?.affiliateURLsp) {
          return { item, productId, config, requests, errors };
        }
      } catch (error) {
        errors.push(`${config.site}/${config.service || "*"}/${config.floor || "*"}: ${error.message}`);
      }
    }
  }

  return { item: null, productId: "", config: null, requests, errors };
}

async function fetchDmmItemList(options) {
  const search = new URLSearchParams({
    api_id: options.apiId,
    affiliate_id: options.affiliateId,
    site: options.site,
    cid: options.productId,
    hits: "1",
    output: "json",
  });
  if (options.service) search.set("service", options.service);
  if (options.floor) search.set("floor", options.floor);

  const response = await fetch(`${DMM_ITEMLIST_URL}?${search.toString()}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`request failed ${response.status} ${response.statusText}: ${text.slice(0, 160)}`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`invalid JSON response: ${text.slice(0, 160)}`);
  }

  const items = dmmItems(payload);
  const status = Number(payload?.result?.status || 0);
  if (status && status !== 200 && !items.length) {
    throw new Error(`API status ${status}`);
  }
  return payload;
}

function selectDmmItem(payload, productId, sourceUrl) {
  const items = dmmItems(payload);
  if (!items.length) return null;

  const productKey = normalizeKey(productId);
  return (
    items.find((item) => {
      const ids = [item.content_id, item.product_id, extractProductId(item.URL), extractProductId(item.affiliateURL)];
      return ids.some((id) => normalizeKey(id) === productKey);
    }) ||
    items.find((item) => sourceUrl && normalizeUrlKey(item.URL) === normalizeUrlKey(sourceUrl)) ||
    items[0]
  );
}

function dmmItems(payload) {
  const items = payload?.result?.items;
  return Array.isArray(items) ? items : [];
}

function lookupConfigs(productId) {
  const fanzaDoujin = { site: "FANZA", service: "doujin", floor: "digital_doujin" };
  const fanzaDoujinBl = { site: "FANZA", service: "doujin", floor: "digital_doujin_bl" };
  const fanzaDoujinTl = { site: "FANZA", service: "doujin", floor: "digital_doujin_tl" };
  const fanzaEbookComic = { site: "FANZA", service: "ebook", floor: "comic" };
  const fanzaAny = { site: "FANZA" };
  const dmmComic = { site: "DMM.com", service: "ebook", floor: "comic" };
  const dmmAny = { site: "DMM.com" };

  if (/^d_\d+$/iu.test(productId)) {
    return [fanzaDoujin, fanzaDoujinBl, fanzaDoujinTl, fanzaEbookComic, fanzaAny, dmmComic, dmmAny];
  }
  if (/^b[0-9a-z]+$/iu.test(productId)) return [fanzaEbookComic, dmmComic, dmmAny, fanzaAny];
  return [fanzaDoujin, fanzaDoujinBl, fanzaDoujinTl, fanzaEbookComic, fanzaAny, dmmComic, dmmAny];
}

function collectProductIds(metadata) {
  return unique([
    metadata.product_id,
    extractProductId(metadata.source_url),
    extractProductId(metadata.affiliate_url),
    extractProductId(metadata.thumbnail_url),
    ...(metadata.sample_images || []).map((url) => extractProductId(url)),
  ]);
}

function extractProductId(value) {
  const decoded = decodeEntities(String(value || ""));
  try {
    const url = new URL(decoded);
    const nestedUrl = url.searchParams.get("lurl") || "";
    if (nestedUrl && nestedUrl !== decoded) {
      const nestedId = extractProductId(nestedUrl);
      if (nestedId) return nestedId;
    }
  } catch {
    // Continue with pattern extraction.
  }

  const patterns = [
    /[?&]cid=([^/?&#]+)/iu,
    /[?&]product_id=([^/?&#]+)/iu,
    /\/product\/\d+\/([^/?&#]+)/iu,
    /\/digital\/comic\/([^/?&#]+)/iu,
    /\/(d_\d+)(?:[/?#._-]|$)/iu,
    /\b(d_\d+)(?=pr\.|pl\.)/iu,
  ];

  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match?.[1]) return match[1];
  }

  return "";
}

function isDmmAffiliateLink(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      (hostname === "al.fanza.co.jp" || hostname === "al.dmm.co.jp") &&
      Boolean(url.searchParams.get("af_id"))
    );
  } catch {
    return false;
  }
}

function normalizeDmmAffiliateUrlForLink(value, sourceUrl, affiliateId) {
  const linkId = String(affiliateId || "").trim();
  const current = String(value || "").trim();
  if (!linkId) return current || "";

  try {
    const url = new URL(current);
    const hostname = url.hostname.toLowerCase();
    if (hostname === "al.fanza.co.jp" || hostname === "al.dmm.co.jp") {
      url.searchParams.set("af_id", linkId);
      if (!url.searchParams.get("ch")) url.searchParams.set("ch", "api");
      return url.href;
    }
  } catch {
    // Build a fresh affiliate URL below.
  }

  return buildDmmAffiliateUrl(sourceUrl || current, linkId);
}

function buildDmmAffiliateUrl(value, affiliateId) {
  try {
    const landingUrl = new URL(value);
    landingUrl.hash = "";
    const hostname = landingUrl.hostname.toLowerCase();
    const path = landingUrl.pathname.toLowerCase();
    const affiliateHost =
      hostname.includes("fanza") ||
      path.includes("/dc/doujin") ||
      hostname === "video.dmm.co.jp" ||
      path.includes("/digital/video")
        ? "al.fanza.co.jp"
        : "al.dmm.co.jp";
    const url = new URL(`https://${affiliateHost}/`);
    url.searchParams.set("lurl", landingUrl.href);
    url.searchParams.set("af_id", affiliateId);
    url.searchParams.set("ch", "api");
    return url.href;
  } catch {
    return "";
  }
}

function isApiAffiliateId(value) {
  return /-\d{3}$/u.test(value) && Number(value.slice(-3)) >= 990 && Number(value.slice(-3)) <= 999;
}

function normalizeUrlKey(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return String(value || "").trim();
  }
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function decodeEntities(value) {
  const entities = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
  };

  return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/giu, (raw, entity) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return entities[lower] ?? raw;
  });
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (value === "--force") {
      parsed.force = true;
      continue;
    }
    if (value === "--api-id") {
      parsed.apiId = values[index + 1] || "";
      index += 1;
      continue;
    }
    if (value === "--affiliate-id") {
      parsed.affiliateId = values[index + 1] || "";
      index += 1;
      continue;
    }
    if (value === "--link-affiliate-id") {
      parsed.linkAffiliateId = values[index + 1] || "";
      index += 1;
      continue;
    }
    if (value === "--limit") {
      parsed.limit = values[index + 1] || "";
      index += 1;
      continue;
    }
    if (value === "--delay-ms" || value === "--delay_ms") {
      parsed.delayMs = values[index + 1] || "";
      index += 1;
    }
  }
  return parsed;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function boundedNonNegativeInteger(value, fallback, max) {
  const fallbackNumber = Number(fallback);
  const number = Number(value);
  const resolved = Number.isInteger(number) && number >= 0 ? number : fallbackNumber;
  const safeValue = Number.isInteger(resolved) && resolved >= 0 ? resolved : 0;
  return Math.min(safeValue, max);
}

async function waitBeforeRequest(previousRequests, delayMs) {
  if (previousRequests <= 0 || delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function loadDotEnv(filePath) {
  let text = "";
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
    if (!match) continue;
    if (process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].trim().replace(/^["']|["']$/gu, "");
  }
}
