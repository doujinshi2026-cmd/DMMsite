import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_URL = "https://dmmsite.doujinshi2026.workers.dev";

await loadDotEnv(path.join(PROJECT_ROOT, ".env"));

const dryRun = process.argv.includes("--dry-run");
const summaryOnly = process.argv.includes("--summary-only");
const limit = readArg("--limit");
const hits = readArg("--hits");
const offset = readArg("--offset");
const pageLimit = readArg("--page-limit") || readArg("--page_limit");
const sort = readArg("--sort");
const media = readArg("--media");
const floor = readArg("--floor");
const keyword = readArg("--keyword");
const exactMaker = readArg("--exact-maker") || readArg("--exact_maker");
const selectionSource = readArg("--selection-source") || readArg("--selection_source");
const replaceSelection = process.argv.includes("--replace-selection");
const delayMs = readArg("--delay-ms") || readArg("--delay_ms");
const baseUrl = String(process.env.CLOUDFLARE_WORKER_URL || DEFAULT_URL).replace(/\/$/u, "");
const user = String(process.env.BLOG_CMS_USER || "admin");
const password = String(process.env.BLOG_CMS_PASSWORD || "");

if (!password) {
  throw new Error("BLOG_CMS_PASSWORD is missing. Set it in .env for this local test.");
}

const search = new URLSearchParams();
if (dryRun) search.set("dryRun", "1");
if (limit) search.set("limit", limit);
if (hits) search.set("hits", hits);
if (offset) search.set("offset", offset);
if (pageLimit) search.set("pageLimit", pageLimit);
if (sort) search.set("sort", sort);
if (media) search.set("media", media);
if (floor) search.set("floor", floor);
if (keyword) search.set("keyword", keyword);
if (exactMaker) search.set("exactMaker", exactMaker);
if (selectionSource) search.set("selectionSource", selectionSource);
if (replaceSelection) search.set("replaceSelection", "1");
if (delayMs) search.set("delayMs", delayMs);
const query = search.toString();
const url = `${baseUrl}/api/dmm/import${query ? `?${query}` : ""}`;
const response = await fetch(url, {
  headers: {
    Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
  },
});
const payload = await response.json().catch(async () => ({ raw: await response.text() }));

console.log(JSON.stringify({
  status: response.status,
  ok: response.ok,
  url,
  summary: summarize(payload),
}, null, 2));

if (!response.ok) {
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}

function summarize(payload) {
  return {
    floor: payload.floor,
    sort: payload.sort,
    media: payload.media,
    keyword: payload.keyword,
    exact_maker: payload.exact_maker,
    selection_source: payload.selection_source,
    replace_selection: payload.replace_selection,
    selection_removed: payload.selection_removed,
    offset: payload.offset,
    limit: payload.limit,
    hits: payload.hits,
    page_limit: payload.page_limit,
    api_requests: payload.api_requests,
    total_count: payload.total_count,
    fetched: payload.fetched,
    filtered: payload.filtered,
    seen: payload.seen,
    created: payload.created,
    updated: payload.updated,
    skipped: payload.skipped,
    failed: payload.failed,
    counts_before: payload.counts_before,
    counts_after: payload.counts_after,
    request_delay_ms: payload.request_delay_ms,
    dry_run: payload.dry_run,
    ...(summaryOnly
      ? {}
      : {
          items: (payload.items || []).map((item) => ({
            rank: item.rank,
            product_id: item.product_id,
            title: item.title,
            media_type: item.media_type,
            slug: item.slug,
            status: item.status,
            duplicate: item.duplicate,
            error: item.error,
          })),
        }),
  };
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

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : process.argv[index + 1] || "";
}
