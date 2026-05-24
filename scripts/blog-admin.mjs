import { createServer } from "node:http";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROJECT_ROOT,
  UPLOADS_DIR,
  ensureContentDirs,
  listArticles,
  listMedia,
  markdownToHtml,
  readArticle,
  saveArticle,
  saveMedia,
} from "../lib/content-store.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_DIR = path.join(PROJECT_ROOT, "tools", "blog-admin");
const DEFAULT_PORT = 4173;
const MAX_JSON_BYTES = 14 * 1024 * 1024;

await loadDotEnv(path.join(PROJECT_ROOT, ".env"));

const port = Number(readArg("--port") || process.env.PORT || DEFAULT_PORT);
const host = String(readArg("--host") || process.env.BLOG_CMS_HOST || "127.0.0.1");
const cmsUser = String(process.env.BLOG_CMS_USER || "admin");
const cmsPassword = String(process.env.BLOG_CMS_PASSWORD || "");
const authEnabled = Boolean(cmsPassword);

if (!isLoopbackHost(host) && !authEnabled) {
  throw new Error("BLOG_CMS_PASSWORD is required when Blog CMS is not bound to localhost.");
}

await ensureContentDirs();

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: error.message || "Internal server error" });
  }
});

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use on ${host}.`);
    console.error("Another Blog CMS server may already be running.");
    console.error(`Open http://${host}:${port}/, stop the existing process, or use another port:`);
    console.error("  npm run blog:admin -- --port 4174");
    process.exit(1);
  }
  console.error(error);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`Blog admin: http://${host}:${port}/`);
  console.log(`Auth: ${authEnabled ? `enabled for user ${cmsUser}` : "disabled on localhost only"}`);
  console.log("Press Ctrl+C to stop.");
});

async function loadDotEnv(filePath) {
  let text = "";
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (isCmsRoute(pathname) && !isAuthorized(request)) {
    return sendUnauthorized(response);
  }

  if (request.method === "GET" && pathname === "/") {
    return sendFile(response, path.join(ADMIN_DIR, "index.html"));
  }

  if (request.method === "GET" && pathname === "/admin.css") {
    return sendFile(response, path.join(ADMIN_DIR, "admin.css"));
  }

  if (request.method === "GET" && pathname === "/admin.js") {
    return sendFile(response, path.join(ADMIN_DIR, "admin.js"));
  }

  if (request.method === "GET" && pathname.startsWith("/uploads/")) {
    return sendPublicUpload(response, pathname);
  }

  if (request.method === "GET" && pathname === "/api/articles") {
    return sendJson(response, 200, { articles: await listArticles() });
  }

  if (request.method === "GET" && pathname.startsWith("/api/articles/")) {
    const slug = pathname.slice("/api/articles/".length);
    const article = await readArticle(slug);
    return sendJson(response, 200, article);
  }

  if (request.method === "POST" && pathname === "/api/articles") {
    const input = await readJson(request);
    const saved = await saveArticle(input);
    return sendJson(response, 200, saved);
  }

  if (request.method === "GET" && pathname === "/api/media") {
    return sendJson(response, 200, { media: await listMedia() });
  }

  if (request.method === "POST" && pathname === "/api/media") {
    const input = await readJson(request);
    const saved = await saveMedia(input);
    return sendJson(response, 200, saved);
  }

  if (request.method === "GET" && pathname === "/site") {
    const allArticles = (await listArticles()).filter((article) => article.status !== "archived");
    const filters = {
      q: String(url.searchParams.get("q") || "").trim(),
      circle: String(url.searchParams.get("circle") || "").trim(),
      author: String(url.searchParams.get("author") || "").trim(),
      genres: normalizeFilterValues(url.searchParams.getAll("genre")),
    };
    const articles = allArticles.filter((article) => articleMatchesFilters(article, filters));
    return sendHtml(response, renderSiteIndex(articles, { allArticles, filters }));
  }

  if (request.method === "GET" && pathname.startsWith("/site/posts/")) {
    const slug = pathname.slice("/site/posts/".length);
    const article = await readArticle(slug);
    return sendHtml(response, renderArticlePage(article));
  }

  if (request.method === "GET" && pathname.startsWith("/preview/")) {
    const slug = pathname.slice("/preview/".length);
    const article = await readArticle(slug);
    return sendHtml(response, renderArticlePage(article, { preview: true }));
  }

  sendText(response, 404, "Not found");
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}

