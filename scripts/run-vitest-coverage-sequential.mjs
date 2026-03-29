import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import istanbulCoverage from "istanbul-lib-coverage";
import istanbulReport from "istanbul-lib-report";
import reports from "istanbul-reports";
import { testFiles } from "./test-files.mjs";

const vitestEntrypoint = path.resolve("node_modules", "vitest", "vitest.mjs");
const finalCoverageDir = path.resolve("coverage");
const tempCoverageDir = await mkdtemp(path.join(tmpdir(), "scholarmark-vitest-coverage-"));
const { createCoverageMap } = istanbulCoverage;
const { createContext } = istanbulReport;
const coverageMap = createCoverageMap({});

try {
  for (const [index, testFile] of testFiles.entries()) {
    const reportDir = path.join(tempCoverageDir, `run-${String(index + 1).padStart(2, "0")}`);

    console.log(`\n[coverage] ${testFile}`);

    const result = spawnSync(
      process.execPath,
      [
        "--max-old-space-size=8192",
        vitestEntrypoint,
        "run",
        testFile,
        "--coverage",
        "--coverage.reporter=json",
        `--coverage.reportsDirectory=${reportDir}`,
      ],
      {
        stdio: "inherit",
        env: process.env,
      }
    );

    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }

    const rawCoverage = JSON.parse(
      await readFile(path.join(reportDir, "coverage-final.json"), "utf8")
    );
    coverageMap.merge(rawCoverage);
  }

  await rm(finalCoverageDir, { recursive: true, force: true });
  await mkdir(finalCoverageDir, { recursive: true });
  await writeFile(
    path.join(finalCoverageDir, "coverage-final.json"),
    JSON.stringify(coverageMap.toJSON(), null, 2)
  );

  const context = createContext({
    dir: finalCoverageDir,
    coverageMap,
  });

  reports.create("text").execute(context);
  reports.create("json-summary").execute(context);
  reports.create("html").execute(context);
} finally {
  await rm(tempCoverageDir, { recursive: true, force: true });
}
