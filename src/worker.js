const DEFAULT_RANKING_URL =
  "https://www.dmm.co.jp/dc/doujin/-/ranking-all/=/submedia=comic/sort=sales/term=h24/";
const DEFAULT_RANKING_LIMIT = 100;
const DEFAULT_RANKING_DETAIL_LIMIT = 50;
const MAX_RANKING_DETAIL_LIMIT = 40;
const DEFAULT_REQUEST_DELAY_MS = 750;
const MAX_REQUEST_DELAY_MS = 5000;
const REQUEST_TIMEOUT_MS = 30000;
const DMM_ITEMLIST_URL = "https://api.dmm.com/affiliate/v3/ItemList";
const DEFAULT_DMM_API_SITE = "FANZA";
const DEFAULT_DMM_API_SERVICE = "doujin";
const DEFAULT_DMM_API_FLOOR = "digital_doujin";
const DEFAULT_DMM_API_SORT = "rank";
const DEFAULT_DMM_API_IMPORT_LIMIT = 50;
const DEFAULT_DMM_API_IMPORT_HITS = 100;
const DEFAULT_DMM_API_IMPORT_PAGE_LIMIT = 3;
const MAX_DMM_API_IMPORT_LIMIT = 100;
const MAX_DMM_API_IMPORT_HITS = 100;
const MAX_DMM_API_IMPORT_PAGE_LIMIT = 10;
const MAX_DMM_API_OFFSET = 50000;
const DEFAULT_AFFILIATE_BACKFILL_LIMIT = 100;
const SITE_PAGE_SIZE = 20;
const SITE_MAX_PAGE = 250;
const SITE_MAX_GENRE_FILTERS = 5;
const SITE_FACET_LIMIT = 24;
const SITE_MAX_QUERY_LENGTH = 2048;
const SITE_HTML_CACHE_SECONDS = 300;
const SITE_SUGGESTIONS_CACHE_SECONDS = 3600;
const SITEMAP_FILTER_LIMIT = 80;
const SITE_CONTACT_EMAIL = "doujinshi2026@gmail.com";
const SITE_NAME = "オトナのよみもの案内";
const SITE_OPERATOR_NAME = `${SITE_NAME} 編集部`;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const STATUS_VALUES = new Set(["draft", "ready", "published", "archived"]);
const TYPE_VALUES = new Set(["review", "column", "news", "list"]);
const RIGHTS_VALUES = new Set(["pending_review", "approved_ad_material", "link_only"]);
const DMM_API_SORT_VALUES = new Set(["rank", "date", "review", "price", "-price", "match"]);
const DMM_API_MEDIA_VALUES = new Set(["comic", "game", "cg", "voice", "all"]);
const DMM_API_FLOOR_VALUES = new Set(["digital_doujin", "digital_doujin_bl", "digital_doujin_tl"]);
const DMM_API_SCHEDULES = [
  {
    cron: "10 22 * * *",
    label: "morning-new-comics",
    jst: "07:10",
    sort: "date",
    offset: 1,
    limit: 100,
    media: "comic",
  },
  {
    cron: "10 3 * * *",
    label: "lunch-popular-comics",
    jst: "12:10",
    sort: "rank",
    offset: 1,
    limit: 100,
    media: "comic",
  },
  {
    cron: "10 12 * * *",
    label: "night-popular-comics",
    jst: "21:10",
    sort: "rank",
    offset: 101,
    limit: 100,
    media: "comic",
  },
  {
    cron: "10 15 * * *",
    label: "late-review-comics",
    jst: "00:10",
    sort: "review",
    offset: 1,
    limit: 100,
    media: "comic",
  },
];
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
      importDmmApiItems(env, {
        scheduledTime: controller.scheduledTime,
        cron: controller.cron,
        ...scheduledDmmApiOptions(controller.cron),
      })
    );
  },
};

async function route(request, env, ctx) {
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
    return sendText(
      [
        "User-agent: *",
        "Disallow: /admin",
        "Disallow: /api/",
        "Disallow: /preview/",
        `Sitemap: ${url.origin}/sitemap.xml`,
        "",
      ].join("\n")
    );
  }

  if (request.method === "GET" && pathname === "/sitemap.xml") {
    const cacheUrl = new URL("/sitemap.xml", url.origin).href;
    return cachedPublicResponse(cacheUrl, ctx, async () =>
      sendXml(await renderSitemap(env, url.origin))
    );
  }

  if (request.method === "GET" && pathname === "/site/suggestions.json") {
    const cacheUrl = new URL("/site/suggestions.json", url.origin).href;
    return cachedPublicResponse(cacheUrl, ctx, async () =>
      sendPublicJson(await loadSiteSearchSuggestions(env), SITE_SUGGESTIONS_CACHE_SECONDS)
    );
  }

  if (request.method === "GET" && pathname === "/site") {
    if (url.search.length > SITE_MAX_QUERY_LENGTH) {
      return sendText("検索条件が長すぎます。条件を減らして再度お試しください。", 414);
    }

    const siteRequest = parseSiteRequest(url);
    if (siteRequest.wasTrimmed) {
      const redirectUrl = new URL(
        siteFilterUrl({ ...siteRequest.filters, page: siteRequest.page }),
        url.origin
      );
      redirectUrl.searchParams.set("notice", "filters-trimmed");
      return Response.redirect(redirectUrl.href, 302);
    }

    const cacheUrlObject = new URL(
      siteFilterUrl({ ...siteRequest.filters, page: siteRequest.page }),
      url.origin
    );
    const notice = url.searchParams.get("notice") || "";
    if (notice === "filters-trimmed") {
      cacheUrlObject.searchParams.set("notice", notice);
    }
    return cachedPublicResponse(cacheUrlObject.href, ctx, async () => {
      const indexData = await loadSiteIndexData(env, siteRequest.filters, siteRequest.page);
      if (indexData.page !== siteRequest.page) {
        return Response.redirect(
          new URL(
            siteFilterUrl({ ...siteRequest.filters, page: indexData.page }),
            url.origin
          ).href,
          302
        );
      }
      return sendHtml(
        renderSiteIndex(indexData.articles, {
          ...indexData,
          filters: siteRequest.filters,
          notice,
          origin: url.origin,
        }),
        200,
        publicCacheControl(SITE_HTML_CACHE_SECONDS)
      );
    });
  }

  if (request.method === "GET" && (pathname === "/site/policy" || pathname === "/site/about")) {
    const cacheUrl = new URL("/site/policy", url.origin).href;
    return cachedPublicResponse(cacheUrl, ctx, async () =>
      sendHtml(
        renderPolicyPage({ origin: url.origin }),
        200,
        publicCacheControl(SITE_SUGGESTIONS_CACHE_SECONDS)
      )
    );
  }

  if (request.method === "GET" && pathname === "/site/contact") {
    return sendHtml(renderContactPage({ origin: url.origin }));
  }

  if (request.method === "POST" && pathname === "/site/contact") {
    return handleContactSubmit(request, env);
  }

  if (request.method === "GET" && pathname.startsWith("/site/posts/")) {
    const slug = pathname.slice("/site/posts/".length);
    const cacheUrl = new URL(`/site/posts/${encodeURIComponent(slug)}`, url.origin).href;
    return cachedPublicResponse(cacheUrl, ctx, async () => {
      const article = await readArticle(env, slug);
      if (!article) return sendText("Not found", 404);
      if (!isPublicArticle(article.metadata)) return sendText("Not found", 404);
      return sendHtml(
        renderArticlePage(article, { origin: url.origin }),
        200,
        publicCacheControl(SITE_HTML_CACHE_SECONDS)
      );
    });
  }

  if (request.method === "GET" && pathname.startsWith("/preview/")) {
    const unauthorized = await requireAdmin(request, env);
    if (unauthorized) return unauthorized;
    const slug = pathname.slice("/preview/".length);
    const article = await readArticle(env, slug);
    if (!article) return sendText("Not found", 404);
    return sendHtml(renderArticlePage(article, { preview: true, origin: url.origin }));
  }

  if (pathname.startsWith("/api/")) {
    const unauthorized = await requireAdmin(request, env);
    if (unauthorized) return unauthorized;
    return routeApi(request, env, pathname, url);
  }

  return env.ASSETS.fetch(request);
}

