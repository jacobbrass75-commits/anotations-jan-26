import { spawnSync } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const helperUrl = pathToFileURL(
  join(repoRoot, "tests/server/helpers/bootstrapTempWorkspace.ts"),
).href;

/** Build the real empty schema once; each test still receives its own database. */
export async function createTestDbTemplate() {
  const directory = await mkdtemp(join(tmpdir(), "scholarmark-test-template-"));
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        "const { bootstrapTempWorkspace } = await import(process.argv[1]); await bootstrapTempWorkspace(process.argv[2]);",
        helperUrl,
        directory,
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, SCHOLARMARK_TEST_DB_TEMPLATE: "" },
        encoding: "utf8",
        timeout: 180_000,
      },
    );
    if (result.status !== 0) {
      throw new Error(
        `Test database template failed: ${result.error?.message ?? result.signal ?? result.status}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
      );
    }
    const dbPath = join(directory, "data", "sourceannotator.db");
    await access(dbPath);
    return { dbPath, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
