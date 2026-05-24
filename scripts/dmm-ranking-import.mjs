import { listArticles, saveArticle, slugify } from "../lib/content-store.mjs";

const DEFAULT_RANKING_URL =
  "https://www.dmm.co.jp/dc/doujin/-/ranking-all/=/submedia=comic/sort=popular/term=h24/";
const DEFAULT_LIMIT = 10;
const REQUEST_TIMEOUT_MS = 30000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const args = parseArgs(process.argv.slice(2));

main().catch((error) => {
  console.error(`[dmm-ranking] ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const rankingUrl = args.url || DEFAULT_RANKING_URL;
  const limit = positiveInteger(args.limit, DEFAULT_LIMIT);
  const dryRun = Boolean(args.dryRun);
  const now = new Date().toISOString();

  console.log(`[dmm-ranking] start ${now}`);
  console.log(`[dmm-ranking] url ${rankingUrl}`);
  console.log(`[dmm-ranking] limit ${limit}${dryRun ? " dry-run" : ""}`);

  const existing = await buildExistingIndex();
  const rankingResponse = await fetchHtml(rankingUrl);
  assertNotAgeCheck(rankingResponse.html, rankingResponse.url);

  const rankingItems = parseRankingItems(rankingResponse.html, rankingResponse.url).slice(0, limit);
  if (!rankingItems.length) {
    throw new Error("ranking items were not found. DMM markup may have changed.");
  }

  const summary = {
    seen: rankingItems.length,
    created: 0,
    skipped: 0,
    failed: 0,
  };

  for (const item of rankingItems) {
    const earlyDuplicate = findDuplicate(existing, {
      title: item.title,
      circleName: item.circleName,
      slug: slugify(item.title),
      urls: [item.url],
      productId: extractProductId(item.url),
    });

    if (earlyDuplicate) {
      summary.skipped += 1;
      console.log(
        `[dmm-ranking] skip #${item.rank} ${item.title} (${earlyDuplicate.reason}: ${earlyDuplicate.value})`
      );
      continue;
    }

    try {
      const detailResponse = await fetchHtml(item.url, { referer: rankingResponse.url });
      assertNotAgeCheck(detailResponse.html, detailResponse.url);
      const detail = parseProductDetail(detailResponse.html, detailResponse.url, item.title);
      const slug = slugify(item.title);
      const productId =
        extractProductId(detail.url) ||
        extractProductId(detail.thumbnailUrl) ||
        extractProductId(item.url);

      const duplicate = findDuplicate(existing, {
        title: item.title,
        circleName: item.circleName,
        slug,
        urls: [item.url, detail.url],
        productId,
      });

      if (duplicate) {
        summary.skipped += 1;
        console.log(
          `[dmm-ranking] skip #${item.rank} ${item.title} (${duplicate.reason}: ${duplicate.value})`
        );
        continue;
      }

      const articleInput = {
        title: item.title,
        slug,
        status: "published",
        article_type: "review",
        source_type: "dmm_ranking_h24",
        published_at: now,
        excerpt: "",
        seo_title: "",
        product_title: item.title,
        circle_name: item.circleName,
        author_name: "",
        source_url: detail.url,
        affiliate_url: detail.url,
        thumbnail_url: detail.thumbnailUrl,
        genres: detail.genres,
        emotions: [],
        rights_status: "pending_review",
        pr_label: "PR",
        automation_ready: true,
        body: "",
      };

      if (dryRun) {
        summary.created += 1;
        console.log(
          `[dmm-ranking] create(dry-run) #${item.rank} ${item.title} -> ${slug}`
        );
      } else {
        const saved = await saveArticle(articleInput);
        addArticleToIndex(existing, saved.metadata);
        summary.created += 1;
        console.log(`[dmm-ranking] created #${item.rank} ${item.title} -> ${saved.file_path}`);
      }
    } catch (error) {
      summary.failed += 1;
      console.error(`[dmm-ranking] failed #${item.rank} ${item.title}: ${error.message}`);
    }
  }

  console.log(
    `[dmm-ranking] done seen=${summary.seen} created=${summary.created} skipped=${summary.skipped} failed=${summary.failed}`
  );

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (value === "--url") {
      parsed.url = values[index + 1] || "";
      index += 1;
      continue;
    }
    if (value === "--limit") {
      parsed.limit = values[index + 1] || "";
      index += 1;
      continue;
    }
  }
  return parsed;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

