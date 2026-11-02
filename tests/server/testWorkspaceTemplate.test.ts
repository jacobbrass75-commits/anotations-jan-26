import Database from "better-sqlite3";
import { createHash } from "crypto";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { expect, it } from "vitest";
import { createTestDbTemplate } from "../../scripts/test-db-template.mjs";
import { bootstrapTempWorkspace } from "./helpers/bootstrapTempWorkspace";

it("isolates writes and schema changes from the template and the next test workspace", async () => {
  const originalTemplate = process.env.SCHOLARMARK_TEST_DB_TEMPLATE;
  const template = await createTestDbTemplate();
  const root = await mkdtemp(join(tmpdir(), "scholarmark-template-isolation-"));
  const digest = async () =>
    createHash("sha256")
      .update(await readFile(template.dbPath))
      .digest("hex");
  try {
    const beforeHash = await digest();
    process.env.SCHOLARMARK_TEST_DB_TEMPLATE = template.dbPath;
    const first = join(root, "first");
    const second = join(root, "second");
    await bootstrapTempWorkspace(first);
    const firstDb = new Database(join(first, "data/sourceannotator.db"));
    try {
      firstDb.exec(
        "CREATE TABLE fixture_only (value TEXT); INSERT INTO fixture_only VALUES ('changed'); DROP TABLE projects;",
      );
    } finally {
      firstDb.close();
    }
    await bootstrapTempWorkspace(second);
    const secondDb = new Database(join(second, "data/sourceannotator.db"));
    try {
      expect(secondDb.prepare("SELECT count(*) AS count FROM users").get()).toEqual({ count: 0 });
      expect(secondDb.prepare("SELECT count(*) AS count FROM projects").get()).toEqual({
        count: 0,
      });
      expect(
        secondDb.prepare("SELECT name FROM sqlite_master WHERE name = 'fixture_only'").get(),
      ).toBeUndefined();
    } finally {
      secondDb.close();
    }
    expect(await digest()).toBe(beforeHash);
  } finally {
    if (originalTemplate === undefined) delete process.env.SCHOLARMARK_TEST_DB_TEMPLATE;
    else process.env.SCHOLARMARK_TEST_DB_TEMPLATE = originalTemplate;
    await rm(root, { recursive: true, force: true });
    await template.cleanup();
  }
}, 200_000);
