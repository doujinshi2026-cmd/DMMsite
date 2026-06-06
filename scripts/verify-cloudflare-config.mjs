import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const WRANGLER_PATH = path.join(PROJECT_ROOT, "wrangler.jsonc");
const PLACEHOLDER_DATABASE_ID = "00000000-0000-0000-0000-000000000000";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const EXPECTED_CRONS = ["10 22 * * *", "10 3 * * *", "10 12 * * *", "10 15 * * *"];

const config = JSON.parse(stripJsonc(await fs.readFile(WRANGLER_PATH, "utf8")));
const database = (config.d1_databases || []).find((item) => item.binding === "DB");
const crons = config.triggers?.crons || [];

if (!database) {
  fail("wrangler.jsonc に D1 binding DB がありません。");
}

if (!database.database_id || database.database_id === PLACEHOLDER_DATABASE_ID) {
  fail(
    [
      "wrangler.jsonc の database_id が仮値のままです。",
      "",
      "先に次を実行してください:",
      "  npm run cf:d1:create",
      "",
      "出力される database_id を wrangler.jsonc の",
      `  ${PLACEHOLDER_DATABASE_ID}`,
      "と置き換えてください。",
    ].join("\n")
  );
}

if (!UUID_RE.test(database.database_id)) {
  fail(`database_id の形式が想定外です: ${database.database_id}`);
}

for (const cron of EXPECTED_CRONS) {
  if (!crons.includes(cron)) {
    fail(
      `wrangler.jsonc の Cron に ${cron} がありません。` +
        `日本時間07:10/12:10/21:10/00:10更新には ${EXPECTED_CRONS.join(", ")} が必要です。`
    );
  }
}

console.log(
  `Cloudflare config OK: DB=${database.database_name} (${database.database_id}), Cron=${crons.join(", ")}`
);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function stripJsonc(value) {
  return String(value)
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/(^|[^:])\/\/.*$/gmu, "$1");
}
