import "dotenv/config";
import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { readFile, rm } from "fs/promises";

const isProductionBuild = process.env.NODE_ENV !== "development";
const clerkPublishableKey =
  process.env.VITE_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY || "";
const clerkSecretKey = process.env.CLERK_SECRET_KEY || "";
const allowTestClerkKeysInProduction =
  process.env.CLERK_ALLOW_TEST_KEYS_IN_PRODUCTION === "true";

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
  await rm("dist", { recursive: true, force: true });

  if (process.env.CLERK_PUBLISHABLE_KEY && !process.env.VITE_CLERK_PUBLISHABLE_KEY) {
    process.env.VITE_CLERK_PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY;
  }

  if (isProductionBuild) {
    if (process.env.LOCAL_DEV_AUTH === "true" || process.env.VITE_LOCAL_DEV_AUTH === "true") {
      throw new Error("LOCAL_DEV_AUTH must be disabled for production builds.");
    }
    if (!allowTestClerkKeysInProduction && !clerkPublishableKey.startsWith("pk_live_")) {
      throw new Error("Production builds require a Clerk publishable key prefixed with pk_live_.");
    }
    if (!allowTestClerkKeysInProduction && !clerkSecretKey.startsWith("sk_live_")) {
      throw new Error("Production builds require a Clerk secret key prefixed with sk_live_.");
    }
  }

  console.log("building client...");
  await viteBuild();

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
