import "dotenv/config";
import { execFileSync, spawn } from "child_process";
import { createHash } from "crypto";
import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { assertProductionConfig } from "../server/productionConfig";

const shouldValidateProductionBuild = process.env.SCHOLARMARK_VALIDATE_PRODUCTION_BUILD === "true";
const ASSET_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// Mirrors isMarketingSiteEnabled() in server/static.ts without loading the server logger.
const shouldBuildMarketingSite =
  process.env.SCHOLARMARK_MARKETING_SITE?.trim().toLowerCase() === "astro";
const MARKETING_DIR = path.resolve(process.env.SCHOLARMARK_MARKETING_DIR || "marketing");
const MARKETING_OUTPUT_DIR = path.resolve("dist/marketing");
const MARKETING_INSTALL_STAMP = ".scholarmark-ci-stamp";

// The production .env is loaded above; only system, release, and PUBLIC_* values
// reach the marketing build so secrets cannot be inlined into static HTML.
// SITE_RELEASE_ENV=production is the marketing site's explicit indexing gate.
// Matched case-insensitively because Windows shells vary the casing (Path, SYSTEMROOT).
const MARKETING_ENV_ALLOWLIST = new Set([
  "SITE_RELEASE_ENV",
  "PATH",
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "SYSTEMROOT",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "CI",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "NPM_CONFIG_CACHE",
  "NPM_CONFIG_REGISTRY",
  "NPM_CONFIG_USERCONFIG",
]);

function marketingEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      (MARKETING_ENV_ALLOWLIST.has(key.toUpperCase()) || key.startsWith("PUBLIC_"))
    ) {
      env[key] = value;
    }
  }
  // Release flags are forwarded explicitly from .env. An unset SITE_RELEASE_ENV builds
  // as staging (noindex) so only an explicit production value makes the site indexable.
  const release: Record<string, string> = {
    SITE_RELEASE_ENV: process.env.SITE_RELEASE_ENV?.trim() || "staging",
  };
  if (process.env.PUBLIC_PRO_PRICE_LIVE !== undefined) {
    release.PUBLIC_PRO_PRICE_LIVE = process.env.PUBLIC_PRO_PRICE_LIVE.trim();
  }
  return { ...env, ...release, ASTRO_TELEMETRY_DISABLED: "1", ...overrides };
}

// Optional standalone Node for the marketing build when the system Node is too old for
// Astro (e.g. /opt/app/.tools/node-v22.22.0-linux-x64/bin/node). Unset keeps the
// current behavior: the Node running this script and its npm.
const MARKETING_NODE_PATH = process.env.SCHOLARMARK_MARKETING_NODE_PATH?.trim()
  ? path.resolve(process.env.SCHOLARMARK_MARKETING_NODE_PATH.trim())
  : null;

function marketingNodeVersion(): string {
  if (!MARKETING_NODE_PATH) return process.version;
  if (!existsSync(MARKETING_NODE_PATH)) {
    throw new Error(`SCHOLARMARK_MARKETING_NODE_PATH does not exist: ${MARKETING_NODE_PATH}`);
  }
  return execFileSync(MARKETING_NODE_PATH, ["-p", "process.version"], { encoding: "utf-8" }).trim();
}

// Prefer the npm bundled with the standalone Node (Linux tarball and Windows zip layouts).
function marketingNpmCli(): string | undefined {
  if (!MARKETING_NODE_PATH) return process.env.npm_execpath;
  const nodeDir = path.dirname(MARKETING_NODE_PATH);
  const bundled = [
    path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
  ].find((candidate) => existsSync(candidate));
  const npmCli = bundled ?? process.env.npm_execpath;
  if (!npmCli?.endsWith(".js")) {
    throw new Error(
      `SCHOLARMARK_MARKETING_NODE_PATH is set but no npm-cli.js was found near ${nodeDir}`,
    );
  }
  return npmCli;
}

// Puts the standalone Node first on PATH so `#!/usr/bin/env node` (Astro's bin) uses it.
function withMarketingNodePath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!MARKETING_NODE_PATH) return env;
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  const current = env[pathKey];
  const nodeDir = path.dirname(MARKETING_NODE_PATH);
  return { ...env, [pathKey]: current ? `${nodeDir}${path.delimiter}${current}` : nodeDir };
}

function runNpm(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const npmCli = marketingNpmCli();
  const nodeBinary = MARKETING_NODE_PATH ?? process.execPath;
  const [command, commandArgs] =
    npmCli && npmCli.endsWith(".js") ? [nodeBinary, [npmCli, ...args]] : ["npm", args];
  env = withMarketingNodePath(env);
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: MARKETING_DIR,
      env,
      stdio: "inherit",
      shell: command === "npm" && process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(new Error(`marketing: npm ${args.join(" ")} failed (${signal ?? `exit ${code}`})`));
    });
  });
}

