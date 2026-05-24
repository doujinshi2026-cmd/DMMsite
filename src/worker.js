const DEFAULT_RANKING_URL =
  "https://www.dmm.co.jp/dc/doujin/-/ranking-all/=/submedia=comic/sort=popular/term=h24/";
const DEFAULT_RANKING_LIMIT = 10;
const REQUEST_TIMEOUT_MS = 30000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const STATUS_VALUES = new Set(["draft", "ready", "published", "archived"]);
const TYPE_VALUES = new Set(["review", "column", "news", "list"]);
const RIGHTS_VALUES = new Set(["pending_review", "approved_ad_material", "link_only"]);

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (error) {
      console.error(JSON.stringify({ level: "error", message: error.message, stack: error.stack }));
      return sendJson({ error: error.message || "Internal server error" }, 500);
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      importDmmRanking(env, {
        scheduledTime: controller.scheduledTime,
        cron: controller.cron,
      })
    );
  },
};

async function route(request, env) {
  assertEnv(env);

  const url = new URL(request.url);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/") {
    return Response.redirect(`${url.origin}/site`, 302);
  }

  if (pathname === "/admin" || pathname === "/admin/") {
    const unauthorized = await requireAdmin(request, env);
    if (unauthorized) return unauthorized;
    return assetResponse(env, request, "/index.html");
  }

  if (pathname === "/admin.css") {
    return assetResponse(env, request, pathname);
  }

  if (pathname === "/admin.js") {
    const unauthorized = await requireAdmin(request, env);
    if (unauthorized) return unauthorized;
    return assetResponse(env, request, pathname);
  }

  if (request.method === "GET" && pathname === "/robots.txt") {
    return sendText("User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /preview/\n");
  }

  if (request.method === "GET" && pathname === "/site") {
    const allArticles = (await listArticles(env)).filter((article) => article.status !== "archived");
    const filters = {
      q: String(url.searchParams.get("q") || "").trim(),
      circle: String(url.searchParams.get("circle") || "").trim(),
      author: String(url.searchParams.get("author") || "").trim(),
      genres: normalizeFilterValues(url.searchParams.getAll("genre")),
    };
    const articles = allArticles.filter((article) => articleMatchesFilters(article, filters));
    return sendHtml(renderSiteIndex(articles, { allArticles, filters }));
  }

  if (request.method === "GET" && pathname.startsWith("/site/posts/")) {
    const slug = pathname.slice("/site/posts/".length);
    const article = await readArticle(env, slug);
    if (!article) return sendText("Not found", 404);
    if (article.metadata.status === "archived") return sendText("Not found", 404);
    return sendHtml(renderArticlePage(article));
  }

  if (request.method === "GET" && pathname.startsWith("/preview/")) {
    const unauthorized = await requireAdmin(request, env);
    if (unauthorized) return unauthorized;
    const slug = pathname.slice("/preview/".length);
    const article = await readArticle(env, slug);
    if (!article) return sendText("Not found", 404);
    return sendHtml(renderArticlePage(article, { preview: true }));
  }

  if (pathname.startsWith("/api/")) {
    const unauthorized = await requireAdmin(request, env);
    if (unauthorized) return unauthorized;
    return routeApi(request, env, pathname, url);
  }

  return env.ASSETS.fetch(request);
}

