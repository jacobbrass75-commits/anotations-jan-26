import { mkdirSync } from "fs";
import { join, dirname } from "path";
import { spawnSync } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const drizzleKitEntrypoint = join(dirname(require.resolve("drizzle-kit")), "bin.cjs");

mkdirSync(join(process.cwd(), "data"), { recursive: true });

const drizzleResult = spawnSync(
  process.execPath,
  [drizzleKitEntrypoint, "push", "--config", "drizzle.config.ts"],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  }
);

if ((drizzleResult.status ?? 1) !== 0) {
  process.exit(drizzleResult.status ?? 1);
}

const { sqlite } = await import("../server/db");

const requiredTables = [
  "documents",
  "users",
  "projects",
  "project_documents",
  "web_clips",
  "conversations",
  "api_keys",
  "mcp_tokens",
  "analytics_tool_calls",
  "ocr_jobs",
];

const existingTables = new Set(
  (sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>)
    .map((row) => row.name)
);

const missingTables = requiredTables.filter((table) => !existingTables.has(table));

if (missingTables.length > 0) {
  console.error(`[bootstrap-db] missing required tables: ${missingTables.join(", ")}`);
  process.exit(1);
}

sqlite.close();

console.log("[bootstrap-db] schema bootstrap complete");