function scheduledDmmApiOptions(cron) {
  const schedule = DMM_API_SCHEDULES.find((item) => item.cron === cron) || DMM_API_SCHEDULES[1];
  return {
    sort: schedule.sort,
    offset: schedule.offset,
    limit: schedule.limit,
    media: schedule.media,
    scheduleLabel: schedule.label,
    scheduleJst: schedule.jst,
  };
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
    const limit = boundedPositiveInteger(
      url.searchParams.get("limit"),
      env.DMM_API_IMPORT_LIMIT || DEFAULT_DMM_API_IMPORT_LIMIT,
      MAX_DMM_API_IMPORT_LIMIT
    );
    const hits = boundedPositiveInteger(
      url.searchParams.get("hits"),
      env.DMM_API_IMPORT_HITS || DEFAULT_DMM_API_IMPORT_HITS,
      MAX_DMM_API_IMPORT_HITS
    );
    const offset = boundedPositiveInteger(url.searchParams.get("offset"), 1, MAX_DMM_API_OFFSET);
    const pageLimit = boundedPositiveInteger(
      url.searchParams.get("pageLimit") || url.searchParams.get("page_limit"),
      env.DMM_API_IMPORT_PAGE_LIMIT || DEFAULT_DMM_API_IMPORT_PAGE_LIMIT,
      MAX_DMM_API_IMPORT_PAGE_LIMIT
    );
    const sort = normalizeDmmApiSort(url.searchParams.get("sort") || env.DMM_API_IMPORT_SORT);
    const media = normalizeDmmApiMedia(url.searchParams.get("media") || env.DMM_API_IMPORT_MEDIA);
    const floor = normalizeDmmApiFloor(url.searchParams.get("floor") || env.DMM_API_IMPORT_FLOOR);
    const keyword = String(url.searchParams.get("keyword") || "").trim();
    const delayMs = boundedNonNegativeInteger(
      url.searchParams.get("delayMs") || url.searchParams.get("delay_ms"),
      env.DMM_API_REQUEST_DELAY_MS || 0,
      MAX_REQUEST_DELAY_MS
    );
    const result = await importDmmApiItems(env, {
      dryRun,
      limit,
      hits,
      offset,
      pageLimit,
      sort,
      media,
      floor,
      keyword,
      delayMs,
      manual: true,
    });
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

  if ((request.method === "GET" || request.method === "POST") && pathname === "/api/dmm/affiliate-backfill") {
    const dryRun = url.searchParams.get("dryRun") === "1" || url.searchParams.get("dry_run") === "1";
    const force = url.searchParams.get("force") === "1";
    const limit = positiveInteger(url.searchParams.get("limit"), DEFAULT_AFFILIATE_BACKFILL_LIMIT);
    const delayMs = boundedNonNegativeInteger(
      url.searchParams.get("delayMs") || url.searchParams.get("delay_ms"),
      env.DMM_RANKING_REQUEST_DELAY_MS || DEFAULT_REQUEST_DELAY_MS,
      MAX_REQUEST_DELAY_MS
    );
    const result = await backfillDmmAffiliateLinks(env, { dryRun, force, limit, delayMs });
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

const SITE_ARTICLE_COLUMNS = `
  a.schema_version, a.title, a.slug, a.status, a.article_type, a.source_type,
  a.published_at, a.updated_at, a.excerpt, a.seo_title, a.product_title,
  a.circle_name, a.author_name, a.source_url, a.affiliate_url, a.thumbnail_url,
  a.sample_images_json, a.genres_json, a.emotions_json, a.weekly_pick,
  a.weekly_pick_order, a.rights_status, a.pr_label, a.automation_ready, a.product_id
`;

function parseSiteRequest(url) {
  const rawGenres = normalizeFilterValues(url.searchParams.getAll("genre"));
  const q = boundedFilterText(url.searchParams.get("q"), 80);
  const circle = boundedFilterText(url.searchParams.get("circle"), 100);
  const author = boundedFilterText(url.searchParams.get("author"), 100);
  const genres = rawGenres
    .map((genre) => boundedFilterText(genre, 60))
    .filter(Boolean)
    .slice(0, SITE_MAX_GENRE_FILTERS);
  const rawPage = Number(url.searchParams.get("page") || 1);
  const page = boundedPositiveInteger(rawPage, 1, SITE_MAX_PAGE);
  const wasTrimmed =
    rawGenres.length > SITE_MAX_GENRE_FILTERS ||
    q !== String(url.searchParams.get("q") || "").trim() ||
    circle !== String(url.searchParams.get("circle") || "").trim() ||
    author !== String(url.searchParams.get("author") || "").trim() ||
    genres.some((genre, index) => genre !== rawGenres[index]) ||
    !Number.isInteger(rawPage) ||
    rawPage < 1 ||
    rawPage > SITE_MAX_PAGE;

  return {
    filters: { q, circle, author, genres },
    page,
    wasTrimmed,
  };
}

function boundedFilterText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

async function loadSiteIndexData(env, filters, requestedPage) {
  await ensureArticleEditorialColumns(env);
  const filtered = hasActiveFilters(filters);
  const listWhere = buildSiteWhere(filters, { excludeFeatured: !filtered });
  const totalStatement = env.DB.prepare(
    "SELECT COUNT(*) AS total FROM articles a WHERE a.status = 'published'"
  );
  const matchedStatement = env.DB.prepare(
    `SELECT COUNT(*) AS total FROM articles a WHERE ${listWhere.sql}`
  ).bind(...listWhere.params);
  const [totalResult, matchedResult] = await env.DB.batch([totalStatement, matchedStatement]);
  const totalCount = Number(totalResult?.results?.[0]?.total || 0);
  const matchedCount = Number(matchedResult?.results?.[0]?.total || 0);
  const pageCount = Math.max(1, Math.ceil(matchedCount / SITE_PAGE_SIZE));
  const page = Math.min(boundedPositiveInteger(requestedPage, 1, SITE_MAX_PAGE), pageCount);
  const offset = (page - 1) * SITE_PAGE_SIZE;

  const pageStatement = env.DB.prepare(
    `SELECT ${SITE_ARTICLE_COLUMNS}
     FROM articles a
     WHERE ${listWhere.sql}
     ORDER BY a.updated_at DESC, a.title ASC
     LIMIT ? OFFSET ?`
  ).bind(...listWhere.params, SITE_PAGE_SIZE, offset);

  const circleStatement = env.DB.prepare(
    `SELECT a.circle_name AS value, COUNT(*) AS count
     FROM articles a
     WHERE a.status = 'published' AND a.circle_name <> ''
     GROUP BY a.circle_name
     ORDER BY count DESC, value ASC
     LIMIT ?`
  ).bind(SITE_FACET_LIMIT);

  const authorWhere = buildFacetWhere(filters, { circle: true });
  const authorStatement = env.DB.prepare(
    `SELECT a.author_name AS value, COUNT(*) AS count
     FROM articles a
     WHERE ${authorWhere.sql} AND a.author_name <> ''
     GROUP BY a.author_name
     ORDER BY count DESC, value ASC
     LIMIT ?`
  ).bind(...authorWhere.params, SITE_FACET_LIMIT);

  const genreWhere = buildFacetWhere(filters, { circle: true, author: true });
  const genreStatement = env.DB.prepare(
    `SELECT genre.value AS value, COUNT(*) AS count
     FROM articles a, json_each(a.genres_json) AS genre
     WHERE ${genreWhere.sql} AND genre.value <> ''
     GROUP BY genre.value
     ORDER BY count DESC, value ASC
     LIMIT ?`
  ).bind(...genreWhere.params, SITE_FACET_LIMIT);

  const statements = [pageStatement, circleStatement, authorStatement, genreStatement];
  if (!filtered && page === 1) {
    statements.push(
      env.DB.prepare(
        `SELECT ${SITE_ARTICLE_COLUMNS}
         FROM articles a
         WHERE a.status = 'published' AND a.weekly_pick = 1
         ORDER BY a.weekly_pick_order ASC, a.updated_at DESC
         LIMIT 6`
      )
    );
  }

  const [pageResult, circleResult, authorResult, genreResult, weeklyResult] =
    await env.DB.batch(statements);

  return {
    articles: (pageResult?.results || []).map(rowToMetadata),
    weeklyPicks: (weeklyResult?.results || []).map(rowToMetadata),
    facets: {
      circles: facetRows(circleResult),
      authors: facetRows(authorResult),
      genres: facetRows(genreResult),
    },
    totalCount,
    matchedCount,
    page,
    pageCount,
  };
}

function buildSiteWhere(filters, options = {}) {
  const clauses = ["a.status = 'published'"];
  const params = [];

  if (options.excludeFeatured) {
    clauses.push(
      `a.slug NOT IN (
        SELECT featured.slug
        FROM articles featured
        WHERE featured.status = 'published' AND featured.weekly_pick = 1
        ORDER BY featured.weekly_pick_order ASC, featured.updated_at DESC
        LIMIT 6
      )`
    );
  }
  if (filters.circle) {
    clauses.push("a.circle_name = ?");
    params.push(filters.circle);
  }
  if (filters.author) {
    clauses.push("a.author_name = ?");
    params.push(filters.author);
  }
  for (const genre of filters.genres || []) {
    clauses.push(
      "EXISTS (SELECT 1 FROM json_each(a.genres_json) AS selected_genre WHERE selected_genre.value = ?)"
    );
    params.push(genre);
  }
  if (filters.q) {
    clauses.push(
      `instr(
        lower(
          coalesce(a.title, '') || ' ' ||
          coalesce(a.product_title, '') || ' ' ||
          coalesce(a.excerpt, '') || ' ' ||
          coalesce(a.circle_name, '') || ' ' ||
          coalesce(a.author_name, '') || ' ' ||
          coalesce(a.genres_json, '') || ' ' ||
          coalesce(a.emotions_json, '')
        ),
        lower(?)
      ) > 0`
    );
    params.push(filters.q);
  }

  return { sql: clauses.join(" AND "), params };
}

function buildFacetWhere(filters, options = {}) {
  const clauses = ["a.status = 'published'"];
  const params = [];
  if (options.circle && filters.circle) {
    clauses.push("a.circle_name = ?");
    params.push(filters.circle);
  }
  if (options.author && filters.author) {
    clauses.push("a.author_name = ?");
    params.push(filters.author);
  }
  return { sql: clauses.join(" AND "), params };
}

function facetRows(result) {
  return (result?.results || [])
    .map((row) => ({
      value: String(row.value || "").trim(),
      count: Number(row.count || 0),
    }))
    .filter((row) => row.value);
}

async function loadSiteSearchSuggestions(env) {
  await ensureArticleEditorialColumns(env);
  const published = "a.status = 'published'";
  const [titleResult, circleResult, authorResult, genreResult, emotionResult] =
    await env.DB.batch([
      env.DB.prepare(
        `SELECT a.title AS value, 1 AS count
         FROM articles a
         WHERE ${published} AND a.title <> ''
         ORDER BY a.updated_at DESC
         LIMIT 160`
      ),
      env.DB.prepare(
        `SELECT a.circle_name AS value, COUNT(*) AS count
         FROM articles a
         WHERE ${published} AND a.circle_name <> ''
         GROUP BY a.circle_name
         ORDER BY count DESC, value ASC
         LIMIT 100`
      ),
      env.DB.prepare(
        `SELECT a.author_name AS value, COUNT(*) AS count
         FROM articles a
         WHERE ${published} AND a.author_name <> ''
         GROUP BY a.author_name
         ORDER BY count DESC, value ASC
         LIMIT 100`
      ),
      env.DB.prepare(
        `SELECT genre.value AS value, COUNT(*) AS count
         FROM articles a, json_each(a.genres_json) AS genre
         WHERE ${published} AND genre.value <> ''
         GROUP BY genre.value
         ORDER BY count DESC, value ASC
         LIMIT 180`
      ),
      env.DB.prepare(
        `SELECT emotion.value AS value, COUNT(*) AS count
         FROM articles a, json_each(a.emotions_json) AS emotion
         WHERE ${published} AND emotion.value <> ''
         GROUP BY emotion.value
         ORDER BY count DESC, value ASC
         LIMIT 80`
      ),
    ]);

  const titles = suggestionRows(titleResult, "作品");
  const circles = suggestionRows(circleResult, "サークル");
  const authors = suggestionRows(authorResult, "作者");
  const genres = suggestionRows(genreResult, "ジャンル");
  const emotions = suggestionRows(emotionResult, "タグ");

  return {
    q: titles,
    circle: circles,
    author: authors,
    genre: genres,
    tag: emotions,
  };
}

function suggestionRows(result, type) {
  return (result?.results || [])
    .map((row) => ({
      value: String(row.value || "").trim(),
      type,
      count: Number(row.count || 0),
    }))
    .filter((row) => row.value);
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
      isDmmImportedSourceType(metadata.source_type) ? now : null
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
      isDmmImportedSourceType(metadata.source_type) ? metadata.updated_at : null,
      oldSlug
    )
    .run();
  return Boolean(result?.meta?.changes);
}

function isDmmImportedSourceType(value) {
  return String(value || "").startsWith("dmm_");
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

async function renderSitemap(env, origin) {
  const { results } = await env.DB.prepare(
    `SELECT slug, published_at, updated_at, circle_name, genres_json
     FROM articles
     WHERE status = 'published'
     ORDER BY updated_at DESC`
  ).all();
  const articles = (results || []).map((row) => ({
    slug: row.slug || "",
    published_at: row.published_at || "",
    updated_at: row.updated_at || "",
    circle_name: row.circle_name || "",
    genres: parseJsonList(row.genres_json),
  }));
  const urls = [];
  const latest = sitemapLastModified(articles);
  const addUrl = (path, lastmod = latest, priority = "0.7", changefreq = "weekly") => {
    urls.push({
      loc: absoluteSiteUrl(origin, path),
      lastmod: normalizeSitemapDate(lastmod),
      priority,
      changefreq,
    });
  };

  addUrl("/site", latest, "1.0", "daily");
  addUrl("/site/policy", latest, "0.3", "monthly");

  for (const article of articles) {
    addUrl(`/site/posts/${encodeURIComponent(article.slug)}`, article.updated_at || article.published_at, "0.8", "weekly");
  }

  for (const genre of sitemapFacetStats(articles, (article) => article.genres || [])) {
    addUrl(siteFilterUrl({ genre: genre.value }), genre.lastmod, "0.6", "weekly");
  }

  for (const circle of sitemapFacetStats(articles, (article) => [article.circle_name])) {
    addUrl(siteFilterUrl({ circle: circle.value }), circle.lastmod, "0.5", "weekly");
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(
      (item) => `  <url>
    <loc>${escapeXml(item.loc)}</loc>
    ${item.lastmod ? `<lastmod>${escapeXml(item.lastmod)}</lastmod>` : ""}
    <changefreq>${escapeXml(item.changefreq)}</changefreq>
    <priority>${escapeXml(item.priority)}</priority>
  </url>`
    )
    .join("\n")}\n</urlset>\n`;
}

function sitemapLastModified(articles) {
  let latest = "";
  for (const article of articles) {
    const value = String(article.updated_at || article.published_at || "");
    if (value > latest) latest = value;
  }
  return latest;
}

function normalizeSitemapDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function sitemapFacetStats(articles, valuesForArticle) {
  const stats = new Map();
  for (const article of articles) {
    const lastmod = String(article.updated_at || article.published_at || "");
    const values = new Set(
      (valuesForArticle(article) || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    );
    for (const value of values) {
      const item = stats.get(value) || { value, count: 0, lastmod: "" };
      item.count += 1;
      if (lastmod > item.lastmod) item.lastmod = lastmod;
      stats.set(value, item);
    }
  }
  return [...stats.values()]
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.value.localeCompare(b.value, "ja");
    })
    .slice(0, SITEMAP_FILTER_LIMIT);
}

async function importDmmApiItems(env, options = {}) {
  const apiId = String(env.DMM_API_ID || "").trim();
  const affiliateId = String(env.DMM_AFFILIATE_ID || "").trim();
  const linkAffiliateId = dmmLinkAffiliateId(env, affiliateId);
  if (!apiId) {
    throw new Error("DMM_API_ID is missing. Register it as a Worker secret.");
  }
  if (!affiliateId) {
    throw new Error("DMM_AFFILIATE_ID is missing. Register it as a Worker secret.");
  }
  if (!isApiAffiliateId(affiliateId)) {
    throw new Error("DMM_AFFILIATE_ID must end with -990 through -999 for DMM Web Service API.");
  }

  const startedAt = new Date(options.scheduledTime || Date.now()).toISOString();
  const dryRun = Boolean(options.dryRun);
  const limit = boundedPositiveInteger(
    options.limit,
    env.DMM_API_IMPORT_LIMIT || DEFAULT_DMM_API_IMPORT_LIMIT,
    MAX_DMM_API_IMPORT_LIMIT
  );
  const hits = boundedPositiveInteger(
    options.hits,
    env.DMM_API_IMPORT_HITS || DEFAULT_DMM_API_IMPORT_HITS,
    MAX_DMM_API_IMPORT_HITS
  );
  const offset = boundedPositiveInteger(options.offset, 1, MAX_DMM_API_OFFSET);
  const pageLimit = boundedPositiveInteger(
    options.pageLimit,
    env.DMM_API_IMPORT_PAGE_LIMIT || DEFAULT_DMM_API_IMPORT_PAGE_LIMIT,
    MAX_DMM_API_IMPORT_PAGE_LIMIT
  );
  const sort = normalizeDmmApiSort(options.sort || env.DMM_API_IMPORT_SORT);
  const media = normalizeDmmApiMedia(options.media || env.DMM_API_IMPORT_MEDIA);
  const floor = normalizeDmmApiFloor(options.floor || env.DMM_API_IMPORT_FLOOR);
  const keyword = String(options.keyword || "").trim();
  const delayMs = boundedNonNegativeInteger(
    options.delayMs,
    env.DMM_API_REQUEST_DELAY_MS || 0,
    MAX_REQUEST_DELAY_MS
  );

  const summary = {
    started_at: startedAt,
    cron: options.cron || "",
    schedule_label: options.scheduleLabel || "",
    schedule_jst: options.scheduleJst || "",
    site: DEFAULT_DMM_API_SITE,
    service: DEFAULT_DMM_API_SERVICE,
    floor,
    sort,
    media,
    keyword,
    offset,
    limit,
    hits,
    page_limit: pageLimit,
    request_delay_ms: delayMs,
    dry_run: dryRun,
    api_requests: 0,
    total_count: 0,
    fetched: 0,
    filtered: 0,
    seen: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    counts_before: null,
    counts_after: null,
    items: [],
  };

  summary.counts_before = await articleCounts(env);

  let currentOffset = offset;
  for (let page = 1; summary.seen < limit && page <= pageLimit; page += 1) {
    await waitBeforeDetailRequest(summary.api_requests, delayMs);
    const payload = await fetchDmmApiItemListPage({
      apiId,
      affiliateId,
      site: DEFAULT_DMM_API_SITE,
      service: DEFAULT_DMM_API_SERVICE,
      floor,
      sort,
      keyword,
      hits,
      offset: currentOffset,
    });

    summary.api_requests += 1;
    summary.total_count = payload.totalCount;
    summary.fetched += payload.items.length;

    if (!payload.items.length) break;

    for (let index = 0; index < payload.items.length && summary.seen < limit; index += 1) {
      const item = payload.items[index];
      const apiRank = currentOffset + index;
      if (!dmmApiItemMatchesMedia(item, media)) {
        summary.filtered += 1;
        continue;
      }

      summary.seen += 1;
      await importOneDmmApiItem(env, item, {
        affiliateId: linkAffiliateId,
        dryRun,
        floor,
        sort,
        media,
        rank: apiRank,
        summary,
      });
    }

    if (payload.items.length < hits) break;
    currentOffset += hits;
  }

  summary.counts_after = dryRun ? summary.counts_before : await articleCounts(env);

  console.log(
    JSON.stringify({
      level: summary.failed ? "warn" : "info",
      event: "dmm-api-import",
      schedule_label: summary.schedule_label,
      schedule_jst: summary.schedule_jst,
      floor: summary.floor,
      sort: summary.sort,
      media: summary.media,
      offset: summary.offset,
      limit: summary.limit,
      api_requests: summary.api_requests,
      fetched: summary.fetched,
      filtered: summary.filtered,
      seen: summary.seen,
      created: summary.created,
      updated: summary.updated,
      skipped: summary.skipped,
      failed: summary.failed,
      counts_before: summary.counts_before,
      counts_after: summary.counts_after,
    })
  );

  return summary;
}

async function importOneDmmApiItem(env, item, context) {
  const detail = dmmApiItemDetail(item, context.affiliateId);
  const itemSummary = {
    rank: context.rank,
    product_id: detail.productId,
    title: detail.title,
    media_type: detail.mediaType,
  };

  try {
    if (!detail.title || !detail.url) {
      throw new Error("API item is missing title or URL.");
    }

    const slug = slugify(detail.title);
    const duplicate = await findDuplicateArticle(env, {
      slug,
      productId: detail.productId,
      urls: [detail.url, detail.affiliateUrl],
      title: detail.title,
      circleName: detail.circleName,
    });

    if (duplicate) {
      const article = await readArticle(env, duplicate.slug);
      const updateInput = buildExistingArticleUpdate(article, detail, detail.productId);
      if (updateInput) {
        if (!context.dryRun) {
          await saveArticle(env, updateInput);
        }
        context.summary.updated += 1;
        context.summary.items.push({
          ...itemSummary,
          slug: updateInput.slug,
          status: context.dryRun ? "update-dry-run" : "updated",
        });
      } else {
        context.summary.skipped += 1;
        context.summary.items.push({ ...itemSummary, status: "skipped", duplicate: duplicate.slug });
      }
      return;
    }

    const article = dmmApiDetailToArticle(detail, {
      floor: context.floor,
      sort: context.sort,
      media: context.media,
    });

    if (!context.dryRun) {
      await saveArticle(env, article);
    }

    context.summary.created += 1;
    context.summary.items.push({
      ...itemSummary,
      slug: article.slug,
      status: context.dryRun ? "dry-run" : "created",
    });
  } catch (error) {
    context.summary.failed += 1;
    context.summary.items.push({ ...itemSummary, status: "failed", error: error.message });
    console.error(
      JSON.stringify({
        level: "error",
        event: "dmm-api-import-item",
        rank: context.rank,
        product_id: detail.productId,
        title: detail.title,
        message: error.message,
      })
    );
  }
}

function dmmApiDetailToArticle(detail, context) {
  return {
    title: detail.title,
    slug: slugify(detail.title),
    status: "published",
    article_type: "review",
    source_type: `dmm_api_${context.floor}_${context.sort}`,
    published_at: new Date().toISOString(),
    excerpt: detail.workComment,
    seo_title: "",
    product_title: detail.title,
    circle_name: detail.circleName,
    author_name: detail.authorName,
    source_url: detail.url,
    affiliate_url: detail.affiliateUrl,
    thumbnail_url: detail.thumbnailUrl,
    sample_images: detail.sampleImageUrls,
    genres: detail.genres,
    emotions: [],
    rights_status: "pending_review",
    pr_label: "PR",
    automation_ready: true,
    body: defaultArticleBodyMarkdown({
      title: detail.title,
      excerpt: detail.workComment,
      product_title: detail.title,
      circle_name: detail.circleName,
      author_name: detail.authorName,
      genres: detail.genres,
    }),
    product_id: detail.productId,
  };
}

function dmmApiItemDetail(item, affiliateId) {
  const title = String(item?.title || "").trim();
  const url = String(item?.URL || "").trim();
  const affiliateUrl = normalizeDmmAffiliateUrlForLink(
    String(item?.affiliateURL || item?.affiliateURLsp || "").trim(),
    url,
    affiliateId
  );
  const thumbnailUrl = String(item?.imageURL?.large || item?.imageURL?.list || "").trim();
  const sampleImageUrls = unique(
    [
      ...collectDmmApiImageUrls(item?.sampleImageURL?.sample_l?.image),
      ...collectDmmApiImageUrls(item?.sampleImageURL?.sample_s?.image),
    ].filter(Boolean)
  );
  const genres = dmmApiItemInfoNames(item, "genre");
  const circleName = dmmApiItemInfoNames(item, "maker")[0] || dmmApiItemInfoNames(item, "circle")[0] || "";
  const authorName = dmmApiItemInfoNames(item, "author")[0] || "";
  const productId =
    String(item?.content_id || item?.product_id || "").trim() ||
    extractProductId(url) ||
    extractProductId(affiliateUrl) ||
    extractProductId(thumbnailUrl);
  const mediaType = detectDmmApiMedia(item);
  const detail = {
    title,
    productId,
    url,
    affiliateUrl,
    thumbnailUrl,
    sampleImageUrls,
    genres,
    circleName,
    authorName,
    mediaType,
    date: String(item?.date || "").trim(),
    volume: String(item?.volume || "").trim(),
    workComment: "",
  };
  detail.workComment = buildDmmApiWorkComment(detail);
  return detail;
}

function buildDmmApiWorkComment(detail) {
  const mediaLabels = {
    comic: "同人コミック",
    game: "同人ゲーム",
    cg: "CG・イラスト集",
    voice: "音声作品",
  };
  const mediaLabel = mediaLabels[detail.mediaType] || "FANZA同人作品";
  const lines = [
    detail.circleName ? `${detail.circleName}の${mediaLabel}です。` : `${mediaLabel}です。`,
  ];
  const facts = [];
  if (detail.date) facts.push(`配信開始日: ${detail.date}`);
  if (detail.volume) facts.push(`ボリューム: ${detail.volume}`);
  if (detail.genres.length) facts.push(`主なジャンル: ${detail.genres.slice(0, 8).join("、")}`);
  if (facts.length) lines.push(facts.join(" / "));
  return lines.join("\n");
}

async function fetchDmmApiItemListPage(options) {
  const search = new URLSearchParams({
    api_id: options.apiId,
    affiliate_id: options.affiliateId,
    site: options.site,
    service: options.service,
    floor: options.floor,
    hits: String(options.hits),
    offset: String(options.offset),
    sort: options.sort,
    output: "json",
  });
  if (options.keyword) search.set("keyword", options.keyword);

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

  return {
    items,
    totalCount: Number(payload?.result?.total_count || 0),
  };
}

function normalizeDmmApiSort(value) {
  const sort = String(value || DEFAULT_DMM_API_SORT).trim();
  return DMM_API_SORT_VALUES.has(sort) ? sort : DEFAULT_DMM_API_SORT;
}

function normalizeDmmApiMedia(value) {
  const media = String(value || "comic").trim().toLowerCase();
  return DMM_API_MEDIA_VALUES.has(media) ? media : "comic";
}

function normalizeDmmApiFloor(value) {
  const floor = String(value || DEFAULT_DMM_API_FLOOR).trim();
  return DMM_API_FLOOR_VALUES.has(floor) ? floor : DEFAULT_DMM_API_FLOOR;
}

function dmmApiItemMatchesMedia(item, media) {
  if (media === "all") return true;
  return detectDmmApiMedia(item) === media;
}

function detectDmmApiMedia(item) {
  const urls = [
    item?.URL,
    item?.imageURL?.list,
    item?.imageURL?.large,
    ...collectDmmApiImageUrls(item?.sampleImageURL),
  ].join(" ");

  if (/\/digital\/comic\//iu.test(urls)) return "comic";
  if (/\/digital\/game\//iu.test(urls)) return "game";
  if (/\/digital\/cg\//iu.test(urls)) return "cg";
  if (/\/digital\/(?:voice|doujin_voice)\//iu.test(urls)) return "voice";
  return "";
}

function dmmApiItemInfoNames(item, key) {
  const values = item?.iteminfo?.[key];
  if (!Array.isArray(values)) return [];
  return unique(values.map((value) => String(value?.name || "").trim()).filter(Boolean));
}

function collectDmmApiImageUrls(value) {
  if (!value) return [];
  if (typeof value === "string") return /^https?:\/\//iu.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => collectDmmApiImageUrls(item));
  if (typeof value === "object") return Object.values(value).flatMap((item) => collectDmmApiImageUrls(item));
  return [];
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
      const affiliateUrl = await resolveDmmAffiliateUrl(env, { productId, sourceUrl: detail.url });
      const detailWithAffiliate = { ...detail, affiliateUrl: affiliateUrl || detail.url };

      if (earlyDuplicate) {
        const updateInput = buildExistingArticleUpdate(earlyExistingArticle, detailWithAffiliate, productId);
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
        const updateInput = buildExistingArticleUpdate(duplicateArticle, detailWithAffiliate, productId);
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
        affiliate_url: affiliateUrl || detail.url,
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
  const nextAffiliateUrl = preferredAffiliateUrl(metadata.affiliate_url, detail.affiliateUrl, detail.url);
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

function preferredAffiliateUrl(currentValue, affiliateValue, fallbackValue = "") {
  const current = String(currentValue || "").trim();
  const affiliate = String(affiliateValue || "").trim();
  const fallback = String(fallbackValue || "").trim();
  if (!current) return affiliate || fallback;
  if (affiliate && !isDmmAffiliateLink(current) && isDmmAffiliateLink(affiliate)) return affiliate;
  return current;
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
      const affiliateUrl = await resolveDmmAffiliateUrl(env, { productId, sourceUrl: detail.url });
      const updateInput = buildExistingArticleUpdate(
        article,
        { ...detail, affiliateUrl: affiliateUrl || detail.url },
        productId
      );

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

async function backfillDmmAffiliateLinks(env, options = {}) {
  const apiId = String(env.DMM_API_ID || "").trim();
  const affiliateId = String(env.DMM_AFFILIATE_ID || "").trim();
  const linkAffiliateId = dmmLinkAffiliateId(env, affiliateId);
  if (!apiId) {
    throw new Error("DMM_API_ID is missing. Register it as a Worker secret.");
  }
  if (!affiliateId) {
    throw new Error("DMM_AFFILIATE_ID is missing. Register it as a Worker secret.");
  }
  if (!isApiAffiliateId(affiliateId)) {
    throw new Error("DMM_AFFILIATE_ID must end with -990 through -999 for DMM Web Service API.");
  }

  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const limit = positiveInteger(options.limit, DEFAULT_AFFILIATE_BACKFILL_LIMIT);
  const delayMs = boundedNonNegativeInteger(
    options.delayMs,
    env.DMM_RANKING_REQUEST_DELAY_MS || DEFAULT_REQUEST_DELAY_MS,
    MAX_REQUEST_DELAY_MS
  );
  const candidates = (await listArticles(env))
    .filter((metadata) => collectProductIds(metadata).length)
    .filter((metadata) => force || !isDmmAffiliateLink(metadata.affiliate_url))
    .slice(0, limit);

  const summary = {
    dry_run: dryRun,
    force,
    limit,
    request_delay_ms: delayMs,
    seen: candidates.length,
    updated: 0,
    skipped: 0,
    failed: 0,
    api_requests: 0,
    items: [],
  };

  for (const metadata of candidates) {
    try {
      const productIds = collectProductIds(metadata);
      if (!productIds.length) {
        summary.skipped += 1;
        summary.items.push({ slug: metadata.slug, status: "skipped", error: "product-id-not-found" });
        continue;
      }

      await waitBeforeDetailRequest(summary.api_requests, delayMs);
      const lookup = await lookupDmmAffiliateItem({
        apiId,
        affiliateId,
        productIds,
        sourceUrl: metadata.source_url || metadata.affiliate_url || "",
      });
      summary.api_requests += lookup.requests;

      if (!lookup.item) {
        const fallbackUrl = buildDmmAffiliateUrl(metadata.source_url || metadata.affiliate_url, linkAffiliateId);
        if (!fallbackUrl) {
          summary.failed += 1;
          summary.items.push({
            slug: metadata.slug,
            status: "failed",
            product_id: productIds[0],
            error: lookup.errors[0] || "affiliateURL not found",
          });
          continue;
        }

        if (!dryRun) {
          const article = await readArticle(env, metadata.slug);
          await saveArticle(env, {
            ...article.metadata,
            old_slug: article.metadata.slug,
            source_url: article.metadata.source_url || metadata.source_url || "",
            affiliate_url: fallbackUrl,
            body: article.body,
            product_id: article.metadata.product_id || productIds[0],
          });
        }

        summary.updated += 1;
        summary.items.push({
          slug: metadata.slug,
          status: dryRun ? "fallback-dry-run" : "fallback-updated",
          product_id: productIds[0],
        });
        continue;
      }

      const affiliateUrl = normalizeDmmAffiliateUrlForLink(
        String(lookup.item.affiliateURL || lookup.item.affiliateURLsp || "").trim(),
        lookup.item.URL || metadata.source_url || metadata.affiliate_url,
        linkAffiliateId
      );
      if (!affiliateUrl) {
        summary.failed += 1;
        summary.items.push({
          slug: metadata.slug,
          status: "failed",
          product_id: lookup.productId || productIds[0],
          error: "affiliateURL is empty",
        });
        continue;
      }

      if (!force && metadata.affiliate_url === affiliateUrl) {
        summary.skipped += 1;
        summary.items.push({
          slug: metadata.slug,
          status: "skipped",
          product_id: lookup.productId || productIds[0],
        });
        continue;
      }

      if (!dryRun) {
        const article = await readArticle(env, metadata.slug);
        await saveArticle(env, {
          ...article.metadata,
          old_slug: article.metadata.slug,
          source_url: article.metadata.source_url || lookup.item.URL || "",
          affiliate_url: affiliateUrl,
          body: article.body,
          product_id:
            article.metadata.product_id ||
            lookup.productId ||
            extractProductId(lookup.item.URL) ||
            extractProductId(affiliateUrl),
        });
      }

      summary.updated += 1;
      summary.items.push({
        slug: metadata.slug,
        status: dryRun ? "update-dry-run" : "updated",
        product_id: lookup.productId || productIds[0],
      });
    } catch (error) {
      summary.failed += 1;
      summary.items.push({ slug: metadata.slug, status: "failed", error: error.message });
    }
  }

  return summary;
}

async function resolveDmmAffiliateUrl(env, options = {}) {
  const apiId = String(env.DMM_API_ID || "").trim();
  const affiliateId = String(env.DMM_AFFILIATE_ID || "").trim();
  const linkAffiliateId = dmmLinkAffiliateId(env, affiliateId);
  if (!apiId || !affiliateId || !isApiAffiliateId(affiliateId)) return "";

  const productIds = unique([
    options.productId,
    extractProductId(options.sourceUrl),
    extractProductId(options.thumbnailUrl),
  ]);
  if (!productIds.length) return "";

  try {
    const lookup = await lookupDmmAffiliateItem({
      apiId,
      affiliateId,
      productIds,
      sourceUrl: options.sourceUrl || "",
    });
    return normalizeDmmAffiliateUrlForLink(
      String(lookup.item?.affiliateURL || lookup.item?.affiliateURLsp || "").trim(),
      lookup.item?.URL || options.sourceUrl,
      linkAffiliateId
    );
  } catch (error) {
    console.error(JSON.stringify({ level: "warn", event: "dmm-affiliate-lookup", message: error.message }));
    return buildDmmAffiliateUrl(options.sourceUrl, linkAffiliateId);
  }
}

async function lookupDmmAffiliateItem(options) {
  const errors = [];
  let requests = 0;

  for (const productId of options.productIds) {
    for (const config of dmmLookupConfigs(productId)) {
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

function dmmLookupConfigs(productId) {
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
    ...((metadata.sample_images || []).map((url) => extractProductId(url))),
  ]);
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

function dmmLinkAffiliateId(env, fallback = "") {
  return String(
    env.DMM_LINK_AFFILIATE_ID ||
      env.DMM_SITE_AFFILIATE_ID ||
      env.DMM_WEB_AFFILIATE_ID ||
      fallback ||
      ""
  ).trim();
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
  const totalCount = Number(context.totalCount || 0);
  const matchedCount = Number(context.matchedCount || 0);
  const page = positiveInteger(context.page, 1);
  const pageCount = positiveInteger(context.pageCount, 1);
  const facets = context.facets || {};
  const filtered = hasActiveFilters(filters);
  const weeklyPicks = filtered ? [] : context.weeklyPicks || [];
  const pageArticles = articles;
  const countSummary = renderCountSummary(pageArticles.length, totalCount, filters, {
    matchedCount,
    page,
    pageCount,
    pageSize: SITE_PAGE_SIZE,
  });
  const circles = facets.circles || [];
  const authors = facets.authors || [];
  const genres = facets.genres || [];
  const breadcrumb = renderBreadcrumb(filters);
  const activeLabel = renderActiveFilterLabel(filters);
  const filterNotice =
    context.notice === "filters-trimmed"
      ? `<p class="filter-notice">検索条件を整理しました。ジャンルは最大${SITE_MAX_GENRE_FILTERS}件まで指定できます。</p>`
      : "";
  const cards = pageArticles
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
          ${article.thumbnail_url ? `<a class="post-image-link" href="/site/posts/${encodeURIComponent(article.slug)}"><img src="${escapeHtml(article.thumbnail_url)}" alt="" loading="lazy" decoding="async"></a>` : ""}
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
  const pagination = renderPagination({
    filters,
    page,
    pageCount,
    totalCount: matchedCount,
    pageSize: SITE_PAGE_SIZE,
  });
  const origin = context.origin || "";
  const seoTitle = siteIndexSeoTitle(filters, page);
  const seoDescription = siteIndexSeoDescription(filters, matchedCount, totalCount);
  const canonicalUrl = origin ? absoluteSiteUrl(origin, siteFilterUrl({ ...filters, page })) : "";
  const jsonLd = origin
    ? collectionJsonLd({
        origin,
        title: seoTitle,
        description: seoDescription,
        url: canonicalUrl,
        articles: pageArticles,
      })
    : null;
  const heading = siteIndexHeading(filters);

  return pageShell(seoTitle, `
    <main class="site-shell">
      <header class="site-header">
        <p>18歳未満閲覧禁止 / 商品リンクはPRを含みます</p>
        <h1>${escapeBreakableText(heading)}</h1>
        ${countSummary}
        ${breadcrumb}
      </header>
      ${renderWeeklyPickSection(weeklyPicks)}
      <div class="catalog-layout">
        <aside class="filter-panel">
          <details class="filter-disclosure" data-filter-disclosure>
            <summary>作品を絞り込む${filtered ? "（条件指定中）" : ""}</summary>
            <div class="filter-disclosure-body">
              <form method="get" action="/site" class="filter-form" data-suggest-form data-suggest-url="/site/suggestions.json">
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
                  placeholder: "例: サークル名",
                })}
                ${renderSuggestField({
                  field: "author",
                  label: "作者",
                  value: filters.author || "",
                  placeholder: "例: 作者名",
                })}
                ${renderSuggestField({
                  field: "genre",
                  label: "ジャンル",
                  value: (filters.genres || []).join(" "),
                  placeholder: `最大${SITE_MAX_GENRE_FILTERS}件: 制服 巨乳`,
                })}
                <button type="submit">検索</button>
                <a class="ghost-link" href="/site">解除</a>
              </form>
              ${filterNotice}
              ${activeLabel ? `<div class="active-filter">${activeLabel}</div>` : ""}
              <div class="filter-links">
                <section>
                  <h2>人気サークル</h2>
                  <div class="tags filter-tags">${circles.map((item) => `<a href="${siteFilterUrl({ q: filters.q, circle: item.value, author: filters.author, genres: filters.genres })}" title="${formatCount(item.count)}件">${escapeHtml(item.value)}</a>`).join("") || "<span>未登録</span>"}</div>
                </section>
                <section>
                  <h2>人気作者</h2>
                  <div class="tags filter-tags">${authors.map((item) => `<a href="${siteFilterUrl({ q: filters.q, circle: filters.circle, author: item.value, genres: filters.genres })}" title="${formatCount(item.count)}件">${escapeHtml(item.value)}</a>`).join("") || "<span>未登録</span>"}</div>
                </section>
                <section>
                  <h2>人気ジャンル</h2>
                  <div class="tags filter-tags">${genres.map((item) => renderGenreFilterLink(item.value, filters, item.count)).join("") || "<span>未登録</span>"}</div>
                </section>
              </div>
            </div>
          </details>
        </aside>
        <section class="post-grid">
          ${cards || "<p>記事はまだありません。</p>"}
          ${pagination}
        </section>
      </div>
    </main>
  `, {
    description: seoDescription,
    canonicalUrl,
    jsonLd,
    ogType: "website",
  });
}

function siteIndexHeading(filters = {}) {
  const parts = [];
  if (filters.q) parts.push(`「${filters.q}」検索`);
  if (filters.circle) parts.push(`${filters.circle}`);
  if (filters.author) parts.push(`${filters.author}`);
  if ((filters.genres || []).length) parts.push(`${filters.genres.join("・")}`);
  if (parts.length) return `${parts.join(" / ")}の同人誌・エロ漫画`;
  return "同人誌・エロ漫画レビュー一覧";
}

function siteIndexSeoTitle(filters = {}, page = 1) {
  const pageSuffix = page > 1 ? ` ${page}ページ目` : "";
  return `${siteIndexHeading(filters)}${pageSuffix} | ${SITE_NAME}`;
}

function siteIndexSeoDescription(filters = {}, matchedCount = 0, totalCount = 0) {
  const target = siteIndexHeading(filters);
  const countText = hasActiveFilters(filters)
    ? `${formatCount(matchedCount)}件の該当作品`
    : `${formatCount(totalCount)}件の掲載作品`;
  return truncateText(
    `${target}を${countText}から探せます。サークル、作者、ジャンル、試し読みで確認したいポイントを整理した大人向け作品紹介サイトです。`,
    155
  );
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

function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</gu, "\\u003c")
    .replace(/>/gu, "\\u003e")
    .replace(/&/gu, "\\u0026")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
}

function renderPolicyPage(options = {}) {
  const canonicalUrl = options.origin ? absoluteSiteUrl(options.origin, "/site/policy") : "";
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
  `, {
    description: `${SITE_NAME}の運営情報、広告リンク、画像掲載、プライバシー、免責事項についてまとめています。`,
    canonicalUrl,
    robots: "index,follow",
  });
}

