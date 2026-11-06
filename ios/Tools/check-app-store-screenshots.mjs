#!/usr/bin/env node
// Checks App Store screenshots against Apple's published specifications, and can remove alpha
// channels (Apple rejects screenshots with transparency). Node 18+, no dependencies.
//
//   node ios/Tools/check-app-store-screenshots.mjs [--flatten] [--require iphone-6.3,ipad-13] <dir>
//
// Source of the sizes, formats, and limits below (checked 2026-11-06):
// https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications
// "You must include at least one screenshot and can upload up to 10 screenshots per device size
// in .jpeg, .jpg, or .png formats" and "Images can't include alpha channels or transparencies."

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

/** Accepted portrait sizes per App Store Connect display class; landscape is the transpose. */
export const DISPLAY_CLASSES = {
  "iphone-6.9": { label: "iPhone with Dynamic Island (large display)", sizes: [[1260, 2736], [1290, 2796], [1320, 2868]] },
  "iphone-6.5": { label: "iPhone with Face ID (large display)", sizes: [[1284, 2778], [1242, 2688]] },
  "iphone-6.3": { label: "iPhone with Dynamic Island (medium display)", sizes: [[1179, 2556], [1206, 2622]] },
  "iphone-6.1": { label: "iPhone with Face ID (medium display)", sizes: [[1170, 2532], [1125, 2436], [1080, 2340]] },
  "ipad-13": { label: 'iPad 13" display', sizes: [[2064, 2752], [2048, 2732]] },
  "ipad-11": { label: 'iPad 11" display', sizes: [[1488, 2266], [1512, 2316], [1668, 2420], [1668, 2388], [1640, 2360]] },
};

/** Apple: "At least one screenshot for iPhone with Dynamic Island (medium display)" and, if the
 * app supports iPadOS, "At least one screenshot for iPad 13-inch display." */
export const DEFAULT_REQUIRED = ["iphone-6.3", "ipad-13"];
export const MAX_PER_DEVICE_SIZE = 10;
const EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function classify(width, height) {
  for (const [key, { sizes }] of Object.entries(DISPLAY_CLASSES)) {
    for (const [w, h] of sizes) {
      if (width === w && height === h) return { key, orientation: "portrait" };
      if (width === h && height === w) return { key, orientation: "landscape" };
    }
  }
  return null;
}

function readChunks(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("not a PNG file");
  const chunks = [];
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    chunks.push({ type, data: buffer.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
    if (type === "IEND") break;
  }
  return chunks;
}

export function inspectPNG(buffer) {
  const chunks = readChunks(buffer);
  const ihdr = chunks[0];
  if (!ihdr || ihdr.type !== "IHDR") throw new Error("PNG is missing its IHDR header");
  const colorType = ihdr.data[9];
  return {
    format: "png",
    width: ihdr.data.readUInt32BE(0),
    height: ihdr.data.readUInt32BE(4),
    bitDepth: ihdr.data[8],
    colorType,
    interlaced: ihdr.data[12] === 1,
    // Color types 4 and 6 carry an alpha channel; a tRNS chunk adds transparency to the rest.
    hasAlpha: colorType === 4 || colorType === 6 || chunks.some((c) => c.type === "tRNS"),
  };
}

export function inspectJPEG(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new Error("not a JPEG file");
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const length = buffer.readUInt16BE(offset + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      return { format: "jpeg", height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7), hasAlpha: false };
    }
    offset += 2 + length;
  }
  throw new Error("JPEG has no frame header");
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

export function encodeChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Re-encodes an 8-bit RGBA, gray+alpha, or RGB+tRNS PNG as opaque 8-bit RGB. Pixels are
 * composited over white, so fully opaque screenshots come out unchanged. */
