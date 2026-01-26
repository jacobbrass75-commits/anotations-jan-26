import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "@shared/schema";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";

// Database file path
const DB_PATH = "./data/sourceannotator.db";

// Ensure data directory exists
const dataDir = dirname(DB_PATH);
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

// Create SQLite database connection
const sqlite = new Database(DB_PATH);

// Enable foreign keys
sqlite.pragma("foreign_keys = ON");

// Export the drizzle database instance
export const db = drizzle(sqlite, { schema });

// Export the raw sqlite connection for direct queries if needed
export { sqlite };

// Verify that required tables exist in the database.
// If tables are missing, log a clear error so the developer knows to run db:push.
const REQUIRED_TABLES = ["projects", "documents", "folders", "project_documents", "project_annotations", "prompt_templates", "text_chunks", "annotations", "users"];

export function checkDatabaseHealth(): { ok: boolean; missing: string[] } {
  const existing = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as { name: string }[];
  const existingNames = new Set(existing.map((t) => t.name));
  const missing = REQUIRED_TABLES.filter((t) => !existingNames.has(t));
  if (missing.length > 0) {
    console.error(
      `[DB] Missing tables: ${missing.join(", ")}. Run "npm run db:push" to create them.`
    );
    return { ok: false, missing };
  }
  return { ok: true, missing: [] };
}