function renderContactPage(state = {}) {
  const values = state.values || {};
  const errors = state.errors || [];
  const success = Boolean(state.success);
  const canonicalUrl = state.origin ? absoluteSiteUrl(state.origin, "/site/contact") : "";
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
  `, {
    description: `${SITE_NAME}への掲載内容、権利関係、サイト運営に関するお問い合わせページです。`,
    canonicalUrl,
    robots: "noindex,follow",
  });
}

async function handleContactSubmit(request, env) {
  const url = new URL(request.url);
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
    return sendHtml(renderContactPage({ values, errors, origin: url.origin }), 400);
  }

  await ensureContactMessagesTable(env);
  await env.DB.prepare(
    "INSERT INTO contact_messages (id, created_at, name, email, message) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(crypto.randomUUID(), new Date().toISOString(), values.name, values.email, values.message)
    .run();

  return sendHtml(renderContactPage({ success: true, origin: url.origin }));
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
  const origin = options.origin || "";
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
  const canonicalUrl = origin ? absoluteSiteUrl(origin, `/site/posts/${encodeURIComponent(metadata.slug)}`) : "";
  const description = articleSeoDescription(metadata);
  const seoTitle = `${metadata.title}のレビュー・試し読み情報 | ${SITE_NAME}`;
  const jsonLd = origin && !options.preview
    ? articleJsonLd(metadata, {
        url: canonicalUrl,
        imageUrl: metadata.thumbnail_url,
      })
    : null;

  return pageShell(seoTitle, `
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
  `, {
    description,
    canonicalUrl,
    imageUrl: metadata.thumbnail_url,
    jsonLd,
    ogType: "article",
    robots: options.preview ? "noindex,nofollow,noarchive" : "index,follow,max-image-preview:large",
  });
}

function articleSeoDescription(metadata = {}) {
  const details = [];
  if (metadata.circle_name) details.push(`サークル: ${metadata.circle_name}`);
  if (metadata.author_name) details.push(`作者: ${metadata.author_name}`);
  if ((metadata.genres || []).length) details.push(`ジャンル: ${(metadata.genres || []).slice(0, 6).join("、")}`);
  const excerpt = String(metadata.excerpt || "").trim();
  const prefix = `${metadata.title || metadata.product_title || "同人作品"}のレビュー・試し読み情報。`;
  return truncateText(`${prefix}${details.join(" / ")}${details.length ? "。 " : ""}${excerpt}`, 155);
}

function articleJsonLd(metadata = {}, options = {}) {
  const url = options.url || "";
  const imageUrl = options.imageUrl || metadata.thumbnail_url || "";
  const about = [
    metadata.circle_name,
    metadata.author_name,
    ...(metadata.genres || []),
  ].filter(Boolean);
  const data = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": url,
    },
    headline: metadata.title || metadata.product_title || "",
    description: articleSeoDescription(metadata),
    datePublished: metadata.published_at || metadata.updated_at || undefined,
    dateModified: metadata.updated_at || metadata.published_at || undefined,
    author: {
      "@type": "Organization",
      name: SITE_OPERATOR_NAME,
    },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
    },
    isAccessibleForFree: true,
  };
  if (imageUrl) data.image = [imageUrl];
  if (about.length) data.about = about.map((name) => ({ "@type": "Thing", name }));
  return data;
}

function collectionJsonLd(options = {}) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: options.title || SITE_NAME,
    description: options.description || "",
    url: options.url || "",
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: absoluteSiteUrl(options.origin || "", "/site"),
    },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: (options.articles || []).map((article, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: absoluteSiteUrl(options.origin || "", `/site/posts/${encodeURIComponent(article.slug)}`),
        name: article.title,
      })),
    },
  };
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

function renderCountSummary(visibleCount, totalCount, filters, pagination = {}) {
  const hasFilters = hasActiveFilters(filters);
  const matchedText = hasFilters
    ? ` / 条件一致 <strong>${formatCount(pagination.matchedCount || 0)}</strong>件`
    : "";
  const pageText = ` / ${formatCount(pagination.page || 1)}ページ目`;
  return `<p class="site-count">現在の作品数 <strong>${formatCount(totalCount)}</strong>件${matchedText} / 表示中 <strong>${formatCount(visibleCount)}</strong>件${pageText}</p>`;
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

function truncateText(value, maxLength = 155) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
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

function absoluteSiteUrl(origin, path) {
  if (!origin) return String(path || "");
  try {
    return new URL(path || "/", origin).href;
  } catch {
    return `${String(origin).replace(/\/$/u, "")}/${String(path || "").replace(/^\//u, "")}`;
  }
}

function siteFilterUrl(params = {}) {
  const search = new URLSearchParams();
  for (const key of ["q", "circle", "author"]) {
    if (params[key]) search.set(key, params[key]);
  }
  for (const genre of normalizeFilterValues(params.genres ?? params.genre).slice(0, SITE_MAX_GENRE_FILTERS)) {
    search.append("genre", genre);
  }
  const page = positiveInteger(params.page, 1);
  if (page > 1) search.set("page", String(page));
  const query = search.toString();
  return query ? `/site?${query}` : "/site";
}

function renderPagination({ filters, page, pageCount, totalCount, pageSize }) {
  if (totalCount <= pageSize && pageCount <= 1) return "";

  const start = totalCount ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(page * pageSize, totalCount);
  const prevHref = page > 1 ? siteFilterUrl({ ...filters, page: page - 1 }) : "";
  const nextHref = page < pageCount ? siteFilterUrl({ ...filters, page: page + 1 }) : "";

  return `
          <nav class="pagination" aria-label="作品一覧ページ">
            <p>${formatCount(start)}-${formatCount(end)} / ${formatCount(totalCount)}件</p>
            <div class="pagination-actions">
              ${prevHref ? `<a href="${prevHref}" rel="prev">前の20件</a>` : '<span aria-disabled="true">前の20件</span>'}
              <span>${formatCount(page)} / ${formatCount(pageCount)}</span>
              ${nextHref ? `<a href="${nextHref}" rel="next">次の20件</a>` : '<span aria-disabled="true">次の20件</span>'}
            </div>
          </nav>
  `;
}

function renderGenreTags(genres, filters = {}) {
  return [...genres].map((genre) => renderGenreFilterLink(genre, filters)).join("");
}

function renderGenreFilterLink(genre, filters = {}, count = 0) {
  const selectedGenres = filters.genres || [];
  const active = selectedGenres.includes(genre);
  if (!active && selectedGenres.length >= SITE_MAX_GENRE_FILTERS) {
    return `<span class="filter-disabled" title="ジャンルは最大${SITE_MAX_GENRE_FILTERS}件まで指定できます">${escapeHtml(genre)}</span>`;
  }
  const nextGenres = active
    ? selectedGenres.filter((selected) => selected !== genre)
    : [...selectedGenres, genre];
  const href = siteFilterUrl({
    q: filters.q,
    circle: filters.circle,
    author: filters.author,
    genres: nextGenres,
  });
  const title = count ? ` title="${formatCount(count)}件"` : "";
  return `<a class="${active ? "active" : ""}" href="${href}"${title}>${escapeHtml(genre)}</a>`;
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

function pageShell(title, body, options = {}) {
  const description = truncateText(options.description || `${SITE_NAME}は大人向け同人誌・エロ漫画の作品情報、ジャンル、サークル、試し読み確認ポイントを整理する紹介サイトです。`, 155);
  const canonicalUrl = String(options.canonicalUrl || "").trim();
  const imageUrl = String(options.imageUrl || "").trim();
  const robots = String(options.robots || "index,follow,max-image-preview:large").trim();
  const ogType = String(options.ogType || "website").trim();
  const jsonLd = options.jsonLd ? `<script type="application/ld+json">${jsonForScript(options.jsonLd)}</script>` : "";
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="${escapeHtml(robots)}">
  <meta name="rating" content="adult">
  ${canonicalUrl ? `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">` : ""}
  <meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">
  <meta property="og:type" content="${escapeHtml(ogType)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  ${canonicalUrl ? `<meta property="og:url" content="${escapeHtml(canonicalUrl)}">` : ""}
  ${imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}">` : ""}
  <meta name="twitter:card" content="${imageUrl ? "summary_large_image" : "summary"}">
  <link rel="stylesheet" href="/admin.css">
  ${jsonLd}
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

async function cachedPublicResponse(cacheUrl, ctx, createResponse) {
  if (typeof caches === "undefined" || !caches.default) {
    return createResponse();
  }

  const cacheKey = new Request(cacheUrl, { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  const response = await createResponse();
  if (response.ok) {
    const cacheWrite = caches.default.put(cacheKey, response.clone()).catch((error) => {
      console.warn(JSON.stringify({ level: "warn", message: "cache write failed", error: error.message }));
    });
    if (ctx?.waitUntil) {
      ctx.waitUntil(cacheWrite);
    } else {
      await cacheWrite;
    }
  }
  return response;
}

function publicCacheControl(seconds) {
  return `public, max-age=${seconds}, stale-while-revalidate=${Math.max(seconds, 86400)}`;
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

function sendPublicJson(payload, cacheSeconds) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": publicCacheControl(cacheSeconds),
      "X-Robots-Tag": "noindex",
    },
  });
}

function sendHtml(html, status = 200, cacheControl = "no-store") {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": cacheControl,
    },
  });
}

function sendXml(xml, status = 200) {
  return new Response(xml, {
    status,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
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

function boundedPositiveInteger(value, fallback, max) {
  const number = Number(value);
  const fallbackNumber = Number(fallback);
  const resolved = Number.isInteger(number) && number > 0 ? number : fallbackNumber;
  const safeValue = Number.isInteger(resolved) && resolved > 0 ? resolved : 1;
  return Math.min(safeValue, max);
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

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

function escapeBreakableText(value) {
  return [...String(value ?? "")].map((character) => escapeHtml(character)).join("<wbr>");
}