async function routeApi(request, env, pathname, url) {
  if (request.method === "GET" && pathname === "/api/articles") {
    return sendJson({ articles: await listArticles(env) });
  }

  if (request.method === "GET" && pathname.startsWith("/api/articles/")) {
    const slug = pathname.slice("/api/articles/".length);
    const article = await readArticle(env, slug);
    if (!article) return sendJson({ error: "Not found" }, 404);
    return sendJson(article);
  }

  if (request.method === "POST" && pathname === "/api/articles") {
    const saved = await saveArticle(env, await request.json());
    return sendJson(saved);
  }

  if (request.method === "GET" && pathname === "/api/media") {
    return sendJson({ media: [] });
  }

  if (request.method === "POST" && pathname === "/api/media") {
    return sendJson(
      { error: "Cloudflare media uploads are not configured yet. Use thumbnail_url directly." },
      501
    );
  }

  if ((request.method === "GET" || request.method === "POST") && pathname === "/api/dmm/import") {
    const dryRun = url.searchParams.get("dryRun") === "1" || url.searchParams.get("dry_run") === "1";
    const limit = positiveInteger(url.searchParams.get("limit"), env.DMM_RANKING_LIMIT);
    const result = await importDmmRanking(env, { dryRun, limit, manual: true });
    return sendJson(result);
  }

  return sendJson({ error: "Not found" }, 404);
}

function assertEnv(env) {
  if (!env.DB) {
    throw new Error("D1 binding DB is not configured.");
  }
}

async function requireAdmin(request, env) {
  if (await isAuthorized(request, env)) return null;
  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "WWW-Authenticate": 'Basic realm="Blog CMS", charset="UTF-8"',
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

async function isAuthorized(request, env) {
  const expectedPassword = String(env.BLOG_CMS_PASSWORD || "");
  if (!expectedPassword) return false;

  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Basic ")) return false;

  try {
    const decoded = atob(header.slice("Basic ".length));
    const separator = decoded.indexOf(":");
    if (separator === -1) return false;
    const user = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    const expectedUser = String(env.BLOG_CMS_USER || "admin");
    return (await safeEqual(user, expectedUser)) && (await safeEqual(password, expectedPassword));
  } catch {
    return false;
  }
}

async function safeEqual(left, right) {
  const encoder = new TextEncoder();
  const leftHash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(String(left))));
  const rightHash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(String(right))));
  let diff = leftHash.length ^ rightHash.length;
  for (let index = 0; index < leftHash.length && index < rightHash.length; index += 1) {
    diff |= leftHash[index] ^ rightHash[index];
  }
  return diff === 0;
}

async function assetResponse(env, request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return env.ASSETS.fetch(new Request(url, request));
}

async function listArticles(env) {
  const { results } = await env.DB.prepare("SELECT * FROM articles ORDER BY updated_at DESC").all();
  return (results || []).map(rowToMetadata);
}

async function readArticle(env, slug) {
  const row = await env.DB.prepare("SELECT * FROM articles WHERE slug = ?").bind(slug).first();
  if (!row) return null;
  return {
    metadata: rowToMetadata(row),
    body: row.body || "",
    file_path: `d1:articles/${row.slug}`,
  };
}

async function saveArticle(env, input) {
  const oldSlug = input.old_slug ? slugify(input.old_slug) : "";
  const existing = oldSlug ? (await readArticle(env, oldSlug))?.metadata || {} : {};
  const metadata = normalizeArticle(input, existing);
  const productId =
    input.product_id ||
    extractProductId(metadata.source_url) ||
    extractProductId(metadata.affiliate_url) ||
    extractProductId(metadata.thumbnail_url) ||
    null;

  if (!oldSlug) {
    const duplicate = await findDuplicateArticle(env, {
      slug: metadata.slug,
      productId,
      urls: [metadata.source_url, metadata.affiliate_url],
      title: metadata.title,
      circleName: metadata.circle_name,
    });
    if (duplicate) throw new Error(`article already exists: ${duplicate.slug}`);
    await insertArticle(env, metadata, input.body || "", productId);
    return { metadata: { ...metadata, product_id: productId }, body: input.body || "", file_path: `d1:articles/${metadata.slug}` };
  }

  if (oldSlug !== metadata.slug) {
    const target = await env.DB.prepare("SELECT slug FROM articles WHERE slug = ?").bind(metadata.slug).first();
    if (target) throw new Error(`article already exists: ${metadata.slug}`);
  }

  const updated = await updateArticle(env, oldSlug, metadata, input.body || "", productId);
  if (!updated) {
    await insertArticle(env, metadata, input.body || "", productId);
  }

  return { metadata: { ...metadata, product_id: productId }, body: input.body || "", file_path: `d1:articles/${metadata.slug}` };
}

