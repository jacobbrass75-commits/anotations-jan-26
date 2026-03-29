import { spawnSync } from "node:child_process";
import path from "node:path";
import { testFiles } from "./test-files.mjs";

const vitestEntrypoint = path.resolve("node_modules", "vitest", "vitest.mjs");
const passthroughArgs = process.argv.slice(2);

for (const testFile of testFiles) {
  console.log(`\n[vitest] ${testFile}`);

  const result = spawnSync(
    process.execPath,
    ["--max-old-space-size=8192", vitestEntrypoint, "run", testFile, ...passthroughArgs],
    {
      stdio: "inherit",
      env: process.env,
    }
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
