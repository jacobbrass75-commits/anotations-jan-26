#!/usr/bin/env node
// Renders plugin/assets/logo.svg (a copy of client/public/favicon.svg) into the
// square PNG icons that both plugin directories read. Uses the repo's own
// `sharp` dependency, so run `npm ci` at the repo root first.
//
//   node integrations/scholarmark-plugin/tools/build-icons.mjs
//   node integrations/scholarmark-plugin/tools/build-icons.mjs --check

import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(here, "..", "plugin");
const repoRoot = resolve(here, "..", "..", "..");
const assets = join(pluginRoot, "assets");
const brandSource = join(repoRoot, "client", "public", "favicon.svg");
const svgPath = join(assets, "logo.svg");

const outputs = [
  { file: "logo.png", size: 512 },
  { file: "icon.png", size: 128 },
];

const checkOnly = process.argv.includes("--check");

if (existsSync(brandSource) && readFileSync(brandSource, "utf8") !== readFileSync(svgPath, "utf8")) {
  console.warn(
    "warning: plugin/assets/logo.svg differs from client/public/favicon.svg. Copy the current brand mark before rebuilding.",
  );
}

let sharp;
try {
  sharp = createRequire(join(repoRoot, "package.json"))("sharp");
} catch {
  console.error("error: sharp is not installed. Run `npm ci` at the repository root.");
  process.exit(1);
}

const svg = readFileSync(svgPath);
let stale = 0;
for (const { file, size } of outputs) {
  // density scales the 64-unit viewBox so the raster is rendered, not upscaled.
  const png = await sharp(svg, { density: Math.ceil((72 * size) / 64) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  const target = join(assets, file);
  if (checkOnly) {
    const current = existsSync(target) ? readFileSync(target) : null;
    const meta = current ? await sharp(current).metadata() : null;
    if (!meta || meta.width !== size || meta.height !== size) {
      console.error(`stale: assets/${file} is missing or not ${size}x${size}`);
      stale += 1;
    }
    continue;
  }
  writeFileSync(target, png);
  console.log(`wrote assets/${file} (${size}x${size}, ${png.length} bytes)`);
}
process.exit(stale ? 1 : 0);
