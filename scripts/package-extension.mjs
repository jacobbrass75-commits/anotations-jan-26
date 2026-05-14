#!/usr/bin/env node
import JSZip from "jszip";
import sharp from "sharp";
import { mkdir, readFile, readdir, stat, writeFile } from "fs/promises";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = join(repoRoot, "chrome-extension");
const outputDir = join(repoRoot, "dist", "chrome-extension");
const production = process.env.EXTENSION_PACKAGE_MODE !== "development";

function fail(message) {
  throw new Error(message);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function fileExists(path) {
  const info = await stat(path).catch(() => null);
  return Boolean(info?.isFile());
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.name === ".DS_Store") continue;
    if (entry.isDirectory()) {
      files.push(...await walk(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

async function validateIcon(path, expectedSize) {
  if (!await fileExists(path)) {
    fail(`Missing icon: ${path}`);
  }
  const metadata = await sharp(path).metadata();
  if (metadata.width !== expectedSize || metadata.height !== expectedSize) {
    fail(`Icon ${path} must be ${expectedSize}x${expectedSize}, got ${metadata.width}x${metadata.height}`);
  }
}

async function validateManifest(manifest) {
  const iconEntries = Object.entries(manifest.icons || {});
  const actionIconEntries = Object.entries(manifest.action?.default_icon || {});

  for (const [size, iconPath] of [...iconEntries, ...actionIconEntries]) {
    await validateIcon(join(extensionDir, iconPath), Number(size));
  }

  for (const script of manifest.background?.service_worker ? [manifest.background.service_worker] : []) {
    if (!await fileExists(join(extensionDir, script))) fail(`Missing background service worker: ${script}`);
  }

  for (const contentScript of manifest.content_scripts || []) {
    for (const jsPath of contentScript.js || []) {
      if (!await fileExists(join(extensionDir, jsPath))) fail(`Missing content script: ${jsPath}`);
    }
  }

  if (production && (manifest.host_permissions || []).some((value) => value.startsWith("http://localhost"))) {
    manifest.host_permissions = manifest.host_permissions.filter((value) => !value.startsWith("http://localhost"));
  }

  if (production && !manifest.host_permissions.includes("https://app.scholarmark.ai/*")) {
    fail("Production manifest must include https://app.scholarmark.ai/* host permission");
  }

  return manifest;
}

async function packageExtension() {
  const manifestPath = join(extensionDir, "manifest.json");
  const manifest = await validateManifest(await readJson(manifestPath));
  const zip = new JSZip();
  const files = await walk(extensionDir);

  for (const file of files) {
    const relativePath = relative(extensionDir, file).replace(/\\/g, "/");
    if (relativePath === "manifest.json") {
      zip.file(relativePath, JSON.stringify(manifest, null, 2) + "\n");
      continue;
    }
    zip.file(relativePath, await readFile(file));
  }

  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, `scholarmark-extension-v${manifest.version}.zip`);
  await writeFile(outputPath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  console.log(`[extension] packaged ${outputPath}`);
}

packageExtension().catch((error) => {
  console.error("[extension] package failed");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
