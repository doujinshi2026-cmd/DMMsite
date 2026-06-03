const DEFAULT_RANKING_URL =
  "https://www.dmm.co.jp/dc/doujin/-/ranking-all/=/submedia=comic/sort=sales/term=h24/";
const DEFAULT_RANKING_LIMIT = 100;
const DEFAULT_RANKING_DETAIL_LIMIT = 50;
const MAX_RANKING_DETAIL_LIMIT = 40;
const DEFAULT_REQUEST_DELAY_MS = 750;
const MAX_REQUEST_DELAY_MS = 5000;
const REQUEST_TIMEOUT_MS = 30000;
const SITE_CONTACT_EMAIL = "doujinshi2026@gmail.com";
const SITE_NAME = "オトナのよみもの案内";
const SITE_OPERATOR_NAME = `${SITE_NAME} 編集部`;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const STATUS_VALUES = new Set(["draft", "ready", "published", "archived"]);
const TYPE_VALUES = new Set(["review", "column", "news", "list"]);
const RIGHTS_VALUES = new Set(["pending_review", "approved_ad_material", "link_only"]);
const ARTICLE_EDITORIAL_COLUMNS = [
  ["sample_images_json", "sample_images_json TEXT NOT NULL DEFAULT '[]'"],
  ["weekly_pick", "weekly_pick INTEGER NOT NULL DEFAULT 0"],
  ["weekly_pick_order", "weekly_pick_order INTEGER NOT NULL DEFAULT 0"],
  ["editor_note", "editor_note TEXT NOT NULL DEFAULT ''"],
];
let articleEditorialColumnsReady = false;
let contactMessagesTableReady = false;

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

  if (
    pathname === "/admin" ||
    pathname === "/admin/" ||
    pathname === "/admin/index.html" ||
    pathname === "/index.html"
  ) {
    const unauthorized = await requireAdmin(request, env);
    if (unauthorized) return unauthorized;
    return adminAssetResponse(env, request, "/index.html");
  }

  if (pathname === "/admin.css") {
    return assetResponse(env, request, pathname);
  }

  if (pathname === "/admin.js") {
    const unauthorized = await requireAdmin(request, env);
    if (unauthorized) return unauthorized;
    return adminAssetResponse(env, request, pathname);
  }

  if (pathname === "/site.js") {
    return assetResponse(env, request, pathname);
  }

  if (request.method === "GET" && pathname === "/robots.txt") {
    return sendText("User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /preview/\n");
  }

  if (request.method === "GET" && pathname === "/site") {
    const allArticles = sortArticlesByUpdatedAt((await listArticles(env)).filter(isPublicArticle));
    const filters = {
      q: String(url.searchParams.get("q") || "").trim(),
      circle: String(url.searchParams.get("circle") || "").trim(),
      author: String(url.searchParams.get("author") || "").trim(),
      genres: normalizeFilterValues(url.searchParams.getAll("genre")),
    };
    const articles = sortArticlesByUpdatedAt(allArticles.filter((article) => articleMatchesFilters(article, filters)));
    return sendHtml(renderSiteIndex(articles, { allArticles, filters }));
  }

  if (request.method === "GET" && (pathname === "/site/policy" || pathname === "/site/about")) {
    return sendHtml(renderPolicyPage());
  }

  if (request.method === "GET" && pathname === "/site/contact") {
    return sendHtml(renderContactPage());
  }

  if (request.method === "POST" && pathname === "/site/contact") {
    return handleContactSubmit(request, env);
  }

  if (request.method === "GET" && pathname.startsWith("/site/posts/")) {
    const slug = pathname.slice("/site/posts/".length);
    const article = await readArticle(env, slug);
    if (!article) return sendText("Not found", 404);
    if (!isPublicArticle(article.metadata)) return sendText("Not found", 404);
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
    const detailLimit = positiveInteger(
      url.searchParams.get("detailLimit") ||
        url.searchParams.get("detail_limit") ||
        url.searchParams.get("batchSize") ||
        url.searchParams.get("batch_size"),
      env.DMM_RANKING_DETAIL_LIMIT || DEFAULT_RANKING_DETAIL_LIMIT
    );
    const delayMs = boundedNonNegativeInteger(
      url.searchParams.get("delayMs") || url.searchParams.get("delay_ms"),
      env.DMM_RANKING_REQUEST_DELAY_MS || DEFAULT_REQUEST_DELAY_MS,
      MAX_REQUEST_DELAY_MS
    );
    const result = await importDmmRanking(env, { dryRun, limit, detailLimit, delayMs, manual: true });
    return sendJson(result);
  }

  if ((request.method === "GET" || request.method === "POST") && pathname === "/api/dmm/backfill") {
    const dryRun = url.searchParams.get("dryRun") === "1" || url.searchParams.get("dry_run") === "1";
    const limit = positiveInteger(url.searchParams.get("limit"), env.DMM_RANKING_LIMIT);
    const delayMs = boundedNonNegativeInteger(
      url.searchParams.get("delayMs") || url.searchParams.get("delay_ms"),
      env.DMM_RANKING_REQUEST_DELAY_MS || DEFAULT_REQUEST_DELAY_MS,
      MAX_REQUEST_DELAY_MS
    );
    const result = await backfillDmmDetails(env, { dryRun, limit, delayMs });
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

async function adminAssetResponse(env, request, pathname) {
  const response = await assetResponse(env, request, pathname);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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

async function articleCounts(env) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published FROM articles"
  ).first();
  return {
    total: Number(row?.total || 0),
    published: Number(row?.published || 0),
  };
}