async function buildExistingIndex() {
  const index = {
    slugs: new Map(),
    productIds: new Map(),
    urls: new Map(),
    titleCircles: new Map(),
    titles: new Map(),
  };

  for (const article of await listArticles()) {
    addArticleToIndex(index, article);
  }

  return index;
}

function addArticleToIndex(index, article) {
  const label = article.slug || article.title || "(unknown)";
  if (article.slug) index.slugs.set(normalizeKey(article.slug), label);

  const title = article.product_title || article.title || "";
  const circle = article.circle_name || "";
  if (title) {
    index.titles.set(normalizeKey(title), label);
    if (circle) index.titleCircles.set(`${normalizeKey(title)}|${normalizeKey(circle)}`, label);
  }

  for (const url of [article.source_url, article.affiliate_url, article.thumbnail_url]) {
    if (!url) continue;
    index.urls.set(normalizeUrlKey(url), label);
    const productId = extractProductId(url);
    if (productId) index.productIds.set(normalizeKey(productId), label);
  }
}

function findDuplicate(index, candidate) {
  const slugKey = normalizeKey(candidate.slug);
  if (slugKey && index.slugs.has(slugKey)) {
    return { reason: "slug", value: index.slugs.get(slugKey) };
  }

  if (candidate.productId) {
    const productIdKey = normalizeKey(candidate.productId);
    if (index.productIds.has(productIdKey)) {
      return { reason: "product-id", value: index.productIds.get(productIdKey) };
    }
  }

  for (const url of candidate.urls || []) {
    const urlKey = normalizeUrlKey(url);
    if (urlKey && index.urls.has(urlKey)) {
      return { reason: "url", value: index.urls.get(urlKey) };
    }
  }

  const titleKey = normalizeKey(candidate.title);
  const circleKey = normalizeKey(candidate.circleName);
  if (titleKey && circleKey) {
    const titleCircleKey = `${titleKey}|${circleKey}`;
    if (index.titleCircles.has(titleCircleKey)) {
      return { reason: "title-circle", value: index.titleCircles.get(titleCircleKey) };
    }
  }

  if (titleKey && index.titles.has(titleKey)) {
    return { reason: "title", value: index.titles.get(titleKey) };
  }

  return null;
}