export function flattenPNG(buffer) {
  const info = inspectPNG(buffer);
  if (!info.hasAlpha) return buffer;
  if (info.bitDepth !== 8 || info.interlaced || ![2, 4, 6].includes(info.colorType)) {
    throw new Error(`cannot flatten PNG with bit depth ${info.bitDepth}, color type ${info.colorType}, interlaced ${info.interlaced}`);
  }
  const chunks = readChunks(buffer);
  const channels = { 2: 3, 4: 2, 6: 4 }[info.colorType];
  const stride = info.width * channels;
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data)));
  if (raw.length !== (stride + 1) * info.height) throw new Error("PNG image data has an unexpected length");

  const trns = chunks.find((c) => c.type === "tRNS")?.data;
  const transparentRGB = info.colorType === 2 && trns?.length === 6 ? [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)] : null;

  const out = Buffer.alloc((info.width * 3 + 1) * info.height);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < info.height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      if (filter === 1) line[x] = (line[x] + left) & 0xff;
      else if (filter === 2) line[x] = (line[x] + up) & 0xff;
      else if (filter === 3) line[x] = (line[x] + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) line[x] = (line[x] + paeth(left, up, upLeft)) & 0xff;
      else if (filter !== 0) throw new Error(`unknown PNG filter type ${filter}`);
    }
    const row = y * (info.width * 3 + 1);
    out[row] = 0; // filter: none
    for (let x = 0; x < info.width; x += 1) {
      const p = x * channels;
      let r, g, b, a;
      if (info.colorType === 6) [r, g, b, a] = [line[p], line[p + 1], line[p + 2], line[p + 3]];
      else if (info.colorType === 4) [r, g, b, a] = [line[p], line[p], line[p], line[p + 1]];
      else {
        [r, g, b] = [line[p], line[p + 1], line[p + 2]];
        a = transparentRGB && r === transparentRGB[0] && g === transparentRGB[1] && b === transparentRGB[2] ? 0 : 255;
      }
      const over = (v) => Math.round((v * a + 255 * (255 - a)) / 255);
      out[row + 1 + x * 3] = over(r);
      out[row + 2 + x * 3] = over(g);
      out[row + 3 + x * 3] = over(b);
    }
    previous = line;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(info.width, 0);
  ihdr.writeUInt32BE(info.height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // Keep color-space chunks so colors render the same; drop alpha-related and image chunks.
  const keep = chunks.filter((c) => ["sRGB", "iCCP", "gAMA", "cHRM", "pHYs"].includes(c.type));
  return Buffer.concat([
    PNG_SIGNATURE,
    encodeChunk("IHDR", ihdr),
    ...keep.map((c) => encodeChunk(c.type, c.data)),
    encodeChunk("IDAT", deflateSync(out, { level: 9 })),
    encodeChunk("IEND", Buffer.alloc(0)),
  ]);
}

function listImages(dir) {
  const found = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...listImages(path));
    else if (EXTENSIONS.has(extname(name).toLowerCase())) found.push(path);
  }
  return found;
}

/** Returns { files, problems, counts }. Problems are human-readable strings; none means pass. */
export function checkDirectory(dir, { flatten = false, required = DEFAULT_REQUIRED } = {}) {
  const problems = [];
  const files = [];
  const counts = {};
  const images = listImages(dir);
  if (images.length === 0) problems.push(`no .png, .jpg, or .jpeg files under ${dir}`);

  for (const path of images) {
    const name = relative(dir, path);
    let buffer = readFileSync(path);
    let info;
    try {
      info = extname(path).toLowerCase() === ".png" ? inspectPNG(buffer) : inspectJPEG(buffer);
      if (info.hasAlpha && flatten && info.format === "png") {
        buffer = flattenPNG(buffer);
        writeFileSync(path, buffer);
        info = { ...inspectPNG(buffer), flattened: true };
      }
    } catch (error) {
      problems.push(`${name}: ${error.message}`);
      continue;
    }
    const display = classify(info.width, info.height);
    files.push({ name, ...info, display: display?.key ?? null, orientation: display?.orientation ?? null });
    if (!display) problems.push(`${name}: ${info.width}x${info.height} is not an accepted App Store screenshot size`);
    else counts[display.key] = (counts[display.key] ?? 0) + 1;
    if (info.hasAlpha) problems.push(`${name}: has an alpha channel or transparency (rerun with --flatten)`);
  }

  for (const [key, count] of Object.entries(counts)) {
    if (count > MAX_PER_DEVICE_SIZE) problems.push(`${key}: ${count} screenshots; App Store Connect accepts at most ${MAX_PER_DEVICE_SIZE} per device size`);
  }
  for (const key of required) {
    if (!DISPLAY_CLASSES[key]) problems.push(`unknown display class in --require: ${key}`);
    else if (!counts[key]) problems.push(`missing required screenshots for ${DISPLAY_CLASSES[key].label} (${key})`);
  }
  return { files, problems, counts };
}

function main(argv) {
  let flatten = false;
  let required = DEFAULT_REQUIRED;
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--flatten") flatten = true;
    else if (argv[i] === "--require") required = (argv[++i] ?? "").split(",").filter(Boolean);
    else rest.push(argv[i]);
  }
  if (rest.length !== 1) {
    console.error("usage: check-app-store-screenshots.mjs [--flatten] [--require iphone-6.3,ipad-13] <dir>");
    return 2;
  }
  const { files, problems } = checkDirectory(rest[0], { flatten, required });
  for (const f of files) {
    const label = f.display ? `${f.display} ${f.orientation}` : "unrecognized size";
    console.log(`${f.name}\t${f.width}x${f.height}\t${f.format}\t${label}${f.flattened ? "\t(alpha removed)" : ""}`);
  }
  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`);
    return 1;
  }
  console.log(`OK ${files.length} screenshots match Apple's screenshot specifications.`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