async function ensureArticleEditorialColumns(env) {
  if (articleEditorialColumnsReady) return;

  const { results } = await env.DB.prepare("PRAGMA table_info(articles)").all();
  const existingColumns = new Set((results || []).map((row) => row.name));

  for (const [columnName, definition] of ARTICLE_EDITORIAL_COLUMNS) {
    if (existingColumns.has(columnName)) continue;
    try {
      await env.DB.prepare(`ALTER TABLE articles ADD COLUMN ${definition}`).run();
    } catch (error) {
      if (!/duplicate column name|already exists/iu.test(String(error?.message || ""))) {
        throw error;
      }
    }
  }

  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_articles_weekly_pick ON articles(weekly_pick, weekly_pick_order)"
  ).run();
  articleEditorialColumnsReady = true;
}

async function ensureContactMessagesTable(env) {
  if (contactMessagesTableReady) return;

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS contact_messages (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL
    )`
  ).run();
  contactMessagesTableReady = true;
}

async function saveArticle(env, input) {
  await ensureArticleEditorialColumns(env);

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
      thumbnail_url, sample_images_json, genres_json, emotions_json, weekly_pick,
      weekly_pick_order, editor_note, rights_status, pr_label, automation_ready,
      body, product_id, created_at, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      JSON.stringify(metadata.sample_images || []),
      JSON.stringify(metadata.genres || []),
      JSON.stringify(metadata.emotions || []),
      metadata.weekly_pick ? 1 : 0,
      metadata.weekly_pick_order || 0,
      metadata.editor_note,
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
      sample_images_json = ?, genres_json = ?, emotions_json = ?, weekly_pick = ?,
      weekly_pick_order = ?, editor_note = ?, rights_status = ?, pr_label = ?, automation_ready = ?,
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
      JSON.stringify(metadata.sample_images || []),
      JSON.stringify(metadata.genres || []),
      JSON.stringify(metadata.emotions || []),
      metadata.weekly_pick ? 1 : 0,
      metadata.weekly_pick_order || 0,
      metadata.editor_note,
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
    sample_images: normalizeList(input.sample_images ?? existing.sample_images),
    genres: normalizeList(input.genres),
    emotions: normalizeList(input.emotions),
    weekly_pick: Boolean(input.weekly_pick ?? existing.weekly_pick),
    weekly_pick_order: toInteger(input.weekly_pick_order ?? existing.weekly_pick_order, 0),
    editor_note: String(input.editor_note ?? existing.editor_note ?? "").trim(),
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
    sample_images: parseJsonList(row.sample_images_json),
    genres: parseJsonList(row.genres_json),
    emotions: parseJsonList(row.emotions_json),
    weekly_pick: Boolean(row.weekly_pick),
    weekly_pick_order: toInteger(row.weekly_pick_order, 0),
    editor_note: row.editor_note || "",
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
  const detailLimit = positiveInteger(
    options.detailLimit,
    env.DMM_RANKING_DETAIL_LIMIT || DEFAULT_RANKING_DETAIL_LIMIT
  );
  const safeDetailLimit = Math.min(detailLimit, MAX_RANKING_DETAIL_LIMIT);
  const delayMs = boundedNonNegativeInteger(
    options.delayMs,
    env.DMM_RANKING_REQUEST_DELAY_MS || DEFAULT_REQUEST_DELAY_MS,
    MAX_REQUEST_DELAY_MS
  );
  const dryRun = Boolean(options.dryRun);
  let detailRequests = 0;

  const summary = {
    started_at: startedAt,
    cron: options.cron || "",
    ranking_url: rankingUrl,
    limit,
    ranking_pages: 0,
    detail_limit: safeDetailLimit,
    detail_requests: 0,
    request_delay_ms: delayMs,
    dry_run: dryRun,
    seen: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    deferred: 0,
    failed: 0,
    counts_before: null,
    counts_after: null,
    items: [],
  };

  summary.counts_before = await articleCounts(env);

  const rankingResult = await fetchRankingItems(rankingUrl, limit, delayMs);
  const rankingItems = rankingResult.items;
  summary.ranking_pages = rankingResult.pages;
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
    const earlyExistingArticle = earlyDuplicate ? await readArticle(env, earlyDuplicate.slug) : null;

    if (earlyDuplicate && hasImportDetails(earlyExistingArticle)) {
      summary.skipped += 1;
      summary.items.push({ rank: item.rank, title: item.title, status: "skipped", duplicate: earlyDuplicate.slug });
      continue;
    }

    if (detailRequests >= safeDetailLimit) {
      summary.deferred += 1;
      summary.items.push({
        rank: item.rank,
        title: item.title,
        status: "deferred",
        reason: "detail-limit",
      });
      continue;
    }

    try {
      await waitBeforeDetailRequest(detailRequests, delayMs);
      detailRequests += 1;
      summary.detail_requests = detailRequests;

      const detailResponse = await fetchHtml(item.url, { referer: rankingResult.url });
      assertNotAgeCheck(detailResponse.html, detailResponse.url);
      const detail = parseProductDetail(detailResponse.html, detailResponse.url, item.title);
      const productId =
        extractProductId(detail.url) ||
        extractProductId(detail.thumbnailUrl) ||
        earlyProductId ||
        null;

      if (earlyDuplicate) {
        const updateInput = buildExistingArticleUpdate(earlyExistingArticle, detail, productId);
        if (updateInput) {
          if (!dryRun) {
            await saveArticle(env, updateInput);
          }
          summary.updated += 1;
          summary.items.push({
            rank: item.rank,
            title: item.title,
            slug: updateInput.slug,
            status: dryRun ? "update-dry-run" : "updated",
          });
        } else {
          summary.skipped += 1;
          summary.items.push({ rank: item.rank, title: item.title, status: "skipped", duplicate: earlyDuplicate.slug });
        }
        continue;
      }

      const duplicate = await findDuplicateArticle(env, {
        slug,
        productId,
        urls: [item.url, detail.url],
        title: item.title,
        circleName: item.circleName,
      });

      if (duplicate) {
        const duplicateArticle = await readArticle(env, duplicate.slug);
        const updateInput = buildExistingArticleUpdate(duplicateArticle, detail, productId);
        if (updateInput) {
          if (!dryRun) {
            await saveArticle(env, updateInput);
          }
          summary.updated += 1;
          summary.items.push({
            rank: item.rank,
            title: item.title,
            slug: updateInput.slug,
            status: dryRun ? "update-dry-run" : "updated",
          });
        } else {
          summary.skipped += 1;
          summary.items.push({ rank: item.rank, title: item.title, status: "skipped", duplicate: duplicate.slug });
        }
        continue;
      }

      const article = {
        title: item.title,
        slug,
        status: "published",
        article_type: "review",
        source_type: "dmm_ranking_h24",
        published_at: new Date().toISOString(),
        excerpt: detail.workComment,
        seo_title: "",
        product_title: item.title,
        circle_name: item.circleName,
        author_name: "",
        source_url: detail.url,
        affiliate_url: detail.url,
        thumbnail_url: detail.thumbnailUrl,
        sample_images: detail.sampleImageUrls,
        genres: detail.genres,
        emotions: [],
        rights_status: "pending_review",
        pr_label: "PR",
        automation_ready: true,
        body: defaultArticleBodyMarkdown({
          title: item.title,
          excerpt: detail.workComment,
          product_title: item.title,
          circle_name: item.circleName,
          author_name: "",
          genres: detail.genres,
        }),
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

  summary.counts_after = dryRun ? summary.counts_before : await articleCounts(env);

  console.log(
    JSON.stringify({
      level: summary.failed ? "warn" : "info",
      event: "dmm-ranking-import",
      seen: summary.seen,
      ranking_pages: summary.ranking_pages,
      detail_requests: summary.detail_requests,
      created: summary.created,
      updated: summary.updated,
      skipped: summary.skipped,
      deferred: summary.deferred,
      failed: summary.failed,
      counts_before: summary.counts_before,
      counts_after: summary.counts_after,
    })
  );

  return summary;
}

async function fetchRankingItems(rankingUrl, limit, delayMs) {
  const items = [];
  const seen = new Set();
  let canonicalUrl = rankingUrl;
  let pages = 0;
  const maxPages = Math.max(1, Math.ceil(limit / 20) + 2);

  for (let page = 1; items.length < limit && page <= maxPages; page += 1) {
    if (page > 1 && delayMs > 0) {
      await sleep(delayMs);
    }

    const pageUrl = page === 1 ? rankingUrl : rankingPageUrl(rankingUrl, page);
    const response = await fetchHtml(pageUrl, { referer: canonicalUrl });
    pages += 1;
    if (page === 1) canonicalUrl = response.url;
    assertNotAgeCheck(response.html, response.url);

    const pageItems = parseRankingItems(response.html, response.url);
    if (!pageItems.length) break;

    let added = 0;
    for (const item of pageItems) {
      const key = normalizeUrlKey(item.url) || normalizeKey(`${item.title}|${item.circleName}`);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ ...item, rank: items.length + 1 });
      added += 1;
      if (items.length >= limit) break;
    }

    if (!added || pageItems.length < 20) break;
  }

  return { url: canonicalUrl, pages, items };
}

function rankingPageUrl(value, page) {
  try {
    const url = new URL(value);
    const pageSegment = `page=${page}`;
    if (/\/page=\d+(?=\/|$)/u.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/page=\d+(?=\/|$)/u, `/${pageSegment}`);
    } else {
      url.pathname = url.pathname.endsWith("/")
        ? `${url.pathname}${pageSegment}/`
        : `${url.pathname}/${pageSegment}/`;
    }
    return url.href;
  } catch {
    return value;
  }
}

function hasImportDetails(article) {
  const metadata = article?.metadata || {};
  return Boolean(
    String(metadata.excerpt || "").trim() &&
      String(metadata.thumbnail_url || "").trim() &&
      (metadata.sample_images || []).length &&
      (metadata.genres || []).length
  );
}

function buildExistingArticleUpdate(article, detail, productId) {
  if (!article) return null;
  const metadata = article.metadata || {};
  const currentGenres = metadata.genres || [];
  const nextExcerpt = metadata.excerpt || detail.workComment || "";
  const nextSourceUrl = metadata.source_url || detail.url || "";
  const nextAffiliateUrl = metadata.affiliate_url || detail.url || "";
  const nextThumbnailUrl = metadata.thumbnail_url || detail.thumbnailUrl || "";
  const nextGenres = currentGenres.length ? currentGenres : detail.genres || [];
  const currentSampleImages = metadata.sample_images || [];
  const nextSampleImages = mergeSampleImages(currentSampleImages, detail.sampleImageUrls || []);

  const hasChanges =
    nextExcerpt !== (metadata.excerpt || "") ||
    nextSourceUrl !== (metadata.source_url || "") ||
    nextAffiliateUrl !== (metadata.affiliate_url || "") ||
    nextThumbnailUrl !== (metadata.thumbnail_url || "") ||
    !arraysEqual(nextSampleImages, currentSampleImages) ||
    !arraysEqual(nextGenres, currentGenres);

  if (!hasChanges) return null;

  const nextMetadata = {
    ...metadata,
    excerpt: nextExcerpt,
    source_url: nextSourceUrl,
    affiliate_url: nextAffiliateUrl,
    thumbnail_url: nextThumbnailUrl,
    sample_images: nextSampleImages,
    genres: nextGenres,
  };

  return {
    ...nextMetadata,
    old_slug: metadata.slug,
    body: articleBodyMarkdown(nextMetadata, article.body),
    product_id: productId || metadata.product_id || "",
  };
}

function arraysEqual(left, right) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function mergeSampleImages(currentImages, importedImages) {
  if (!currentImages.length) return importedImages;
  if (!importedImages.length) return currentImages;
  return unique([...currentImages, ...importedImages]);
}

async function backfillDmmDetails(env, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const limit = positiveInteger(options.limit, DEFAULT_RANKING_LIMIT);
  const delayMs = boundedNonNegativeInteger(
    options.delayMs,
    env.DMM_RANKING_REQUEST_DELAY_MS || DEFAULT_REQUEST_DELAY_MS,
    MAX_REQUEST_DELAY_MS
  );
  let detailRequests = 0;
  const summary = {
    dryRun,
    limit,
    detail_requests: 0,
    request_delay_ms: delayMs,
    seen: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    items: [],
  };

  const candidates = (await listArticles(env))
    .filter((metadata) => !hasImportDetails({ metadata }))
    .filter((metadata) => isDmmUrl(metadata.source_url || metadata.affiliate_url))
    .slice(0, limit);

  summary.seen = candidates.length;

  for (const metadata of candidates) {
    try {
      const article = await readArticle(env, metadata.slug);
      const detailUrl = article.metadata.source_url || article.metadata.affiliate_url;
      await waitBeforeDetailRequest(detailRequests, delayMs);
      detailRequests += 1;
      summary.detail_requests = detailRequests;

      const detailResponse = await fetchHtml(detailUrl);
      assertNotAgeCheck(detailResponse.html, detailResponse.url);
      const detail = parseProductDetail(detailResponse.html, detailResponse.url, article.metadata.title);
      const productId =
        extractProductId(detail.url) ||
        extractProductId(detail.thumbnailUrl) ||
        extractProductId(detailUrl) ||
        null;
      const updateInput = buildExistingArticleUpdate(article, detail, productId);

      if (!updateInput) {
        summary.skipped += 1;
        summary.items.push({ slug: metadata.slug, status: "skipped" });
        continue;
      }

      if (!dryRun) {
        await saveArticle(env, updateInput);
      }

      summary.updated += 1;
      summary.items.push({
        slug: updateInput.slug,
        status: dryRun ? "update-dry-run" : "updated",
        genres: (updateInput.genres || []).length,
      });
    } catch (error) {
      summary.failed += 1;
      summary.items.push({ slug: metadata.slug, status: "failed", error: error.message });
    }
  }

  return summary;
}

function isDmmUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === "dmm.co.jp" ||
      hostname.endsWith(".dmm.co.jp") ||
      hostname === "dmm.com" ||
      hostname.endsWith(".dmm.com")
    );
  } catch {
    return false;
  }
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
    !/\brank-name\b|\bc_icon_detailGenreTag\b|\bgenreTag__txt\b/i.test(html)
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
  const legacyGenres = unique(
    [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)]
      .filter((match) => /\bclass\s*=\s*["'][^"']*\bc_icon_detailGenreTag\b[^"']*["']/iu.test(match[1]))
      .map((match) => textContent(match[2]))
      .filter(Boolean)
  );
  const genreBlock = extractInformationListBlock(html, "ジャンル");
  const currentGenres = genreBlock
    ? [...genreBlock.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)]
        .filter((match) => hasClass(match[1], "genreTag__txt") || /article=keyword/iu.test(getAttr(match[1], "href")))
        .map((match) => textContent(match[2]))
        .filter(Boolean)
    : [];
  const genres = unique([...currentGenres, ...legacyGenres]);
  const thumbnailUrl = extractThumbnailUrl(html, url, fallbackTitle);

  return {
    url,
    genres,
    workComment: extractWorkComment(html),
    thumbnailUrl,
    sampleImageUrls: extractSampleImageUrls(html, url, thumbnailUrl),
  };
}

function extractInformationListBlock(html, label) {
  const titleRe = /<dt\b([^>]*)>([\s\S]*?)<\/dt>/giu;
  for (const title of html.matchAll(titleRe)) {
    if (!hasClass(title[1], "informationList__ttl")) continue;
    if (normalizeKey(textContent(title[2])) !== normalizeKey(label)) continue;

    const afterTitle = html.slice(title.index + title[0].length, title.index + title[0].length + 50000);
    const itemOpen = afterTitle.match(/<dd\b([^>]*)>/iu);
    if (!itemOpen) return "";

    const itemBody = afterTitle.slice(itemOpen.index + itemOpen[0].length);
    const itemClose = itemBody.match(/<\/dd>/iu);
    return itemClose ? itemBody.slice(0, itemClose.index) : itemBody;
  }

  return "";
}

function extractWorkComment(html) {
  const headingRe = /<h3\b([^>]*)>([\s\S]*?)<\/h3>/giu;
  for (const heading of html.matchAll(headingRe)) {
    if (!hasClass(heading[1], "summary__ttl")) continue;
    if (normalizeKey(textContent(heading[2])) !== normalizeKey("作品コメント")) continue;

    const afterHeading = html.slice(heading.index + heading[0].length, heading.index + heading[0].length + 50000);
    const openTagRe = /<([a-z][a-z0-9:-]*)\b([^>]*)>/giu;
    for (const block of afterHeading.matchAll(openTagRe)) {
      if (!hasClass(block[2], "summary__txt")) continue;
      const rest = afterHeading.slice(block.index + block[0].length);
      const closeTagRe = new RegExp(`<\\/\\s*${escapeRegExp(block[1])}\\s*>`, "iu");
      const closeTag = rest.match(closeTagRe);
      return blockTextContent(closeTag ? rest.slice(0, closeTag.index) : rest);
    }
  }

  return "";
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

function extractSampleImageUrls(html, baseUrl, thumbnailUrl = "") {
  const candidates = [];
  const productId = extractProductId(thumbnailUrl) || extractProductId(baseUrl);
  if (thumbnailUrl) candidates.push(thumbnailUrl);

  const productPreviewRe = /<ul\b([^>]*)>([\s\S]*?)<\/ul>/giu;
  for (const block of html.matchAll(productPreviewRe)) {
    if (!hasClass(block[1], "productPreview")) continue;
    candidates.push(...extractImageUrlsFromHtml(block[2], baseUrl));
  }

  if (candidates.length <= (thumbnailUrl ? 1 : 0)) {
    candidates.push(...extractImageUrlsFromHtml(html, baseUrl));
  }

  return unique(
    candidates
      .map((url) => normalizeImageUrl(url))
      .filter((url) => isSampleImageUrl(url) && isSameProductImage(url, productId))
  );
}

function extractImageUrlsFromHtml(html, baseUrl) {
  const urls = [];
  for (const match of String(html || "").matchAll(/<a\b([^>]*)>/giu)) {
    const href = getAttr(match[1], "href");
    if (href) urls.push(absoluteUrl(href, baseUrl));
  }
  for (const match of String(html || "").matchAll(/<img\b([^>]*)>/giu)) {
    const attrs = match[1];
    const src = getAttr(attrs, "src") || getAttr(attrs, "data-src") || getAttr(attrs, "data-original");
    if (src) urls.push(absoluteUrl(src, baseUrl));
  }
  return urls;
}

function normalizeImageUrl(value) {
  try {
    const url = new URL(decodeEntities(value));
    url.hash = "";
    return url.href;
  } catch {
    return decodeEntities(value);
  }
}

function isSampleImageUrl(value) {
  const url = String(value || "");
  if (!/(?:doujin-assets|ebook-assets)\.dmm\.co\.jp\//iu.test(url)) return false;
  return /\.(?:jpe?g|png|webp)(?:[?#].*)?$/iu.test(url);
}

function isSameProductImage(value, productId) {
  if (!productId) return true;
  const imageProductId = extractProductId(value);
  return !imageProductId || normalizeKey(imageProductId) === normalizeKey(productId);
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

function hasClass(attrs, className) {
  return getAttr(attrs, "class")
    .split(/[\s\u00a0]+/u)
    .includes(className);
}

function textContent(value) {
  return decodeEntities(String(value || "").replace(/<[^>]+>/gu, " "))
    .replace(/[\s\u00a0]+/gu, " ")
    .trim();
}

function blockTextContent(value) {
  return decodeEntities(
    String(value || "")
      .replace(/<\s*br\b[^>]*>/giu, "\n")
      .replace(/<\/\s*(?:p|div|li|h[1-6]|tr)\s*>/giu, "\n")
      .replace(/<[^>]+>/gu, "")
  )
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => (line.trim() ? line.replace(/[\t\f\v\u00a0]/gu, " ").trimEnd() : ""))
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
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

function isPublicArticle(article) {
  return article?.status === "published";
}

function sortArticlesByUpdatedAt(articles) {
  return [...articles].sort((a, b) => {
    const left = String(a.updated_at || a.published_at || a.file_updated_at || "");
    const right = String(b.updated_at || b.published_at || b.file_updated_at || "");
    if (left !== right) return right.localeCompare(left);
    return String(a.title || a.slug || "").localeCompare(String(b.title || b.slug || ""), "ja");
  });
}

function renderSiteIndex(articles, context = {}) {
  const filters = context.filters || {};
  const allArticles = context.allArticles || articles;
  const countSummary = renderCountSummary(articles.length, allArticles.length, filters);
  const filtered = hasActiveFilters(filters);
  const weeklyPicks = filtered ? [] : sortWeeklyPicks(allArticles.filter((article) => article.weekly_pick));
  const listArticles = weeklyPicks.length ? articles.filter((article) => !article.weekly_pick) : articles;
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
  const cards = listArticles
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
            <h2><a href="/site/posts/${encodeURIComponent(article.slug)}">${escapeBreakableText(article.title)}</a></h2>
            ${circleLink || authorLink ? `<p class="work-meta">${circleLink}${circleLink && authorLink ? " / " : ""}${authorLink}</p>` : ""}
            <p class="post-excerpt">${escapeHtml(article.excerpt || "本文の抜粋はまだありません。")}</p>
            <div class="tags">${labels}</div>
          </div>
        </article>
      `;
    })
    .join("");

  return pageShell(SITE_NAME, `
    <main class="site-shell">
      <header class="site-header">
        <p>18歳未満閲覧禁止 / 商品リンクはPRを含みます</p>
        <h1>${SITE_NAME}</h1>
        ${countSummary}
        ${breadcrumb}
      </header>
      ${renderWeeklyPickSection(weeklyPicks)}
      <div class="catalog-layout">
        <aside class="filter-panel">
          <form method="get" action="/site" class="filter-form" data-suggest-form>
            ${renderSuggestField({
              field: "q",
              label: "キーワード",
              value: filters.q || "",
              placeholder: "タイトル、サークル、作者、タグ",
            })}
            ${renderSuggestField({
              field: "circle",
              label: "サークル",
              value: filters.circle || "",
              placeholder: "例: どじろーブックス",
            })}
            ${renderSuggestField({
              field: "author",
              label: "作者",
              value: filters.author || "",
              placeholder: "例: どじろー",
            })}
            ${renderSuggestField({
              field: "genre",
              label: "ジャンル",
              value: (filters.genres || []).join(" "),
              placeholder: "例: 制服 巨乳",
            })}
            <button type="submit">検索</button>
            <a class="ghost-link" href="/site">解除</a>
          </form>
          ${renderSearchSuggestionScript(allArticles)}
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

function renderSuggestField({ field, label, value, placeholder }) {
  const id = `siteFilter${field[0].toUpperCase()}${field.slice(1)}`;
  const menuId = `${id}Suggestions`;
  return `
            <div class="suggest-field" data-suggest-field="${escapeHtml(field)}">
              <label for="${escapeHtml(id)}"><span>${escapeHtml(label)}</span></label>
              <div class="suggest-input-wrap">
                <input id="${escapeHtml(id)}" name="${escapeHtml(field)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" aria-autocomplete="list" aria-expanded="false" aria-controls="${escapeHtml(menuId)}" data-suggest-input>
                <div id="${escapeHtml(menuId)}" class="suggest-menu" role="listbox" data-suggest-menu hidden></div>
              </div>
            </div>
  `;
}

function renderSearchSuggestionScript(articles) {
  return `<script type="application/json" id="site-search-suggestions">${jsonForScript(buildSearchSuggestions(articles))}</script>`;
}

function buildSearchSuggestions(articles) {
  const maps = {
    q: new Map(),
    circle: new Map(),
    author: new Map(),
    genre: new Map(),
  };

  const add = (map, value, type, article) => {
    const text = String(value || "").trim();
    if (!text) return;
    const key = normalizeKey(text);
    const item = map.get(key) || {
      value: text,
      type,
      count: 0,
      circles: new Set(),
      authors: new Set(),
    };
    item.count += 1;
    if (article?.circle_name) item.circles.add(article.circle_name);
    if (article?.author_name) item.authors.add(article.author_name);
    map.set(key, item);
  };

  for (const article of articles) {
    add(maps.q, article.title, "作品", article);
    add(maps.q, article.product_title, "作品", article);
    add(maps.q, article.circle_name, "サークル", article);
    add(maps.q, article.author_name, "作者", article);
    for (const genre of article.genres || []) {
      add(maps.q, genre, "ジャンル", article);
      add(maps.genre, genre, "ジャンル", article);
    }
    for (const emotion of article.emotions || []) {
      add(maps.q, emotion, "タグ", article);
    }
    add(maps.circle, article.circle_name, "サークル", article);
    add(maps.author, article.author_name, "作者", article);
  }

  return {
    q: serializeSuggestions(maps.q, 420),
    circle: serializeSuggestions(maps.circle, 220),
    author: serializeSuggestions(maps.author, 220),
    genre: serializeSuggestions(maps.genre, 260),
  };
}

function serializeSuggestions(map, limit) {
  return [...map.values()]
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.value.localeCompare(b.value, "ja");
    })
    .slice(0, limit)
    .map((item) => ({
      value: item.value,
      type: item.type,
      count: item.count,
      circles: [...item.circles],
      authors: [...item.authors],
    }));
}

function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</gu, "\\u003c")
    .replace(/>/gu, "\\u003e")
    .replace(/&/gu, "\\u0026")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
}

function renderPolicyPage() {
  return pageShell("運営情報・サイトポリシー", `
    <main class="site-shell static-page">
      <p><a href="/site">← 作品一覧へ戻る</a></p>
      <header class="site-header">
        <p>18歳未満閲覧禁止</p>
        <h1>運営情報・サイトポリシー</h1>
      </header>
      <section>
        <h2>このサイトについて</h2>
        <p>大人向け作品の雰囲気、作風、試し読みで確認したい点を整理する紹介サイトです。18歳未満の方は閲覧できません。</p>
        <p>当サイトはDMM/FANZA公式サイトではありません。作品名、画像、商品情報などの権利は各権利者に帰属します。</p>
      </section>
      <section>
        <h2>運営者情報</h2>
        <p>運営者: ${SITE_OPERATOR_NAME}</p>
        <p>連絡先: <a href="mailto:${SITE_CONTACT_EMAIL}">${SITE_CONTACT_EMAIL}</a> / <a href="/site/contact">お問い合わせフォーム</a></p>
      </section>
      <section>
        <h2>掲載リンクについて</h2>
        <p>作品ページへのリンクには、PRを含む成果報酬型リンクを掲載する場合があります。価格、販売状況、対応環境、注意事項は、購入前にリンク先の販売ページで必ず確認してください。</p>
      </section>
      <section>
        <h2>画像・引用の扱い</h2>
        <p>画像は、公式販売ページで確認できるサンプルや商品情報の範囲で、作品確認のために掲載しています。掲載内容に問題がある場合は、お問い合わせページからご連絡ください。</p>
      </section>
      <section>
        <h2>プライバシー</h2>
        <p>お問い合わせ時に入力された名前、メールアドレス、本文は、返信と確認対応のために利用します。法令に基づく場合を除き、本人の同意なく第三者へ提供しません。</p>
        <p>サーバーの保守や不正利用対策のため、ホスティング事業者側でアクセスログが記録される場合があります。</p>
      </section>
      <section>
        <h2>免責事項</h2>
        <p>掲載内容は確認時点の情報です。正確性には注意していますが、最新情報や購入条件はリンク先の販売ページを優先してください。</p>
      </section>
    </main>
  `);
}

function renderContactPage(state = {}) {
  const values = state.values || {};
  const errors = state.errors || [];
  const success = Boolean(state.success);
  return pageShell("お問い合わせ", `
    <main class="site-shell static-page">
      <p><a href="/site">← 作品一覧へ戻る</a></p>
      <header class="site-header">
        <p>18歳未満閲覧禁止</p>
        <h1>お問い合わせ</h1>
      </header>
      <p>掲載内容、権利関係、サイト運営に関する連絡は、<a href="mailto:${SITE_CONTACT_EMAIL}">${SITE_CONTACT_EMAIL}</a> またはこちらのフォームから送信してください。</p>
      ${success ? '<p class="form-message success">送信しました。内容を確認します。</p>' : ""}
      ${errors.length ? `<div class="form-message error">${errors.map((error) => `<p>${escapeHtml(error)}</p>`).join("")}</div>` : ""}
      <form class="contact-form" method="post" action="/site/contact">
        <label>
          <span>お名前</span>
          <input name="name" value="${escapeHtml(values.name || "")}" autocomplete="name" maxlength="80">
        </label>
        <label>
          <span>返信先メールアドレス</span>
          <input name="email" type="email" value="${escapeHtml(values.email || "")}" autocomplete="email" maxlength="160">
        </label>
        <label>
          <span>お問い合わせ内容</span>
          <textarea name="message" rows="8" required maxlength="2000">${escapeHtml(values.message || "")}</textarea>
        </label>
        <button type="submit">送信</button>
      </form>
    </main>
  `);
}

async function handleContactSubmit(request, env) {
  const form = await request.formData();
  const values = {
    name: String(form.get("name") || "").trim().slice(0, 80),
    email: String(form.get("email") || "").trim().slice(0, 160),
    message: String(form.get("message") || "").trim().slice(0, 2000),
  };
  const errors = [];

  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(values.email)) {
    errors.push("メールアドレスの形式を確認してください。");
  }
  if (values.message.length < 10) {
    errors.push("お問い合わせ内容は10文字以上で入力してください。");
  }

  if (errors.length) {
    return sendHtml(renderContactPage({ values, errors }), 400);
  }

  await ensureContactMessagesTable(env);
  await env.DB.prepare(
    "INSERT INTO contact_messages (id, created_at, name, email, message) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(crypto.randomUUID(), new Date().toISOString(), values.name, values.email, values.message)
    .run();

  return sendHtml(renderContactPage({ success: true }));
}

function sortWeeklyPicks(articles) {
  return [...articles].sort((a, b) => {
    const leftOrder = toInteger(a.weekly_pick_order, 0);
    const rightOrder = toInteger(b.weekly_pick_order, 0);
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    const leftDate = String(a.updated_at || a.published_at || a.file_updated_at || "");
    const rightDate = String(b.updated_at || b.published_at || b.file_updated_at || "");
    return rightDate.localeCompare(leftDate);
  });
}

function renderWeeklyPickSection(articles) {
  if (!articles.length) return "";
  return `
      <section class="weekly-picks" aria-labelledby="weekly-picks-heading">
        <div class="section-heading">
          <p>編集ピックアップ</p>
          <h2 id="weekly-picks-heading">今週のおすすめ</h2>
        </div>
        <div class="weekly-pick-grid">
          ${articles.map((article) => renderWeeklyPickCard(article)).join("")}
        </div>
      </section>
  `;
}

function renderWeeklyPickCard(article) {
  const productLink = productPageUrl(article);
  const articleLink = `/site/posts/${encodeURIComponent(article.slug)}`;
  return `
            <article class="weekly-pick-card">
              ${renderSampleCarousel(article, productLink, "weekly")}
              <div class="weekly-pick-body">
                <h3><a href="${articleLink}">${escapeBreakableText(article.title)}</a></h3>
              </div>
            </article>
  `;
}

function renderArticlePage(article, options = {}) {
  const metadata = article.metadata;
  const productLink = productPageUrl(metadata);
  const labels =
    renderGenreTags(metadata.genres || []) +
    renderPlainTags(metadata.emotions || []);
  const body = markdownToHtml(articleBodyMarkdown(metadata, article.body), { imageLinkUrl: productLink });
  const circleLink = metadata.circle_name
    ? `<a href="${siteFilterUrl({ circle: metadata.circle_name })}">${escapeHtml(metadata.circle_name)}</a>`
    : "";
  const authorLink = metadata.author_name
    ? `<a href="${siteFilterUrl({ circle: metadata.circle_name, author: metadata.author_name })}">${escapeHtml(metadata.author_name)}</a>`
    : "";
  const sampleImages = articleSampleImages(metadata);
  const sampleViewer = sampleImages.length ? renderSampleCarousel(metadata, productLink, "article") : "";
  const heroImage = !sampleViewer && metadata.thumbnail_url
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
          <p>18歳未満閲覧禁止 / 商品リンクはPRを含みます</p>
          <h1>${escapeBreakableText(metadata.title)}</h1>
          ${circleLink || authorLink ? `<p class="work-meta">${circleLink}${circleLink && authorLink ? " / " : ""}${authorLink}</p>` : ""}
          <div class="tags">${labels}</div>
        </header>
        ${sampleViewer || heroImage}
        <div class="article-body">${body}</div>
        ${productLink ? `<p class="cta"><a href="${escapeHtml(productLink)}" target="_blank" rel="sponsored noopener noreferrer">作品ページを確認する</a></p>` : ""}
      </article>
    </main>
  `);
}

