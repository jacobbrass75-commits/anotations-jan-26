import { spawnSync } from "node:child_process";
import path from "node:path";
import { testFiles } from "./test-files.mjs";
import { createTestDbTemplate } from "./test-db-template.mjs";

const vitestEntrypoint = path.resolve("node_modules", "vitest", "vitest.mjs");
const passthroughArgs = process.argv.slice(2);

console.log("[vitest] building pristine database template");
const template = await createTestDbTemplate();
let exitCode = 0;
try {
  for (const testFile of testFiles) {
    console.log(`\n[vitest] ${testFile}`);

    const result = spawnSync(
      process.execPath,
      ["--max-old-space-size=8192", vitestEntrypoint, "run", testFile, ...passthroughArgs],
      {
        stdio: "inherit",
        env: { ...process.env, SCHOLARMARK_TEST_DB_TEMPLATE: template.dbPath },
      },
    );

    if (result.status !== 0) {
      exitCode = result.status ?? 1;
      break;
    }
  }
} finally {
  await template.cleanup();
}
process.exitCode = exitCode;