async function insertArticle(env, metadata, body, productId) {
  const now = metadata.updated_at || new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO articles (
      schema_version, title, slug, status, article_type, source_type, published_at, updated_at,
      excerpt, seo_title, product_title, circle_name, author_name, source_url, affiliate_url,
      thumbnail_url, genres_json, emotions_json, rights_status, pr_label, automation_ready,
      body, product_id, created_at, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      metadata.schema_version,
      metadata.title,
      metadata.slug,
      metadata.status,
      metadata.article_type,
      metadata.source_type,
      metadata.published_at,
      metadata.updated_at,
      metadata.excerpt,
      metadata.seo_title,
      metadata.product_title,
      metadata.circle_name,
      metadata.author_name,
      metadata.source_url,
      metadata.affiliate_url,
      metadata.thumbnail_url,
      JSON.stringify(metadata.genres || []),
      JSON.stringify(metadata.emotions || []),
      metadata.rights_status,
      metadata.pr_label,
      metadata.automation_ready ? 1 : 0,
      normalizeBody(body),
      productId,
      now,
      metadata.source_type === "dmm_ranking_h24" ? now : null
    )
    .run();
}

async function updateArticle(env, oldSlug, metadata, body, productId) {
  const result = await env.DB.prepare(
    `UPDATE articles SET
      schema_version = ?, title = ?, slug = ?, status = ?, article_type = ?, source_type = ?,
      published_at = ?, updated_at = ?, excerpt = ?, seo_title = ?, product_title = ?,
      circle_name = ?, author_name = ?, source_url = ?, affiliate_url = ?, thumbnail_url = ?,
      genres_json = ?, emotions_json = ?, rights_status = ?, pr_label = ?, automation_ready = ?,
      body = ?, product_id = COALESCE(?, product_id), imported_at = COALESCE(imported_at, ?)
    WHERE slug = ?`
  )
    .bind(
      metadata.schema_version,
      metadata.title,
      metadata.slug,
      metadata.status,
      metadata.article_type,
      metadata.source_type,
      metadata.published_at,
      metadata.updated_at,
      metadata.excerpt,
      metadata.seo_title,
      metadata.product_title,
      metadata.circle_name,
      metadata.author_name,
      metadata.source_url,
      metadata.affiliate_url,
      metadata.thumbnail_url,
      JSON.stringify(metadata.genres || []),
      JSON.stringify(metadata.emotions || []),
      metadata.rights_status,
      metadata.pr_label,
      metadata.automation_ready ? 1 : 0,
      normalizeBody(body),
      productId,
      metadata.source_type === "dmm_ranking_h24" ? metadata.updated_at : null,
      oldSlug
    )
    .run();
  return Boolean(result?.meta?.changes);
}

function normalizeArticle(input, existing = {}) {
  const now = new Date().toISOString();
  const title = String(input.title || "").trim() || "Untitled";
  const slug = slugify(input.slug || title);
  const status = STATUS_VALUES.has(input.status) ? input.status : "draft";
  const articleType = TYPE_VALUES.has(input.article_type) ? input.article_type : "review";
  const rightsStatus = RIGHTS_VALUES.has(input.rights_status)
    ? input.rights_status
    : "pending_review";
  const publishedAt =
    input.published_at || (status === "published" ? existing.published_at || now : "");

  return {
    schema_version: 1,
    title,
    slug,
    status,
    article_type: articleType,
    source_type: input.source_type || existing.source_type || "manual",
    published_at: publishedAt,
    updated_at: now,
    excerpt: String(input.excerpt || "").trim(),
    seo_title: String(input.seo_title || "").trim(),
    product_title: String(input.product_title || "").trim(),
    circle_name: String(input.circle_name || "").trim(),
    author_name: String(input.author_name || "").trim(),
    source_url: String(input.source_url || "").trim(),
    affiliate_url: String(input.affiliate_url || "").trim(),
    thumbnail_url: String(input.thumbnail_url || "").trim(),
    genres: normalizeList(input.genres),
    emotions: normalizeList(input.emotions),
    rights_status: rightsStatus,
    pr_label: String(input.pr_label || "PR").trim(),
    automation_ready: Boolean(input.automation_ready),
  };
}

