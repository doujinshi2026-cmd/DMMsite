import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PROJECT_ROOT = path.resolve(__dirname, "..");
export const POSTS_DIR = path.join(PROJECT_ROOT, "content", "posts");
export const UPLOADS_DIR = path.join(PROJECT_ROOT, "public", "uploads");

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const STATUS_VALUES = new Set(["draft", "ready", "published", "archived"]);
const TYPE_VALUES = new Set(["review", "column", "news", "list"]);
const RIGHTS_VALUES = new Set(["pending_review", "approved_ad_material", "link_only"]);

export async function ensureContentDirs() {
  await fs.mkdir(POSTS_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

export function slugify(value) {
  const base = String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return base || `post-${formatDateSlug(new Date())}`;
}

function validateSlug(slug) {
  if (!slug || slug === "." || slug === "..") {
    throw new Error("slug is required.");
  }
  if (slug.length > 100) {
    throw new Error("slug must be 100 characters or less.");
  }
  if (/[<>:"/\\|?*\x00-\x1f]/u.test(slug)) {
    throw new Error("slug contains characters that cannot be used in a file name.");
  }
}

function articlePath(slug) {
  validateSlug(slug);
  const filePath = path.resolve(POSTS_DIR, `${slug}.md`);
  const root = path.resolve(POSTS_DIR);
  if (!filePath.startsWith(root + path.sep)) {
    throw new Error("resolved article path escaped content/posts.");
  }
  return filePath;
}

function parseFrontmatterValue(raw) {
  const value = raw.trim();
  if (value === "") return "";
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/u.test(value)) return Number(value);

  try {
    return JSON.parse(value);
  } catch {
    return value.replace(/^["']|["']$/g, "");
  }
}

function parseFrontmatterBlock(block) {
  const metadata = {};
  for (const line of block.split(/\r?\n/u)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const index = line.indexOf(":");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const rawValue = line.slice(index + 1);
    if (key) metadata[key] = parseFrontmatterValue(rawValue);
  }
  return metadata;
}

function serializeFrontmatter(metadata) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) continue;
    lines.push(`${key}: ${JSON.stringify(value ?? "")}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

export function parseArticleMarkdown(markdown, fallbackSlug = "") {
  const match = String(markdown || "").match(FRONTMATTER_RE);
  if (!match) {
    return {
      metadata: { slug: fallbackSlug, title: fallbackSlug || "Untitled", status: "draft" },
      body: String(markdown || ""),
    };
  }

  const metadata = parseFrontmatterBlock(match[1]);
  metadata.genres = normalizeList(metadata.genres);
  metadata.emotions = normalizeList(metadata.emotions);
  metadata.sample_images = normalizeList(metadata.sample_images);
  metadata.weekly_pick = Boolean(metadata.weekly_pick);
  metadata.weekly_pick_order = toInteger(metadata.weekly_pick_order, 0);
  metadata.editor_note = String(metadata.editor_note || "").trim();
  return {
    metadata: {
      slug: fallbackSlug,
      title: fallbackSlug || "Untitled",
      status: "draft",
      ...metadata,
    },
    body: String(markdown || "").slice(match[0].length),
  };
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

export function normalizeArticle(input, existing = {}) {
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

  const metadata = {
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

  return {
    metadata,
    body: String(input.body || "").replace(/\r\n/g, "\n").trimEnd() + "\n",
  };
}

export async function readArticle(slug) {
  await ensureContentDirs();
  const filePath = articlePath(slug);
  const markdown = await fs.readFile(filePath, "utf8");
  const article = parseArticleMarkdown(markdown, slug);
  return {
    ...article,
    markdown,
    file_path: path.relative(PROJECT_ROOT, filePath),
  };
}

export async function listArticles() {
  await ensureContentDirs();
  const entries = await fs.readdir(POSTS_DIR, { withFileTypes: true });
  const articles = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === ".gitkeep") continue;
    const slug = entry.name.slice(0, -3);
    const filePath = path.join(POSTS_DIR, entry.name);
    const markdown = await fs.readFile(filePath, "utf8");
    const { metadata, body } = parseArticleMarkdown(markdown, slug);
    const stat = await fs.stat(filePath);
    articles.push({
      ...metadata,
      slug: metadata.slug || slug,
      body_chars: body.length,
      file_path: path.relative(PROJECT_ROOT, filePath),
      file_updated_at: stat.mtime.toISOString(),
    });
  }

  return articles.sort((a, b) => {
    const left = a.updated_at || a.published_at || a.file_updated_at || "";
    const right = b.updated_at || b.published_at || b.file_updated_at || "";
    return right.localeCompare(left);
  });
}

export async function saveArticle(input) {
  await ensureContentDirs();

  const oldSlug = input.old_slug ? slugify(input.old_slug) : "";
  let existing = {};
  if (oldSlug) {
    try {
      existing = (await readArticle(oldSlug)).metadata;
    } catch {
      existing = {};
    }
  }

  const { metadata, body } = normalizeArticle(input, existing);
  const markdown = `${serializeFrontmatter(metadata)}${body}`;
  const targetPath = articlePath(metadata.slug);

  if ((!oldSlug || oldSlug !== metadata.slug) && await exists(targetPath)) {
    throw new Error(`article already exists: ${metadata.slug}`);
  }

  if (oldSlug && oldSlug !== metadata.slug) {
    const oldPath = articlePath(oldSlug);
    try {
      await fs.unlink(oldPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  await fs.writeFile(targetPath, markdown, "utf8");
  return {
    metadata,
    markdown,
    file_path: path.relative(PROJECT_ROOT, targetPath),
  };
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function markdownToHtml(markdown, options = {}) {
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#039;");
}

function formatDateSlug(date) {
  const pad = (number) => String(number).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function sanitizeMediaName(filename) {
  const parsed = path.parse(String(filename || "image"));
  const ext = parsed.ext.toLowerCase();
  const allowed = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]);
  if (!allowed.has(ext)) {
    throw new Error("image extension must be png, jpg, jpeg, webp, gif, or avif.");
  }
  const base = slugify(parsed.name).slice(0, 60) || "image";
  return `${formatDateSlug(new Date())}-${base}${ext}`;
}

export async function saveMedia(input) {
  await ensureContentDirs();

  const match = String(input.data_url || "").match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/iu);
  if (!match) {
    throw new Error("data_url must be a base64 image data URL.");
  }

  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error("image must be between 1 byte and 10 MB.");
  }

  const now = new Date();
  const pad = (number) => String(number).padStart(2, "0");
  const relativeDir = path.join(String(now.getFullYear()), pad(now.getMonth() + 1));
  const targetDir = path.join(UPLOADS_DIR, relativeDir);
  await fs.mkdir(targetDir, { recursive: true });

  const filename = sanitizeMediaName(input.filename);
  const targetPath = path.join(targetDir, filename);
  await fs.writeFile(targetPath, buffer);

  const url = `/uploads/${relativeDir.replace(/\\/gu, "/")}/${filename}`;
  return {
    url,
    filename,
    alt: String(input.alt || "").trim(),
    file_path: path.relative(PROJECT_ROOT, targetPath),
    bytes: buffer.length,
  };
}

export async function listMedia() {
  await ensureContentDirs();
  const files = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(filePath);
        continue;
      }
      if (!entry.isFile() || entry.name === ".gitkeep") continue;
      const stat = await fs.stat(filePath);
      const relative = path.relative(UPLOADS_DIR, filePath).replace(/\\/gu, "/");
      files.push({
        url: `/uploads/${relative}`,
        filename: entry.name,
        file_path: path.relative(PROJECT_ROOT, filePath),
        bytes: stat.size,
        updated_at: stat.mtime.toISOString(),
      });
    }
  }

  await walk(UPLOADS_DIR);
  return files.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}