async function fetchHtml(url, options = {}) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.7,en;q=0.5",
      Cookie: "age_check_done=1; ckcy=1;",
      Referer: options.referer || DEFAULT_RANKING_URL,
    },
  });

  if (!response.ok) {
    throw new Error(`request failed ${response.status} ${response.statusText}: ${url}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    url: response.url,
    html: decodeHtml(buffer, contentType),
  };
}

function decodeHtml(buffer, contentType) {
  const asciiHead = buffer.subarray(0, 4096).toString("latin1");
  const labels = [
    contentType.match(/charset=([^;\s]+)/iu)?.[1],
    asciiHead.match(/<meta[^>]+charset=["']?([^"'\s/>]+)/iu)?.[1],
    "utf-8",
    "euc-jp",
    "shift_jis",
  ].filter(Boolean);

  for (const label of labels) {
    try {
      return new TextDecoder(label).decode(buffer);
    } catch {
      // Try the next encoding label.
    }
  }

  return buffer.toString("utf8");
}

function assertNotAgeCheck(html, url) {
  if (
    /age_check|18歳未満|18\s*years\s*old|Are you at least 18/i.test(html) &&
    !/\brank-name\b|\bc_icon_detailGenreTag\b/i.test(html)
  ) {
    throw new Error(`DMM age check page was returned: ${url}`);
  }
}

function parseRankingItems(html, baseUrl) {
  const items = [];
  const rankNameRe =
    /<b\b[^>]*class\s*=\s*["'][^"']*\brank-name\b[^"']*["'][^>]*>([\s\S]*?)<\/b>/giu;

  for (const match of html.matchAll(rankNameRe)) {
    const anchor = extractAnchor(match[1]);
    if (!anchor?.href) continue;

    const title = textContent(anchor.html);
    if (!title) continue;

    const after = html.slice(match.index + match[0].length, match.index + match[0].length + 3000);
    const circleBlock = after.match(
      /<p\b[^>]*class\s*=\s*["'][^"']*\brank-circle\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/iu
    )?.[1];
    const circleName = circleBlock ? textContent(extractAnchor(circleBlock)?.html || circleBlock) : "";

    items.push({
      rank: items.length + 1,
      title,
      url: absoluteUrl(anchor.href, baseUrl),
      circleName,
    });
  }

  return items;
}

function parseProductDetail(html, url, fallbackTitle) {
  const genres = unique(
    [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)]
      .filter((match) => /\bclass\s*=\s*["'][^"']*\bc_icon_detailGenreTag\b[^"']*["']/iu.test(match[1]))
      .map((match) => textContent(match[2]))
      .filter(Boolean)
  );

  return {
    url,
    genres,
    thumbnailUrl: extractThumbnailUrl(html, url, fallbackTitle),
  };
}

function extractThumbnailUrl(html, baseUrl, title) {
  const imageCandidates = [];
  for (const match of html.matchAll(/<img\b([^>]*?)>/giu)) {
    const attrs = match[1];
    const src = getAttr(attrs, "src") || getAttr(attrs, "data-src") || "";
    if (!src) continue;

    const decodedSrc = decodeEntities(src);
    if (!/doujin-assets\.dmm\.co\.jp\/digital\/comic\//iu.test(decodedSrc)) continue;
    if (!/pr\.(?:jpe?g|png|webp)(?:[?#].*)?$/iu.test(decodedSrc)) continue;

    imageCandidates.push({
      src: absoluteUrl(decodedSrc, baseUrl),
      alt: textContent(getAttr(attrs, "alt") || ""),
    });
  }

  const titleKey = normalizeKey(title);
  const exact = imageCandidates.find((candidate) => normalizeKey(candidate.alt) === titleKey);
  if (exact) return exact.src;
  if (imageCandidates[0]) return imageCandidates[0].src;

  for (const match of html.matchAll(/<meta\b([^>]*?)>/giu)) {
    const attrs = match[1];
    const property = getAttr(attrs, "property") || getAttr(attrs, "name") || "";
    if (!/^og:image$/iu.test(property)) continue;
    const content = getAttr(attrs, "content") || "";
    if (content) return absoluteUrl(decodeEntities(content), baseUrl);
  }

  return "";
}

function extractAnchor(html) {
  const match = String(html || "").match(/<a\b([^>]*)>([\s\S]*?)<\/a>/iu);
  if (!match) return null;
  return {
    href: decodeEntities(getAttr(match[1], "href") || ""),
    html: match[2],
  };
}

function getAttr(attrs, name) {
  const match = String(attrs || "").match(
    new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "iu")
  );
  return match ? match[2] : "";
}

function textContent(value) {
  return decodeEntities(String(value || "").replace(/<[^>]+>/gu, " "))
    .replace(/[\s\u00a0]+/gu, " ")
    .trim();
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

function absoluteUrl(value, baseUrl) {
  try {
    return new URL(decodeEntities(value), baseUrl).href;
  } catch {
    return decodeEntities(value);
  }
}

function extractProductId(value) {
  const decoded = decodeEntities(String(value || ""));
  const patterns = [
    /[?&]cid=([^/?&#]+)/iu,
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

function normalizeUrlKey(value) {
  try {
    const url = new URL(decodeEntities(value));
    url.hash = "";
    return url.href.replace(/\/$/u, "").toLowerCase();
  } catch {
    return normalizeKey(value);
  }
}

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s\u00a0]+/gu, " ");
}

function unique(values) {
  return [...new Set(values)];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