function rowToMetadata(row) {
  return {
    schema_version: row.schema_version || 1,
    title: row.title || "",
    slug: row.slug || "",
    status: row.status || "draft",
    article_type: row.article_type || "review",
    source_type: row.source_type || "manual",
    published_at: row.published_at || "",
    updated_at: row.updated_at || "",
    excerpt: row.excerpt || "",
    seo_title: row.seo_title || "",
    product_title: row.product_title || "",
    circle_name: row.circle_name || "",
    author_name: row.author_name || "",
    source_url: row.source_url || "",
    affiliate_url: row.affiliate_url || "",
    thumbnail_url: row.thumbnail_url || "",
    genres: parseJsonList(row.genres_json),
    emotions: parseJsonList(row.emotions_json),
    rights_status: row.rights_status || "pending_review",
    pr_label: row.pr_label || "PR",
    automation_ready: Boolean(row.automation_ready),
    product_id: row.product_id || "",
  };
}

async function importDmmRanking(env, options = {}) {
  const startedAt = new Date(options.scheduledTime || Date.now()).toISOString();
  const rankingUrl = env.DMM_RANKING_URL || DEFAULT_RANKING_URL;
  const limit = positiveInteger(options.limit, env.DMM_RANKING_LIMIT || DEFAULT_RANKING_LIMIT);
  const dryRun = Boolean(options.dryRun);

  const summary = {
    started_at: startedAt,
    cron: options.cron || "",
    ranking_url: rankingUrl,
    limit,
    dry_run: dryRun,
    seen: 0,
    created: 0,
    skipped: 0,
    failed: 0,
    items: [],
  };

  const rankingResponse = await fetchHtml(rankingUrl);
  assertNotAgeCheck(rankingResponse.html, rankingResponse.url);
  const rankingItems = parseRankingItems(rankingResponse.html, rankingResponse.url).slice(0, limit);
  summary.seen = rankingItems.length;

  if (!rankingItems.length) {
    throw new Error("ranking items were not found. DMM markup may have changed.");
  }

  for (const item of rankingItems) {
    const slug = slugify(item.title);
    const earlyProductId = extractProductId(item.url);
    const earlyDuplicate = await findDuplicateArticle(env, {
      slug,
      productId: earlyProductId,
      urls: [item.url],
      title: item.title,
      circleName: item.circleName,
    });

    if (earlyDuplicate) {
      summary.skipped += 1;
      summary.items.push({ rank: item.rank, title: item.title, status: "skipped", duplicate: earlyDuplicate.slug });
      continue;
    }

    try {
      const detailResponse = await fetchHtml(item.url, { referer: rankingResponse.url });
      assertNotAgeCheck(detailResponse.html, detailResponse.url);
      const detail = parseProductDetail(detailResponse.html, detailResponse.url, item.title);
      const productId =
        extractProductId(detail.url) ||
        extractProductId(detail.thumbnailUrl) ||
        earlyProductId ||
        null;

      const duplicate = await findDuplicateArticle(env, {
        slug,
        productId,
        urls: [item.url, detail.url],
        title: item.title,
        circleName: item.circleName,
      });

      if (duplicate) {
        summary.skipped += 1;
        summary.items.push({ rank: item.rank, title: item.title, status: "skipped", duplicate: duplicate.slug });
        continue;
      }

      const article = {
        title: item.title,
        slug,
        status: "published",
        article_type: "review",
        source_type: "dmm_ranking_h24",
        published_at: new Date().toISOString(),
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
        product_id: productId,
      };

      if (!dryRun) {
        await saveArticle(env, article);
      }

      summary.created += 1;
      summary.items.push({ rank: item.rank, title: item.title, slug, status: dryRun ? "dry-run" : "created" });
    } catch (error) {
      summary.failed += 1;
      summary.items.push({ rank: item.rank, title: item.title, status: "failed", error: error.message });
      console.error(JSON.stringify({ level: "error", rank: item.rank, title: item.title, message: error.message }));
    }
  }

  console.log(
    JSON.stringify({
      level: summary.failed ? "warn" : "info",
      event: "dmm-ranking-import",
      seen: summary.seen,
      created: summary.created,
      skipped: summary.skipped,
      failed: summary.failed,
    })
  );

  return summary;
}

