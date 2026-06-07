import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROTECTED_MAKERS,
  WORK_SELECTION_POLICY,
  WORK_SELECTION_SOURCE_KEYS,
} from "../src/work-selection-policy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const REPORT_PATH = path.join(PROJECT_ROOT, "logs", "work-selection-plan.json");
const DELETION_CSV_PATH = path.join(PROJECT_ROOT, "logs", "work-selection-deletion-candidates.csv");
const DEFAULT_URL = "https://dmmsite.doujinshi2026.workers.dev";
const PRUNE_CONFIRMATION = "DELETE_UNSELECTED_WORKS";

await loadDotEnv(path.join(PROJECT_ROOT, ".env"));

const command = process.argv[2] || "plan";
const dryRun = process.argv.includes("--dry-run");
const baseUrl = String(process.env.CLOUDFLARE_WORKER_URL || DEFAULT_URL).replace(/\/$/u, "");
const user = String(process.env.BLOG_CMS_USER || "admin");
const password = String(process.env.BLOG_CMS_PASSWORD || "");

if (!password) {
  throw new Error("BLOG_CMS_PASSWORD is missing. Set it in .env.");
}

if (command === "plan") {
  await savePlanReport(await apiRequest("/api/works/selection-plan"));
} else if (command === "sync") {
  await syncSelections();
  await savePlanReport(await apiRequest("/api/works/selection-plan"));
} else if (command === "prune") {
  const confirmation = readArg("--confirm");
  if (confirmation !== PRUNE_CONFIRMATION) {
    throw new Error(`Run plan first, then pass --confirm ${PRUNE_CONFIRMATION}`);
  }
  await savePlanReport(await apiRequest("/api/works/selection-plan"));
  const result = await apiRequest(
    `/api/works/prune?confirm=${encodeURIComponent(confirmation)}`,
    { method: "POST" }
  );
  console.log(JSON.stringify(result, null, 2));
} else {
  throw new Error(`Unknown command: ${command}. Use plan, sync, or prune.`);
}

async function syncSelections() {
  const bootstrap = WORK_SELECTION_POLICY.bootstrap;
  const recurring = WORK_SELECTION_POLICY.recurring;
  const protectedImport = WORK_SELECTION_POLICY.protected_maker_import;
  const currentPlan = await apiRequest("/api/works/selection-plan");
  const bootstrapCount = Number(
    currentPlan.counts?.memberships_by_source?.[WORK_SELECTION_SOURCE_KEYS.bootstrapRank] || 0
  );

  if (bootstrapCount < bootstrap.limit || process.argv.includes("--force-bootstrap")) {
    await runImport("bootstrap-rank-500", {
      dryRun,
      sort: bootstrap.sort,
      media: bootstrap.media,
      offset: bootstrap.offset,
      limit: bootstrap.limit,
      hits: bootstrap.hits,
      pageLimit: bootstrap.page_limit,
      selectionSource: bootstrap.source_key,
    });
  } else {
    console.log(
      JSON.stringify(
        {
          label: "bootstrap-rank-500",
          status: "skipped-already-initialized",
          memberships: bootstrapCount,
        },
        null,
        2
      )
    );
  }

  for (const maker of PROTECTED_MAKERS) {
    await runImport(`protected-maker:${maker}`, {
      dryRun,
      sort: protectedImport.sort,
      media: protectedImport.media,
      limit: 100,
      hits: protectedImport.hits,
      pageLimit: protectedImport.page_limit,
      keyword: maker,
      exactMaker: maker,
      selectionSource: WORK_SELECTION_SOURCE_KEYS.protectedMaker,
    });
  }

  await runImport("recurring-rank-100", {
    dryRun,
    sort: recurring.sort,
    media: recurring.media,
    offset: recurring.offset,
    limit: recurring.limit,
    hits: recurring.hits,
    pageLimit: recurring.page_limit,
    selectionSource: recurring.source_key,
    replaceSelection: true,
  });
}

async function runImport(label, options) {
  const search = new URLSearchParams();
  if (options.dryRun) search.set("dryRun", "1");
  for (const [key, value] of Object.entries(options)) {
    if (key === "dryRun" || key === "replaceSelection" || value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  if (options.replaceSelection) search.set("replaceSelection", "1");

  const payload = await apiRequest(`/api/dmm/import?${search.toString()}`, {
    timeoutMs: 300000,
  });
  const summary = {
    label,
    dry_run: payload.dry_run,
    selection_source: payload.selection_source,
    exact_maker: payload.exact_maker,
    total_count: payload.total_count,
    fetched: payload.fetched,
    filtered: payload.filtered,
    seen: payload.seen,
    created: payload.created,
    updated: payload.updated,
    skipped: payload.skipped,
    failed: payload.failed,
    selection_removed: payload.selection_removed,
    counts_before: payload.counts_before,
    counts_after: payload.counts_after,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (payload.failed) {
    throw new Error(`${label} failed for ${payload.failed} item(s).`);
  }
}

async function savePlanReport(plan) {
  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  await fs.writeFile(DELETION_CSV_PATH, deletionCandidatesCsv(plan), "utf8");
  console.log(
    JSON.stringify(
      {
        report: REPORT_PATH,
        deletion_candidates_csv: DELETION_CSV_PATH,
        generated_at: plan.generated_at,
        counts: plan.counts,
        unsupported_api_conditions: plan.policy?.unsupported_api_conditions || [],
      },
      null,
      2
    )
  );
}

function deletionCandidatesCsv(plan) {
  const columns = [
    "slug",
    "title",
    "circle_name",
    "author_name",
    "product_id",
    "source_type",
    "status",
    "updated_at",
  ];
  const lines = [columns.join(",")];
  for (const item of plan.deletion_candidates || []) {
    lines.push(columns.map((column) => csvCell(item[column])).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/gu, '""')}"`;
}

async function apiRequest(pathname, options = {}) {
  const authorization = Buffer.from(`${user}:${password}`).toString("base64");
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Basic ${authorization}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(options.timeoutMs || 60000),
  });
  const payload = await response.json().catch(async () => ({ raw: await response.text() }));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
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
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].trim().replace(/^["']|["']$/gu, "");
  }
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : process.argv[index + 1] || "";
}
