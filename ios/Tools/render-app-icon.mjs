// Renders ios/ScholarMark/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png from the
// ScholarMark brand mark (client/public/favicon.svg). Run from the repo root after `npm install`:
//   node ios/Tools/render-app-icon.mjs
// The background is full-bleed and opaque because iOS applies its own corner mask and
// App Store Connect rejects icons with an alpha channel.
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(root, "ios/ScholarMark/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png");
const SIZE = 1024;

// Same paths as favicon.svg (64-unit grid). The glyph spans x 16-48, y 14-52, so it is shifted
// up 1 unit to center it; that leaves about 20% padding on every side.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1f2937"/>
      <stop offset="1" stop-color="#111827"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="1.2"/>
      <feOffset dy="1" result="blur"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.35"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="64" height="64" fill="url(#bg)"/>
  <g transform="translate(0 -1)" filter="url(#shadow)">
    <path d="M16 14h17c5 0 9 4 9 9v27c0 1-1 2-2 2H23c-4 0-7-3-7-7V14Z" fill="#f8fafc"/>
    <path d="M22 20h12c3 0 5 2 5 5v21c-2-2-4-3-7-3H22V20Z" fill="#dc4b5d"/>
    <path d="M42 18h6v31l-3-3-3 3V18Z" fill="#fbbf24"/>
    <path d="M24 28h10M24 35h9" stroke="#f8fafc" stroke-width="3" stroke-linecap="round"/>
  </g>
</svg>`;

await sharp(Buffer.from(svg))
  .resize(SIZE, SIZE)
  .flatten({ background: "#111827" })
  .removeAlpha()
  .png({ compressionLevel: 9 })
  .toFile(out);

const meta = await sharp(out).metadata();
console.log(`${path.relative(root, out)}: ${meta.width}x${meta.height}, channels=${meta.channels}, alpha=${meta.hasAlpha}`);
