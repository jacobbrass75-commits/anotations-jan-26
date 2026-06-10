#!/usr/bin/env node
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const TIER_LIMITS = {
  free: { tokenLimit: 50_000, storageLimit: 52_428_800 },
  pro: { tokenLimit: 500_000, storageLimit: 524_288_000 },
  max: { tokenLimit: 2_000_000, storageLimit: 5_368_709_120 },
};

function usage() {
  console.error("Usage: npm run user:set-tier -- <email-or-user-id> <free|pro|max>");
  process.exit(1);
}

const [, , userRef, tier] = process.argv;
if (!userRef || !tier || !(tier in TIER_LIMITS)) {
  usage();
}

const dbPath = resolve(
  process.env.SCHOLARMARK_DB_PATH ||
    process.env.SOURCEANNOTATOR_DB_PATH ||
    "data/sourceannotator.db",
);
if (!existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

const nowMs = Date.now();
const { tokenLimit, storageLimit } = TIER_LIMITS[tier];
const sqlite = new Database(dbPath);

const user = sqlite
  .prepare("SELECT id, email, tier FROM users WHERE id = ? OR lower(email) = lower(?)")
  .get(userRef, userRef);

if (!user) {
  console.error(`No user found for ${userRef}`);
  process.exit(1);
}

sqlite
  .prepare(
    `
    UPDATE users
    SET tier = ?,
        token_limit = ?,
        storage_limit = ?,
        tokens_used = 0,
        billing_cycle_start = ?,
        updated_at = ?
    WHERE id = ?
  `,
  )
  .run(tier, tokenLimit, storageLimit, nowMs, nowMs, user.id);

const updated = sqlite
  .prepare(
    "SELECT id, email, tier, token_limit, storage_limit, billing_cycle_start FROM users WHERE id = ?",
  )
  .get(user.id);

console.log(JSON.stringify(updated, null, 2));