function renderSampleCarousel(article, productLink = "", variant = "") {
  const images = (variant === "weekly" ? weeklySampleImages(article) : articleSampleImages(article)).slice(0, 12);
  if (!images.length) return "";
  const link = String(productLink || "").trim();
  const className = ["sample-carousel", variant ? `sample-carousel-${variant}` : ""].filter(Boolean).join(" ");
  const imageItems = images
    .map((url, index) => {
      const image = `<img src="${escapeHtml(url)}" alt="${escapeHtml(`${article.title || "作品"} 試し読み ${index + 1}`)}" loading="lazy">`;
      return link
        ? `<a class="sample-slide" href="${escapeHtml(link)}" target="_blank" rel="sponsored noopener noreferrer">${image}</a>`
        : `<span class="sample-slide">${image}</span>`;
    })
    .join("");
  const controls = images.length > 1
    ? `
          <button class="sample-nav sample-nav-prev" type="button" aria-label="前の試し読み画像" data-sample-nav="-1">&#8249;</button>
          <button class="sample-nav sample-nav-next" type="button" aria-label="次の試し読み画像" data-sample-nav="1">&#8250;</button>
          <p class="sample-page-indicator"><span data-sample-page>1</span> / <span data-sample-total>${images.length}</span></p>
    `
    : "";
  return `
        <div class="sample-carousel-shell${variant ? ` sample-carousel-shell-${variant}` : ""}">
          <div class="${className}" aria-label="試し読み画像" tabindex="0">
            ${imageItems}
          </div>
          ${controls}
        </div>
  `;
}

