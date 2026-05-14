import { execFile } from "child_process";
import { copyFile, mkdtemp, mkdir, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrapTempWorkspace } from "./helpers/bootstrapTempWorkspace";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const restoreDrillScript = join(repoRoot, "scripts", "restore-drill.mjs");

describe("restore-drill.mjs", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it("restores a backup snapshot into a temporary workspace and bootstraps schema", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "scholarmark-restore-test-"));
    tempDirs.push(tempDir);

    const backupDir = join(tempDir, "backup");
    const sourceWorkDir = join(tempDir, "source-workdir");
    const uploadsDir = join(tempDir, "uploads");
    const restoreWorkDir = join(tempDir, "restore-workdir");
    await mkdir(backupDir, { recursive: true });
    await mkdir(sourceWorkDir, { recursive: true });
    await mkdir(uploadsDir, { recursive: true });
    await mkdir(restoreWorkDir, { recursive: true });

    await writeFile(join(uploadsDir, "doc.txt"), "restored source text");
    await bootstrapTempWorkspace(sourceWorkDir);
    await copyFile(
      join(sourceWorkDir, "data", "sourceannotator.db"),
      join(backupDir, "sourceannotator.db")
    );

    await execFileAsync("tar", ["-czf", join(backupDir, "uploads.tar.gz"), "-C", tempDir, "uploads"]);

    await execFileAsync(process.execPath, [restoreDrillScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        BACKUP_DIR: backupDir,
        RESTORE_WORK_DIR: restoreWorkDir,
        RESTORE_DRILL_APP_MODE: "development",
      },
    });

    expect((await stat(join(restoreWorkDir, "data", "sourceannotator.db"))).isFile()).toBe(true);
    expect((await stat(join(restoreWorkDir, "data", "uploads", "doc.txt"))).isFile()).toBe(true);
  }, 60_000);
});
