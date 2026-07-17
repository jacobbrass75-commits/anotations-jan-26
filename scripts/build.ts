import "dotenv/config";
import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { readdir, readFile, rm, stat } from "fs/promises";
import path from "path";
import { assertProductionConfig } from "../server/productionConfig";

const shouldValidateProductionBuild = process.env.SCHOLARMARK_VALIDATE_PRODUCTION_BUILD === "true";
const ASSET_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

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
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