function articleSampleImages(article) {
  return unique([article.thumbnail_url, ...(article.sample_images || [])].filter(Boolean));
}

function weeklySampleImages(article) {
  return unique([...(article.sample_images || [])].filter(Boolean));
}

function articleBodyMarkdown(metadata, body) {
  const markdown = stripLegacyDisclosureBlock(String(body || ""));
  if (!markdown.trim()) return defaultArticleBodyMarkdown(metadata);

  const comment = String(metadata.excerpt || "").trim();
  if (!comment || hasWorkCommentSection(markdown)) return markdown;

  return insertWorkCommentSection(markdown, comment);
}

function stripLegacyDisclosureBlock(markdown) {
  return String(markdown || "").replace(
    /^>\s*(?:PR|広告)\s*[:：].*(?:広告リンク|アフィリエイトリンク).*(?:\n\s*){1,2}/u,
    ""
  );
}

function defaultArticleBodyMarkdown(metadata = {}) {
  const genres = Array.isArray(metadata.genres) ? metadata.genres : normalizeFilterValues(metadata.genres || "");
  const comment = String(metadata.excerpt || "").trim();
  const lines = [
    "## 作品コメント",
    "",
  ];

  if (comment) {
    lines.push(comment, "");
  }

  lines.push(
    "## 作品の基本情報",
    "",
    `- 作品名: ${metadata.product_title || metadata.title || ""}`,
    `- サークル: ${metadata.circle_name || ""}`,
    `- 作者: ${metadata.author_name || ""}`,
    `- ジャンル: ${genres.join("、")}`,
    "",
    "## 続きが気になる場合",
    "",
    "サンプルや販売ページで、絵柄・雰囲気・注意事項を確認してから判断してください。",
    ""
  );

  return lines.join("\n");
}

