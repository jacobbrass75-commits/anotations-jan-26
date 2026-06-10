import { mkdirSync } from "fs";
import { join, dirname } from "path";
import { spawnSync } from "child_process";
import { createRequire } from "module";
import Database from "better-sqlite3";

const require = createRequire(import.meta.url);
const drizzleKitEntrypoint = join(dirname(require.resolve("drizzle-kit")), "bin.cjs");
const databasePath = join(process.cwd(), "data", "sourceannotator.db");

mkdirSync(join(process.cwd(), "data"), { recursive: true });

const bootstrapSqlite = new Database(databasePath);
bootstrapSqlite.exec(`
CREATE TABLE IF NOT EXISTS writing_styles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  voice_profile TEXT NOT NULL,
  samples TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS writing_styles_user_name_idx
ON writing_styles(user_id, name);
CREATE INDEX IF NOT EXISTS idx_writing_styles_user_updated
ON writing_styles(user_id, updated_at DESC);
`);
bootstrapSqlite.close();

const drizzleResult = spawnSync(
  process.execPath,
  [drizzleKitEntrypoint, "push", "--config", "drizzle.config.ts"],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  },
);

if ((drizzleResult.status ?? 1) !== 0) {
  process.exit(drizzleResult.status ?? 1);
}

const { sqlite } = await import("../server/db");

const requiredTables = [
  "documents",
  "users",
  "projects",
  "writing_styles",
  "project_documents",
  "web_clips",
  "conversations",
  "api_keys",
  "mcp_tokens",
  "analytics_tool_calls",
  "ocr_jobs",
];

const existingTables = new Set(
  (
    sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
      name: string;
    }>
  ).map((row) => row.name),
);

const missingTables = requiredTables.filter((table) => !existingTables.has(table));

if (missingTables.length > 0) {
  console.error(`[bootstrap-db] missing required tables: ${missingTables.join(", ")}`);
  process.exit(1);
}

sqlite.close();

console.log("[bootstrap-db] schema bootstrap complete");