async function findDuplicateArticle(env, candidate) {
  const urls = [...(candidate.urls || []), ""].slice(0, 2);
  const row = await env.DB.prepare(
    `SELECT slug FROM articles
     WHERE slug = ?
        OR (? IS NOT NULL AND product_id = ?)
        OR source_url IN (?, ?)
        OR affiliate_url IN (?, ?)
        OR (title = ? AND (? = '' OR circle_name = ?))
        OR (product_title = ? AND (? = '' OR circle_name = ?))
     LIMIT 1`
  )
    .bind(
      candidate.slug,
      candidate.productId || null,
      candidate.productId || null,
      urls[0],
      urls[1],
      urls[0],
      urls[1],
      candidate.title || "",
      candidate.circleName || "",
      candidate.circleName || "",
      candidate.title || "",
      candidate.circleName || "",
      candidate.circleName || ""
    )
    .first();
  return row || null;
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
  return {
    url: response.url,
    html: decodeHtml(await response.arrayBuffer(), contentType),
  };
}

function decodeHtml(arrayBuffer, contentType) {
  const bytes = new Uint8Array(arrayBuffer);
  const asciiHead = new TextDecoder("latin1").decode(bytes.slice(0, 4096));
  const labels = [
    contentType.match(/charset=([^;\s]+)/iu)?.[1],
    asciiHead.match(/<meta[^>]+charset=["']?([^"'\s/>]+)/iu)?.[1],
    "utf-8",
    "euc-jp",
    "shift_jis",
  ].filter(Boolean);

  for (const label of labels) {
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // Try the next encoding label.
    }
  }

  return new TextDecoder().decode(bytes);
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

function renderSiteIndex(articles, context = {}) {
  const filters = context.filters || {};
  const allArticles = context.allArticles || articles;
  const circles = distinctValues(allArticles.map((article) => article.circle_name));
  const authors = distinctValues(
    allArticles
      .filter((article) => !filters.circle || article.circle_name === filters.circle)
      .map((article) => article.author_name)
  );
  const genres = distinctValues(
    allArticles
      .filter((article) => !filters.circle || article.circle_name === filters.circle)
      .filter((article) => !filters.author || article.author_name === filters.author)
      .flatMap((article) => article.genres || [])
  );
  const breadcrumb = renderBreadcrumb(filters);
  const activeLabel = renderActiveFilterLabel(filters);
  const cards = articles
    .map((article) => {
      const labels =
        renderGenreTags((article.genres || []).slice(0, 8), filters) +
        renderPlainTags((article.emotions || []).slice(0, 4));
      const circleLink = article.circle_name
        ? `<a href="${siteFilterUrl({ circle: article.circle_name })}">${escapeHtml(article.circle_name)}</a>`
        : "";
      const authorLink = article.author_name
        ? `<a href="${siteFilterUrl({ circle: filters.circle, author: article.author_name })}">${escapeHtml(article.author_name)}</a>`
        : "";
      return `
        <article class="post-card">
          ${article.thumbnail_url ? `<a class="post-image-link" href="/site/posts/${encodeURIComponent(article.slug)}"><img src="${escapeHtml(article.thumbnail_url)}" alt=""></a>` : ""}
          <div>
            <p class="meta">${escapeHtml(article.status)} / ${escapeHtml(article.article_type || "review")}</p>
            <h2><a href="/site/posts/${encodeURIComponent(article.slug)}">${escapeHtml(article.title)}</a></h2>
            ${circleLink || authorLink ? `<p class="work-meta">${circleLink}${circleLink && authorLink ? " / " : ""}${authorLink}</p>` : ""}
            <p>${escapeHtml(article.excerpt || "本文の抜粋はまだありません。")}</p>
            <div class="tags">${labels}</div>
          </div>
        </article>
      `;
    })
    .join("");

  return pageShell("R18ブックス・同人誌レビューガイド", `
    <main class="site-shell">
      <header class="site-header">
        <p>18歳未満閲覧禁止 / PRを含む場合があります</p>
        <h1>R18ブックス・同人誌レビューガイド</h1>
        ${breadcrumb}
      </header>
      <div class="catalog-layout">
        <aside class="filter-panel">
          <form method="get" action="/site" class="filter-form">
            <label>
              <span>キーワード</span>
              <input name="q" value="${escapeHtml(filters.q || "")}" placeholder="タイトル、サークル、作者、タグ">
            </label>
            <label>
              <span>サークル</span>
              <input name="circle" value="${escapeHtml(filters.circle || "")}" placeholder="例: どじろーブックス">
            </label>
            <label>
              <span>作者</span>
              <input name="author" value="${escapeHtml(filters.author || "")}" placeholder="例: どじろー">
            </label>
            <label>
              <span>ジャンル</span>
              <input name="genre" value="${escapeHtml((filters.genres || []).join(" "))}" placeholder="例: 制服 巨乳">
            </label>
            <button type="submit">検索</button>
            <a class="ghost-link" href="/site">解除</a>
          </form>
          ${activeLabel ? `<div class="active-filter">${activeLabel}</div>` : ""}
          <div class="filter-links">
            <section>
              <h2>サークル</h2>
              <div class="tags filter-tags">${circles.map((circle) => `<a href="${siteFilterUrl({ q: filters.q, circle, author: filters.author, genres: filters.genres })}">${escapeHtml(circle)}</a>`).join("") || "<span>未登録</span>"}</div>
            </section>
            <section>
              <h2>作者</h2>
              <div class="tags filter-tags">${authors.map((author) => `<a href="${siteFilterUrl({ q: filters.q, circle: filters.circle, author, genres: filters.genres })}">${escapeHtml(author)}</a>`).join("") || "<span>未登録</span>"}</div>
            </section>
            <section>
              <h2>ジャンル</h2>
              <div class="tags filter-tags">${genres.map((genre) => renderGenreFilterLink(genre, filters)).join("") || "<span>未登録</span>"}</div>
            </section>
          </div>
        </aside>
        <section class="post-grid">${cards || "<p>記事はまだありません。</p>"}</section>
      </div>
    </main>
  `);
}

function renderArticlePage(article, options = {}) {
  const metadata = article.metadata;
  const productLink = productPageUrl(metadata);
  const labels =
    renderGenreTags(metadata.genres || []) +
    renderPlainTags(metadata.emotions || []);
  const body = markdownToHtml(article.body, { imageLinkUrl: productLink });
  const circleLink = metadata.circle_name
    ? `<a href="${siteFilterUrl({ circle: metadata.circle_name })}">${escapeHtml(metadata.circle_name)}</a>`
    : "";
  const authorLink = metadata.author_name
    ? `<a href="${siteFilterUrl({ circle: metadata.circle_name, author: metadata.author_name })}">${escapeHtml(metadata.author_name)}</a>`
    : "";
  const heroImage = metadata.thumbnail_url
    ? productLink
      ? `<a class="image-product-link hero-link" href="${escapeHtml(productLink)}" target="_blank" rel="sponsored noopener noreferrer" aria-label="商品ページを開く"><img class="hero-image" src="${escapeHtml(metadata.thumbnail_url)}" alt=""></a>`
      : `<img class="hero-image" src="${escapeHtml(metadata.thumbnail_url)}" alt="">`
    : "";

  return pageShell(metadata.title, `
    <main class="site-shell article-shell">
      <p><a href="${options.preview ? "/admin" : "/site"}">← 戻る</a></p>
      ${options.preview ? '<p class="preview-banner">Preview</p>' : ""}
      <article>
        <header class="site-header">
          <p>18歳未満閲覧禁止 / ${escapeHtml(metadata.pr_label || "PR")}</p>
          <h1>${escapeHtml(metadata.title)}</h1>
          <p>${escapeHtml(metadata.excerpt || "")}</p>
          ${circleLink || authorLink ? `<p class="work-meta">${circleLink}${circleLink && authorLink ? " / " : ""}${authorLink}</p>` : ""}
          <div class="tags">${labels}</div>
        </header>
        ${heroImage}
        <div class="article-body">${body}</div>
        ${productLink ? `<p class="cta"><a href="${escapeHtml(productLink)}" target="_blank" rel="sponsored noopener noreferrer">作品ページを確認する</a></p>` : ""}
      </article>
    </main>
  `);
}

function articleMatchesFilters(article, filters) {
  if (filters.circle && article.circle_name !== filters.circle) return false;
  if (filters.author && article.author_name !== filters.author) return false;
  if ((filters.genres || []).some((genre) => !(article.genres || []).includes(genre))) {
    return false;
  }
  if (!filters.q) return true;
  return [
    article.title,
    article.slug,
    article.excerpt,
    article.product_title,
    article.circle_name,
    article.author_name,
    ...(article.genres || []),
    ...(article.emotions || []),
  ]
    .join(" ")
    .toLowerCase()
    .includes(filters.q.toLowerCase());
}

function distinctValues(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, "ja")
  );
}