function hasWorkCommentSection(markdown) {
  return /^#{1,3}\s*作品コメント\s*$/mu.test(String(markdown || ""));
}

function insertWorkCommentSection(markdown, comment) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length && (!lines[index].trim() || lines[index].trimStart().startsWith(">"))) {
    index += 1;
  }

  lines.splice(index, 0, "## 作品コメント", "", comment, "");
  return lines.join("\n");
}

function renderCountSummary(visibleCount, totalCount, filters) {
  const hasFilters = hasActiveFilters(filters);
  return `<p class="site-count">現在の作品数 <strong>${formatCount(totalCount)}</strong>件${hasFilters ? ` / 表示中 <strong>${formatCount(visibleCount)}</strong>件` : ""}</p>`;
}

function hasActiveFilters(filters = {}) {
  return Boolean(
    filters.q ||
      filters.circle ||
      filters.author ||
      (filters.genres || []).length
  );
}

function formatCount(value) {
  return Number(value || 0).toLocaleString("ja-JP");
}

function renderWorkComment(value) {
  const comment = String(value || "").trim();
  if (!comment) return "";
  return `
        <section class="work-comment">
          <h2>作品コメント</h2>
          <p>${escapeHtml(comment)}</p>
        </section>
  `;
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
  const items = ['<a href="/site">作品一覧</a>'];
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
${siteFooter()}
<script src="/site.js" defer></script>
</body>
</html>`;
}

function siteFooter() {
  return `
<footer class="site-footer">
  <div class="site-footer-inner">
    <nav class="footer-links" aria-label="サイト情報">
      <a href="/site">作品一覧</a>
      <a href="/site/policy">運営情報・サイトポリシー</a>
      <a href="/site/contact">お問い合わせ</a>
    </nav>
    <p>掲載リンクについて: 商品リンクにはアフィリエイトプログラムによる収益が発生する場合があります。</p>
    <p>当サイトはDMM/FANZA公式サイトではありません。</p>
  </div>
</footer>`;
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

function toInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
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

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : Number(fallback) || DEFAULT_RANKING_LIMIT;
}

function boundedNonNegativeInteger(value, fallback, max) {
  const fallbackNumber = Number(fallback);
  const number = Number(value);
  const resolved = Number.isInteger(number) && number >= 0 ? number : fallbackNumber;
  const safeValue = Number.isInteger(resolved) && resolved >= 0 ? resolved : 0;
  return Math.min(safeValue, max);
}

async function waitBeforeDetailRequest(previousRequests, delayMs) {
  if (previousRequests <= 0 || delayMs <= 0) return;
  await sleep(delayMs);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function escapeBreakableText(value) {
  return [...String(value ?? "")].map((character) => escapeHtml(character)).join("<wbr>");
}
