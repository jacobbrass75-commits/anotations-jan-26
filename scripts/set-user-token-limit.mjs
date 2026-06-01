#!/usr/bin/env node
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

function usage() {
  console.error("Usage: npm run user:set-token-limit -- <email-or-user-id> <unlimited|positive-token-limit>");
  process.exit(1);
}

function parseTokenLimit(value) {
  const normalized = value.trim().toLowerCase();
  if (["unlimited", "none", "0"].includes(normalized)) {
    return 0;
  }

  const tokenLimit = Number.parseInt(normalized.replaceAll("_", ""), 10);
  if (!Number.isSafeInteger(tokenLimit) || tokenLimit <= 0) {
    usage();
  }
  return tokenLimit;
}

const [, , userRef, limitArg] = process.argv;
if (!userRef || !limitArg) {
  usage();
}

const dbPath = resolve(process.env.SCHOLARMARK_DB_PATH || process.env.SOURCEANNOTATOR_DB_PATH || "data/sourceannotator.db");
if (!existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

const tokenLimit = parseTokenLimit(limitArg);
const nowSeconds = Math.floor(Date.now() / 1000);
const sqlite = new Database(dbPath);

const user = sqlite
  .prepare("SELECT id, email, tier FROM users WHERE id = ? OR lower(email) = lower(?)")
  .get(userRef, userRef);

if (!user) {
  console.error(`No user found for ${userRef}`);
  process.exit(1);
}

sqlite
  .prepare(`
    UPDATE users
    SET token_limit = ?,
        tokens_used = 0,
        billing_cycle_start = ?,
        updated_at = ?
    WHERE id = ?
  `)
  .run(tokenLimit, nowSeconds, nowSeconds, user.id);

const updated = sqlite
  .prepare("SELECT id, email, tier, tokens_used, token_limit, billing_cycle_start FROM users WHERE id = ?")
  .get(user.id);

console.log(JSON.stringify(updated, null, 2));
