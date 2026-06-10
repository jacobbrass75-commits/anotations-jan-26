#!/usr/bin/env node
import Database from "better-sqlite3";
import { spawn, spawnSync } from "child_process";
import { createServer } from "http";
import { copyFile, mkdir, mkdtemp, rm, stat, symlink } from "fs/promises";
import { dirname, join, resolve } from "path";
import { tmpdir } from "os";
import { fileURLToPath, pathToFileURL } from "url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backupDir = resolve(process.env.BACKUP_DIR || process.env.RESTORE_BACKUP_DIR || "/opt/backups/scholarmark/latest");
const keepWorkdir = process.env.KEEP_RESTORE_DRILL_WORKDIR === "1";
const skipAppBoot = process.env.SKIP_RESTORE_DRILL_BOOT === "1";
const workDir = process.env.RESTORE_WORK_DIR
  ? resolve(process.env.RESTORE_WORK_DIR)
  : await mkdtemp(join(tmpdir(), "scholarmark-restore-drill-"));

function fail(message) {
  throw new Error(message);
}

async function requireFile(path, label) {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) {
    fail(`Missing ${label}: ${path}`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    stdio: options.stdio || "pipe",
  });

  if ((result.status ?? 1) !== 0) {
    fail(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return result;
}

function buildTestPublishableKey(frontendApi) {
  return `pk_test_${Buffer.from(`${frontendApi}$`).toString("base64")}`;
}

async function fileExists(path) {
  const info = await stat(path).catch(() => null);
  return Boolean(info?.isFile());
}

async function getAvailablePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate a restore-drill port"));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(address.port);
      });
    });
    server.on("error", reject);
  });
}

async function waitForUrl(url, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("Restored app exited before readiness probe completed.");
    }

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the app is ready or the timeout expires.
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveStop) => child.once("exit", resolveStop)),
    new Promise((resolveStop) => {
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
        resolveStop();
      }, 2000);
    }),
  ]);
}

async function prepareWorkspace() {
  await mkdir(join(workDir, "data"), { recursive: true });
  await mkdir(join(workDir, "shared"), { recursive: true });

  await copyFile(join(repoRoot, "tsconfig.json"), join(workDir, "tsconfig.json"));
  await copyFile(join(repoRoot, "drizzle.config.ts"), join(workDir, "drizzle.config.ts"));
  await copyFile(join(repoRoot, "shared", "schema.ts"), join(workDir, "shared", "schema.ts"));

  try {
    await symlink(join(repoRoot, "node_modules"), join(workDir, "node_modules"), "junction");
  } catch (error) {
    if (!(error instanceof Error) || error.code !== "EEXIST") {
      throw error;
    }
  }
}

async function runRestoredAppSmoke() {
  if (skipAppBoot) {
    console.log("[restore-drill] restored app boot skipped");
    return;
  }

  const port = await getAvailablePort();
  const appBaseUrl = `http://127.0.0.1:${port}`;
  const productionEntry = join(repoRoot, "dist", "index.cjs");
  const useProductionEntry =
    process.env.RESTORE_DRILL_APP_MODE === "production"
    || (process.env.RESTORE_DRILL_APP_MODE !== "development" && await fileExists(productionEntry));
  const tsxEntrypoint = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const appImport = useProductionEntry
    ? pathToFileURL(productionEntry).href
    : pathToFileURL(join(repoRoot, "server", "index.ts")).href;
  const wrapper = `(async () => {
    process.chdir(${JSON.stringify(workDir)});
    await import(${JSON.stringify(appImport)});
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });`;
  const args = useProductionEntry ? ["-e", wrapper] : [tsxEntrypoint, "-e", wrapper];
  const env = {
    ...process.env,
    NODE_ENV: useProductionEntry ? "production" : "development",
    PORT: String(port),
    CLERK_ALLOW_TEST_KEYS_IN_PRODUCTION: "true",
    CLERK_PUBLISHABLE_KEY: buildTestPublishableKey("clerk.testing.dev"),
    VITE_CLERK_PUBLISHABLE_KEY: buildTestPublishableKey("clerk.testing.dev"),
    CLERK_SECRET_KEY: "sk_test_restore_drill",
    JWT_SECRET: "restore-drill-jwt-secret-with-at-least-32-characters",
    APP_BASE_URL: "https://app.scholarmark.ai",
    PUBLIC_BASE_URL: "https://app.scholarmark.ai",
    ALLOWED_ORIGINS: "https://app.scholarmark.ai,https://mcp.scholarmark.ai",
    CHROME_EXTENSION_IDS: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ANTHROPIC_API_KEY: "restore-drill-anthropic-placeholder",
    OPENAI_API_KEY: "restore-drill-openai-placeholder",
    LOCAL_DEV_AUTH: "false",
    VITE_LOCAL_DEV_AUTH: "false",
  };
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    output += String(chunk);
  });

  try {
    await waitForUrl(`${appBaseUrl}/readyz`, child);
    run(process.execPath, [join(repoRoot, "scripts", "smoke-prod.mjs")], {
      cwd: repoRoot,
      env: {
        ...env,
        APP_BASE_URL: appBaseUrl,
        SKIP_MCP_SMOKE: "1",
        SMOKE_TIMEOUT_MS: "5000",
      },
      stdio: "pipe",
    });
    console.log(`[restore-drill] restored app boot smoke passed: ${appBaseUrl}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`${message}\n${output}`.trim());
  } finally {
    await stopProcess(child);
  }
}

async function runRestoreDrill() {
  const dbBackupPath = join(backupDir, "sourceannotator.db");
  const uploadsArchivePath = join(backupDir, "uploads.tar.gz");

  await requireFile(dbBackupPath, "SQLite backup");
  await requireFile(uploadsArchivePath, "uploads archive");
  await prepareWorkspace();

  const restoredDbPath = join(workDir, "data", "sourceannotator.db");
  await copyFile(dbBackupPath, restoredDbPath);
  run("tar", ["-xzf", uploadsArchivePath, "-C", join(workDir, "data")]);

  const db = new Database(restoredDbPath);
  try {
    const row = db.prepare("PRAGMA integrity_check").get();
    if (row.integrity_check !== "ok") {
      fail(`SQLite integrity check failed: ${row.integrity_check}`);
    }
  } finally {
    db.close();
  }

  const tsxEntrypoint = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
  run(process.execPath, [tsxEntrypoint, join(repoRoot, "scripts", "bootstrap-db.ts")], {
    cwd: workDir,
    stdio: "pipe",
  });
  await runRestoredAppSmoke();

  console.log(`[restore-drill] restored backup: ${backupDir}`);
  console.log(`[restore-drill] verified workspace: ${workDir}`);
}

try {
  await runRestoreDrill();
  if (!keepWorkdir && !process.env.RESTORE_WORK_DIR) {
    await rm(workDir, { recursive: true, force: true });
  }
  console.log("[restore-drill] restore drill passed");
} catch (error) {
  console.error("[restore-drill] restore drill failed");
  console.error(error instanceof Error ? error.message : error);
  if (!keepWorkdir && !process.env.RESTORE_WORK_DIR) {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
  process.exit(1);
}