async function buildMarketingSite(): Promise<void> {
  const lockfile = path.join(MARKETING_DIR, "package-lock.json");
  if (!existsSync(path.join(MARKETING_DIR, "package.json")) || !existsSync(lockfile)) {
    throw new Error(
      `SCHOLARMARK_MARKETING_SITE=astro requires ${MARKETING_DIR}/package.json and package-lock.json`,
    );
  }

  const pkg = JSON.parse(await readFile(path.join(MARKETING_DIR, "package.json"), "utf-8"));
  const nodeVersion = marketingNodeVersion();
  console.log(
    `marketing: using Node ${nodeVersion}${MARKETING_NODE_PATH ? ` (${MARKETING_NODE_PATH})` : ""}`,
  );
  const minimumNode = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(pkg.engines?.node?.trim() ?? "");
  if (minimumNode) {
    const required = minimumNode.slice(1).map(Number);
    const current = nodeVersion.replace(/^v/, "").split(".").map(Number);
    const index = required.findIndex((part, i) => part !== current[i]);
    if (index !== -1 && current[index] < required[index]) {
      throw new Error(
        `marketing site requires Node ${pkg.engines.node}; running ${nodeVersion}` +
          " (set SCHOLARMARK_MARKETING_NODE_PATH to a newer node binary)",
      );
    }
  }

  // The marketing project keeps its own node_modules; install runs strictly
  // after the root `npm ci` and is skipped when the lockfile and Node are unchanged.
  const stampPath = path.join(MARKETING_DIR, "node_modules", MARKETING_INSTALL_STAMP);
  const stamp = createHash("sha256")
    .update(await readFile(lockfile))
    .update(nodeVersion)
    .digest("hex");
  const installedStamp = await readFile(stampPath, "utf-8").catch(() => "");
  if (installedStamp.trim() === stamp) {
    console.log("marketing: dependencies up to date, skipping npm ci");
  } else {
    console.log("marketing: installing dependencies...");
    await runNpm(["ci", "--include=dev", "--no-audit", "--no-fund"], marketingEnv({}));
    await mkdir(path.dirname(stampPath), { recursive: true });
    await writeFile(stampPath, `${stamp}\n`);
  }

  console.log("building marketing site...");
  await runNpm(["run", "build"], marketingEnv({ NODE_ENV: "production" }));
  if (!existsSync(path.join(MARKETING_DIR, "dist", "index.html"))) {
    throw new Error(`marketing build did not produce ${MARKETING_DIR}/dist/index.html`);
  }
}

async function installMarketingOutput(): Promise<void> {
  const stamp = Date.now().toString(36);
  const staging = path.resolve(`dist/.marketing-staging-${stamp}`);
  const previous = path.resolve(`dist/.marketing-previous-${stamp}`);
  await cp(path.join(MARKETING_DIR, "dist"), staging, { recursive: true });

  // Keep recently served hashed assets so pages open during a deploy still load.
  const previousAssets = path.join(MARKETING_OUTPUT_DIR, "_astro");
  if (existsSync(previousAssets)) {
    await cp(previousAssets, path.join(staging, "_astro"), {
      recursive: true,
      force: false,
      errorOnExist: false,
      preserveTimestamps: true,
    });
    await pruneExpiredAssets(path.join(staging, "_astro"), Date.now() - ASSET_RETENTION_MS);
  }

  const hadOutput = existsSync(MARKETING_OUTPUT_DIR);
  if (hadOutput) await rename(MARKETING_OUTPUT_DIR, previous);
  try {
    await rename(staging, MARKETING_OUTPUT_DIR);
  } catch (err) {
    if (hadOutput) await rename(previous, MARKETING_OUTPUT_DIR);
    await rm(staging, { recursive: true, force: true });
    throw err;
  }
  if (hadOutput) await rm(previous, { recursive: true, force: true });
}

async function pruneExpiredAssets(directory: string, cutoff: number): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await pruneExpiredAssets(entryPath, cutoff);
        return;
      }
      if (!entry.isFile()) return;
      const info = await stat(entryPath);
      if (info.mtimeMs < cutoff) await rm(entryPath, { force: true });
    }),
  );
}

// Keep frequently used server dependencies bundled while leaving heavy/native deps external.
const allowlist = [
  "@anthropic-ai/sdk",
  "@shared",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "jsonwebtoken",
  "multer",
  "nanoid",
  "openai",
  "passport",
  "passport-local",
  "react-markdown",
  "wouter",
  "ws",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  if (process.env.CLERK_PUBLISHABLE_KEY && !process.env.VITE_CLERK_PUBLISHABLE_KEY) {
    process.env.VITE_CLERK_PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY;
  }

  if (shouldValidateProductionBuild) {
    assertProductionConfig(process.env, { phase: "build" });
  }

  // Build marketing first so a failure aborts before any dist/ output changes.
  if (shouldBuildMarketingSite) {
    await buildMarketingSite();
  } else {
    console.log(
      "marketing site disabled (SCHOLARMARK_MARKETING_SITE != astro), skipping Astro build",
    );
  }

  console.log("building client...");
  await viteBuild();
  await pruneExpiredAssets(path.resolve("dist/public/assets"), Date.now() - ASSET_RETENTION_MS);

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep: string) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  if (shouldBuildMarketingSite) {
    console.log("installing marketing site into dist/marketing...");
    await installMarketingOutput();
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