function productPageUrl(metadata) {
  return String(metadata.affiliate_url || metadata.source_url || "").trim();
}

function siteFilterUrl(params = {}) {
  const search = new URLSearchParams();
  for (const key of ["q", "circle", "author"]) {
    if (params[key]) search.set(key, params[key]);
  }
  for (const genre of normalizeFilterValues(params.genres ?? params.genre)) {
    search.append("genre", genre);
  }
  const query = search.toString();
  return query ? `/site?${query}` : "/site";
}

function renderGenreTags(genres, filters = {}) {
  return [...genres].map((genre) => renderGenreFilterLink(genre, filters)).join("");
}

function renderGenreFilterLink(genre, filters = {}) {
  const selectedGenres = filters.genres || [];
  const active = selectedGenres.includes(genre);
  const nextGenres = active
    ? selectedGenres.filter((selected) => selected !== genre)
    : [...selectedGenres, genre];
  const href = siteFilterUrl({
    q: filters.q,
    circle: filters.circle,
    author: filters.author,
    genres: nextGenres,
  });
  return `<a class="${active ? "active" : ""}" href="${href}">${escapeHtml(genre)}</a>`;
}

function renderPlainTags(tags) {
  return [...tags].map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
}

function renderBreadcrumb(filters) {
  const items = ['<a href="/site">FANZA同人</a>', '<a href="/site">作品一覧</a>'];
  if (filters.circle) {
    items.push("サークル", `<a href="${siteFilterUrl({ circle: filters.circle })}">${escapeHtml(filters.circle)}</a>`);
  }
  if (filters.author) {
    items.push("作者", `<a href="${siteFilterUrl({ circle: filters.circle, author: filters.author })}">${escapeHtml(filters.author)}</a>`);
  }
  if ((filters.genres || []).length) {
    items.push(
      "ジャンル",
      `<a href="${siteFilterUrl({ circle: filters.circle, author: filters.author, genres: filters.genres })}">${escapeHtml(filters.genres.join(" + "))}</a>`
    );
  }
  return `<nav class="breadcrumbs">${items.join("<span>ー</span>")}</nav>`;
}

