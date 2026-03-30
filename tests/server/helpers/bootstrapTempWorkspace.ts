import { spawnSync } from "child_process";
import { copyFile, mkdir, symlink } from "fs/promises";
import { join } from "path";

const repoRoot = "/Users/brass/Documents/New project/anotations-jan-26";
const tsxEntrypoint = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const bootstrapScript = join(repoRoot, "scripts", "bootstrap-db.ts");

export async function bootstrapTempWorkspace(tempDir: string): Promise<void> {
  await mkdir(join(tempDir, "shared"), { recursive: true });
  await copyFile(join(repoRoot, "tsconfig.json"), join(tempDir, "tsconfig.json"));
  await copyFile(join(repoRoot, "drizzle.config.ts"), join(tempDir, "drizzle.config.ts"));
  await copyFile(join(repoRoot, "shared", "schema.ts"), join(tempDir, "shared", "schema.ts"));

  try {
    await symlink(join(repoRoot, "node_modules"), join(tempDir, "node_modules"));
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
      throw error;
    }
  }

  const bootstrap = spawnSync(process.execPath, [tsxEntrypoint, bootstrapScript], {
    cwd: tempDir,
    env: process.env,
    encoding: "utf8",
  });

  if (bootstrap.status !== 0) {
    throw new Error(
      `Failed to bootstrap temp workspace.\n${bootstrap.stdout ?? ""}\n${bootstrap.stderr ?? ""}`.trim()
    );
  }
}
