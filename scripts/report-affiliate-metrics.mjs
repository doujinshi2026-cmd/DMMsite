import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const defaultUrl = "https://dmmsite.doujinshi2026.workers.dev";

await loadDotEnv(path.join(projectRoot, ".env"));

const days = Math.max(1, Math.min(365, Number(readArg("--days") || 30)));
const baseUrl = String(process.env.CLOUDFLARE_WORKER_URL || defaultUrl).replace(/\/$/u, "");
const user = String(process.env.BLOG_CMS_USER || "admin");
const password = String(process.env.BLOG_CMS_PASSWORD || "");
if (!password) throw new Error("BLOG_CMS_PASSWORD is missing. Set it in .env.");

const response = await fetch(`${baseUrl}/api/affiliate/metrics?days=${days}`, {
  headers: {
    Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
    Accept: "application/json",
  },
});
const report = await response.json().catch(async () => ({ raw: await response.text() }));
if (!response.ok) {
  throw new Error(`Metrics API failed (${response.status}): ${JSON.stringify(report)}`);
}

const logsDir = path.join(projectRoot, "logs");
await fs.mkdir(logsDir, { recursive: true });
await Promise.all([
  fs.writeFile(
    path.join(logsDir, "affiliate-metrics-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  ),
  fs.writeFile(
    path.join(logsDir, "affiliate-metrics-placements.csv"),
    toCsv(report.totals || [], ["placement", "variant", "impressions", "clicks", "ctr_percent"]),
    "utf8"
  ),
  fs.writeFile(
    path.join(logsDir, "affiliate-metrics-articles.csv"),
    toCsv(
      report.top_articles || [],
      ["article_slug", "title", "circle_name", "impressions", "clicks", "ctr_percent"]
    ),
    "utf8"
  ),
]);

console.log(
  JSON.stringify(
    {
      generated_at: report.generated_at,
      days: report.days,
      placements: report.totals?.length || 0,
      measured_articles: report.top_articles?.length || 0,
      output: [
        "logs/affiliate-metrics-report.json",
        "logs/affiliate-metrics-placements.csv",
        "logs/affiliate-metrics-articles.csv",
      ],
    },
    null,
    2
  )
);

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function toCsv(rows, columns) {
  const escapeCell = (value) => {
    const text = String(value ?? "");
    return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
  };
  return `${[
    columns.join(","),
    ...rows.map((row) => columns.map((column) => escapeCell(row[column])).join(",")),
  ].join("\n")}\n`;
}

async function loadDotEnv(filePath) {
  let text;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}