function renderActiveFilterLabel(filters) {
  const chips = [];
  if (filters.circle) chips.push(`<span>サークル: ${escapeHtml(filters.circle)}</span>`);
  if (filters.author) chips.push(`<span>作者: ${escapeHtml(filters.author)}</span>`);
  for (const genre of filters.genres || []) {
    chips.push(`<a href="${toggleGenreUrl(filters, genre)}">ジャンル: ${escapeHtml(genre)} ×</a>`);
  }
  if (filters.q) chips.push(`<span>検索: ${escapeHtml(filters.q)}</span>`);
  return chips.join("");
}

function toggleGenreUrl(filters, genre) {
  return siteFilterUrl({
    q: filters.q,
    circle: filters.circle,
    author: filters.author,
    genres: (filters.genres || []).filter((selected) => selected !== genre),
  });
}

function normalizeFilterValues(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(
    values
      .flatMap((item) => String(item || "").split(/[\s\u3000,、，]+/u))
      .map((item) => item.trim())
      .filter(Boolean)
  )];
}

function markdownToHtml(markdown, options = {}) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let listOpen = false;
  let codeOpen = false;
  let codeLines = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(" "), options)}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!listOpen) return;
    html.push("</ul>");
    listOpen = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith("```")) {
      flushParagraph();
      closeList();
      if (codeOpen) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        codeOpen = false;
      } else {
        codeOpen = true;
      }
      continue;
    }

    if (codeOpen) {
      codeLines.push(rawLine);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/u);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2], options)}</h${level}>`);
      continue;
    }

    const listItem = line.match(/^[-*]\s+(.+)$/u);
    if (listItem) {
      flushParagraph();
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${inlineMarkdown(listItem[1], options)}</li>`);
      continue;
    }

    const quote = line.match(/^>\s?(.+)$/u);
    if (quote) {
      flushParagraph();
      closeList();
      html.push(`<blockquote>${inlineMarkdown(quote[1], options)}</blockquote>`);
      continue;
    }

    paragraph.push(line.trim());
  }

  if (codeOpen) html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  flushParagraph();
  closeList();
  return html.join("\n");
}