function isLoopbackHost(value) {
  return ["127.0.0.1", "localhost", "::1"].includes(String(value).toLowerCase());
}

function isCmsRoute(pathname) {
  return (
    pathname === "/" ||
    pathname === "/admin.js" ||
    pathname === "/api/articles" ||
    pathname.startsWith("/api/articles/") ||
    pathname === "/api/media" ||
    pathname.startsWith("/preview/")
  );
}

function isAuthorized(request) {
  if (!authEnabled) return isLoopbackRequestHost(request);

  const header = request.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;

  try {
    const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator === -1) return false;
    const user = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    return timingSafeEqual(user, cmsUser) && timingSafeEqual(password, cmsPassword);
  } catch {
    return false;
  }
}

function isLoopbackRequestHost(request) {
  const hostHeader = String(request.headers.host || "").toLowerCase();
  const hostname = hostHeader.startsWith("[::1]")
    ? "::1"
    : hostHeader.split(":")[0];
  return isLoopbackHost(hostname);
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return cryptoTimingSafeEqual(leftBuffer, rightBuffer);
}

function cryptoTimingSafeEqual(leftBuffer, rightBuffer) {
  try {
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
  } catch {
    return false;
  }
}

async function readJson(request) {
  const chunks = [];
  let total = 0;

  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_JSON_BYTES) {
      throw new Error("Request body is too large.");
    }
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8") || "{}";
  return JSON.parse(body);
}

async function sendFile(response, filePath) {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(PROJECT_ROOT) + path.sep)) {
    return sendText(response, 403, "Forbidden");
  }

  try {
    const body = await fs.readFile(resolved);
    response.writeHead(200, {
      "Content-Type": contentTypeFor(resolved),
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch (error) {
    if (error.code === "ENOENT") return sendText(response, 404, "Not found");
    throw error;
  }
}

async function sendPublicUpload(response, pathname) {
  const relative = pathname.replace(/^\/uploads\//u, "");
  const filePath = path.resolve(UPLOADS_DIR, relative);
  if (!filePath.startsWith(path.resolve(UPLOADS_DIR) + path.sep)) {
    return sendText(response, 403, "Forbidden");
  }
  return sendFile(response, filePath);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendHtml(response, html) {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(html);
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(message);
}

function sendUnauthorized(response) {
  response.writeHead(401, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "WWW-Authenticate": 'Basic realm="Blog CMS", charset="UTF-8"',
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  });
  response.end("Authentication required.");
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".avif": "image/avif",
  }[ext] || "application/octet-stream";
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
            <h2><a href="/site/posts/${encodeURIComponent(article.slug)}">${escapeBreakableText(article.title)}</a></h2>
            ${circleLink || authorLink ? `<p class="work-meta">${circleLink}${circleLink && authorLink ? " / " : ""}${authorLink}</p>` : ""}
            <p class="post-excerpt">${escapeHtml(article.excerpt || "本文の抜粋はまだありません。")}</p>
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
      <p><a href="${options.preview ? "/" : "/site"}">← 戻る</a></p>
      ${options.preview ? '<p class="preview-banner">Preview</p>' : ""}
      <article>
        <header class="site-header">
          <p>18歳未満閲覧禁止 / ${escapeHtml(metadata.pr_label || "PR")}</p>
          <h1>${escapeBreakableText(metadata.title)}</h1>
          ${circleLink || authorLink ? `<p class="work-meta">${circleLink}${circleLink && authorLink ? " / " : ""}${authorLink}</p>` : ""}
          <div class="tags">${labels}</div>
        </header>
        ${heroImage}
        ${renderWorkComment(metadata.excerpt)}
        <div class="article-body">${body}</div>
        ${productLink ? `<p class="cta"><a href="${escapeHtml(productLink)}" target="_blank" rel="sponsored noopener noreferrer">作品ページを確認する</a></p>` : ""}
      </article>
    </main>
  `);
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
  return [...genres]
    .map((genre) => {
      return renderGenreFilterLink(genre, filters);
    })
    .join("");
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
