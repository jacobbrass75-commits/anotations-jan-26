import { spawnSync } from "child_process";
import { copyFile, cp, mkdir, symlink, writeFile } from "fs/promises";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const tsxEntrypoint = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const bootstrapScript = join(repoRoot, "scripts", "bootstrap-db.ts");

export async function bootstrapTempWorkspace(tempDir: string): Promise<void> {
  await mkdir(join(tempDir, "shared"), { recursive: true });
  await copyFile(join(repoRoot, "tsconfig.json"), join(tempDir, "tsconfig.json"));
  await copyFile(join(repoRoot, "drizzle.config.ts"), join(tempDir, "drizzle.config.ts"));
  // tsconfig maps @shared/* into this workspace, so server modules that import any
  // shared file (not only the schema) need the whole directory.
  await cp(join(repoRoot, "shared"), join(tempDir, "shared"), { recursive: true });
  // Load the copied shared files as ES modules, matching the repo's package.json.
  await writeFile(join(tempDir, "package.json"), JSON.stringify({ type: "module" }));

  try {
    await symlink(join(repoRoot, "node_modules"), join(tempDir, "node_modules"), "junction");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
      throw error;
    }
  }

  const templatePath = process.env.SCHOLARMARK_TEST_DB_TEMPLATE;
  if (templatePath) {
    await mkdir(join(tempDir, "data"), { recursive: true });
    // Copy a closed, pristine SQLite file. Never share a writable database or WAL.
    await copyFile(templatePath, join(tempDir, "data", "sourceannotator.db"));
    return;
  }

  const bootstrap = spawnSync(process.execPath, [tsxEntrypoint, bootstrapScript], {
    cwd: tempDir,
    env: process.env,
    encoding: "utf8",
  });

  if (bootstrap.status !== 0) {
    throw new Error(
      `Failed to bootstrap temp workspace.\n${bootstrap.stdout ?? ""}\n${bootstrap.stderr ?? ""}`.trim(),
    );
  }
}