function inlineMarkdown(value, options = {}) {
  const imageLinkUrl = String(options.imageLinkUrl || "").trim();
  const imageReplacement = imageLinkUrl
    ? `<a class="image-product-link" href="${escapeHtml(imageLinkUrl)}" target="_blank" rel="sponsored noopener noreferrer"><img src="$2" alt="$1" loading="lazy"></a>`
    : '<img src="$2" alt="$1" loading="lazy">';

  return escapeHtml(value)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/gu, imageReplacement)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/gu, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>")
    .replace(/`([^`]+)`/gu, "<code>$1</code>");
}

function pageShell(title, body) {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/admin.css">
</head>
<body class="site-preview">
${body}
</body>
</html>`;
}

function sendJson(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function sendHtml(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function sendText(text, status = 200) {
  return new Response(text, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function slugify(value) {
  const base = String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return base || `post-${new Date().toISOString().replace(/\D/gu, "").slice(0, 14)}`;
}

function normalizeList(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => String(item || "").split(/[\s\u3000,、，]+/u))
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonList(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function normalizeBody(value) {
  return String(value || "").replace(/\r\n/g, "\n").trimEnd();
}

function absoluteUrl(value, baseUrl) {
  try {
    return new URL(decodeEntities(value), baseUrl).href;
  } catch {
    return decodeEntities(value);
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

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : Number(fallback) || DEFAULT_RANKING_LIMIT;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#039;");
}
