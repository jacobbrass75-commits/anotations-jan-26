import Database from "better-sqlite3";
import { execFile } from "child_process";
import { existsSync } from "fs";
import { lstat, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
const bashExecutable = process.platform === "win32" && existsSync(gitBash) ? gitBash : "bash";

function toBashPath(path: string): string {
  if (process.platform !== "win32") {
    return path;
  }

  return path
    .replace(/\\/g, "/")
    .replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`);
}

const backupScript = toBashPath(join(repoRoot, "deploy", "backup-data.sh"));

describe("backup-data.sh", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  async function createTempApp() {
    const tempDir = await mkdtemp(join(tmpdir(), "scholarmark-backup-"));
    tempDirs.push(tempDir);

    const appDir = join(tempDir, "app");
    const dataDir = join(appDir, "data");
    const uploadsDir = join(dataDir, "uploads");
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(join(uploadsDir, "doc-1.txt"), "saved source contents");

    const dbPath = join(dataDir, "sourceannotator.db");
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE demo_items (
        id INTEGER PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO demo_items (value) VALUES ('alpha');
    `);
    db.close();

    return { tempDir, appDir };
  }

  it("creates a sqlite snapshot, uploads archive, and metadata manifest", async () => {
    const { appDir } = await createTempApp();
    const backupRoot = join(appDir, "backups");
    const timestamp = "20260330T120000Z";

    await execFileAsync(bashExecutable, [backupScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        APP_DIR: toBashPath(appDir),
        BACKUP_ROOT: toBashPath(backupRoot),
        BACKUP_TIMESTAMP: timestamp,
      },
    });

    const snapshotDir = join(backupRoot, timestamp);
    const dbSnapshotPath = join(snapshotDir, "sourceannotator.db");
    const uploadsArchivePath = join(snapshotDir, "uploads.tar.gz");
    const metadataPath = join(snapshotDir, "metadata.json");

    expect((await stat(dbSnapshotPath)).isFile()).toBe(true);
    expect((await stat(uploadsArchivePath)).isFile()).toBe(true);

    const snapshotDb = new Database(dbSnapshotPath, { readonly: true });
    const row = snapshotDb.prepare("SELECT value FROM demo_items").get() as { value: string };
    snapshotDb.close();
    expect(row.value).toBe("alpha");

    const { stdout: tarList } = await execFileAsync("tar", ["-tzf", uploadsArchivePath]);
    expect(tarList).toContain("uploads/doc-1.txt");

    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
      createdAt: string;
      dbBackupBytes: number;
      uploadsArchiveBytes: number;
    };
    expect(metadata.createdAt).toBe(timestamp);
    expect(metadata.dbBackupBytes).toBeGreaterThan(0);
    expect(metadata.uploadsArchiveBytes).toBeGreaterThan(0);

    const latestStat = await lstat(join(backupRoot, "latest"));
    if (process.platform === "win32") {
      expect(latestStat.isSymbolicLink() || latestStat.isDirectory()).toBe(true);
    } else {
      expect(latestStat.isSymbolicLink()).toBe(true);
    }
  });

  it("prunes older backups when retention count is exceeded", async () => {
    const { appDir } = await createTempApp();
    const backupRoot = join(appDir, "backups");

    await execFileAsync(bashExecutable, [backupScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        APP_DIR: toBashPath(appDir),
        BACKUP_ROOT: toBashPath(backupRoot),
        BACKUP_TIMESTAMP: "20260330T120000Z",
        RETENTION_COUNT: "1",
      },
    });

    await execFileAsync(bashExecutable, [backupScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        APP_DIR: toBashPath(appDir),
        BACKUP_ROOT: toBashPath(backupRoot),
        BACKUP_TIMESTAMP: "20260330T130000Z",
        RETENTION_COUNT: "1",
      },
    });

    await expect(stat(join(backupRoot, "20260330T120000Z"))).rejects.toThrow();
    expect((await stat(join(backupRoot, "20260330T130000Z"))).isDirectory()).toBe(true);
  });
});
