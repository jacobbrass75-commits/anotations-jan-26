// Tests for the App Store listing and screenshot checkers. Run: node --test ios/Tools/
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

import { checkKeywords, checkMetadata, unsupportedClaims } from "./check-app-store-metadata.mjs";
import { checkDirectory, classify, encodeChunk, flattenPNG, inspectJPEG, inspectPNG } from "./check-app-store-screenshots.mjs";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Builds a PNG whose rows cycle through filter types 0-4, so decoding is fully exercised. */
function makePNG(width, height, colorType, pixel, { extraChunks = [] } = {}) {
  const channels = { 2: 3, 6: 4 }[colorType];
  const stride = width * channels;
  const rows = [];
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const line = Buffer.alloc(stride);
    for (let x = 0; x < width; x += 1) pixel(x, y).slice(0, channels).forEach((v, c) => { line[x * channels + c] = v; });
    const filter = y % 5;
    const encoded = Buffer.alloc(stride);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = previous[i];
      const c = i >= channels ? previous[i - channels] : 0;
      const p = a + b - c;
      const pred = [0, a, b, (a + b) >> 1, Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c][filter];
      encoded[i] = (line[i] - pred) & 0xff;
    }
    rows.push(Buffer.from([filter]), encoded);
    previous = line;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = colorType;
  return Buffer.concat([
    SIGNATURE,
    encodeChunk("IHDR", ihdr),
    ...extraChunks,
    encodeChunk("IDAT", deflateSync(Buffer.concat(rows))),
    encodeChunk("IEND", Buffer.alloc(0)),
  ]);
}

function decodeRGB(buffer) {
  const info = inspectPNG(buffer);
  const idat = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    if (buffer.toString("latin1", offset + 4, offset + 8) === "IDAT") idat.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = info.width * 3 + 1;
  return (x, y) => [...raw.subarray(y * stride + 1 + x * 3, y * stride + 4 + x * 3)];
}

const pattern = (x, y) => [(x * 7 + y) & 0xff, (y * 13) & 0xff, (x ^ y) & 0xff, x % 2 ? 255 : 0];

test("classify knows Apple's accepted sizes in both orientations", () => {
  assert.deepEqual(classify(1206, 2622), { key: "iphone-6.3", orientation: "portrait" });
  assert.deepEqual(classify(2868, 1320), { key: "iphone-6.9", orientation: "landscape" });
  assert.deepEqual(classify(2064, 2752), { key: "ipad-13", orientation: "portrait" });
  assert.equal(classify(1200, 2600), null);
});

test("flattenPNG removes alpha, composites over white, and keeps size", () => {
  const rgba = makePNG(9, 11, 6, pattern);
  assert.equal(inspectPNG(rgba).hasAlpha, true);
  const flat = flattenPNG(rgba);
  const info = inspectPNG(flat);
  assert.deepEqual([info.width, info.height, info.colorType, info.hasAlpha], [9, 11, 2, false]);
  const at = decodeRGB(flat);
  for (let y = 0; y < 11; y += 1) {
    for (let x = 0; x < 9; x += 1) {
      const [r, g, b, a] = pattern(x, y);
      assert.deepEqual(at(x, y), a === 255 ? [r, g, b] : [255, 255, 255], `pixel ${x},${y}`);
    }
  }
});

test("flattenPNG treats an RGB tRNS color as transparent", () => {
  const trns = Buffer.alloc(6); // black is transparent
  const png = makePNG(4, 4, 2, (x) => (x === 0 ? [0, 0, 0] : [10, 20, 30]), { extraChunks: [encodeChunk("tRNS", trns)] });
  assert.equal(inspectPNG(png).hasAlpha, true);
  const at = decodeRGB(flattenPNG(png));
  assert.deepEqual(at(0, 2), [255, 255, 255]);
  assert.deepEqual(at(3, 2), [10, 20, 30]);
});

test("opaque PNGs are returned unchanged", () => {
  const rgb = makePNG(3, 3, 2, pattern);
  assert.equal(flattenPNG(rgb), rgb);
});

test("inspectJPEG reads the frame size", () => {
  // SOI, APP0 (len 16), SOF0 (len 17) with height 2622 and width 1206.
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 8, 0x0a, 0x3e, 0x04, 0xb6, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  const info = inspectJPEG(Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]));
  assert.deepEqual([info.width, info.height, info.hasAlpha], [1206, 2622, false]);
});

test("checkDirectory enforces sizes, alpha, and required display classes", () => {
  const dir = mkdtempSync(join(tmpdir(), "shots-"));
  try {
    mkdirSync(join(dir, "iphone-6.3"));
    writeFileSync(join(dir, "iphone-6.3", "01.png"), makePNG(1206, 2622, 6, () => [1, 2, 3, 255]));
    writeFileSync(join(dir, "wrong.png"), makePNG(100, 200, 2, () => [0, 0, 0]));

    const strict = checkDirectory(dir);
    assert.ok(strict.problems.some((p) => p.includes("01.png: has an alpha channel")));
    assert.ok(strict.problems.some((p) => p.includes("wrong.png: 100x200")));
    assert.ok(strict.problems.some((p) => p.includes("(ipad-13)")));

    rmSync(join(dir, "wrong.png"));
    const fixed = checkDirectory(dir, { flatten: true, required: ["iphone-6.3"] });
    assert.deepEqual(fixed.problems, []);
    assert.equal(inspectPNG(readFileSync(join(dir, "iphone-6.3", "01.png"))).hasAlpha, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unsupportedClaims allows negated mentions only", () => {
  assert.deepEqual(unsupportedClaims("This version does not sync with your account."), []);
  assert.deepEqual(unsupportedClaims("There is no account to create."), []);
  assert.equal(unsupportedClaims("Your library syncs across devices.").length, 1);
  assert.equal(unsupportedClaims("Back up to iCloud.").length, 1);
  assert.equal(unsupportedClaims("Import PDFs and highlight them.").length, 1);
  assert.equal(unsupportedClaims("AI summaries of every source.").length, 1);
});

test("checkKeywords flags short, repeated, app-name, and competitor keywords", () => {
  assert.deepEqual(checkKeywords("citation,MLA,APA", "ScholarMark"), []);
  const problems = checkKeywords("ab,citation,Citation,scholarmark notes,Zotero, quotes", "ScholarMark");
  assert.ok(problems.some((p) => p.includes('"ab"')));
  assert.ok(problems.some((p) => p.includes("repeated")));
  assert.ok(problems.some((p) => p.includes("app name")));
  assert.ok(problems.some((p) => p.includes("another app")));
  assert.ok(problems.some((p) => p.includes("spaces around commas")));
});

test("the checked-in listing metadata passes", () => {
  const { problems } = checkMetadata();
  assert.deepEqual(problems, []);
});

test("checkMetadata reports over-limit fields and bad URLs", () => {
  const dir = mkdtempSync(join(tmpdir(), "meta-"));
  try {
    mkdirSync(join(dir, "en-US"));
    mkdirSync(join(dir, "review_information"));
    writeFileSync(join(dir, "en-US", "name.txt"), "A Name That Is Definitely Longer Than Thirty\n");
    writeFileSync(join(dir, "en-US", "description.txt"), "x".repeat(4001));
    writeFileSync(join(dir, "en-US", "keywords.txt"), "citation");
    writeFileSync(join(dir, "en-US", "support_url.txt"), "example.org/support");
    writeFileSync(join(dir, "en-US", "privacy_url.txt"), "https://example.org/privacy");
    writeFileSync(join(dir, "review_information", "notes.txt"), "é".repeat(2001)); // 4002 bytes
    writeFileSync(join(dir, "copyright.txt"), "© Example");
    writeFileSync(join(dir, "primary_category.txt"), "EDUCATION");
    const { problems } = checkMetadata(dir);
    for (const expected of ["Name: 44 characters", "Description: 4001 characters", "support_url.txt: must be", "App Review notes: 4002 bytes", "copyright.txt: start with the year"]) {
      assert.ok(problems.some((p) => p.includes(expected)), `expected a problem containing "${expected}" in ${JSON.stringify(problems)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the in-app privacy link matches the listing's Privacy Policy URL", () => {
  const iosRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const listed = readFileSync(join(iosRoot, "AppStore", "metadata", "en-US", "privacy_url.txt"), "utf8").trim();
  const linksSource = readFileSync(join(iosRoot, "ScholarMarkCore", "Sources", "ScholarMarkCore", "AppLinks.swift"), "utf8");
  const inApp = linksSource.match(/privacyPolicy = URL\(string: "([^"]+)"\)/)?.[1];
  assert.equal(inApp, `${listed}#ios`);

  // The link is only ever handed to SwiftUI's Link, which opens it in the browser on tap.
  const settings = readFileSync(join(iosRoot, "ScholarMark", "Views", "SettingsView.swift"), "utf8");
  assert.match(settings, /Link\(destination: AppLinks\.privacyPolicy\) \{\s*Label\("Privacy Policy"/);
  const uses = settings.match(/AppLinks\.privacyPolicy/g) ?? [];
  assert.equal(uses.length, 1);
});

test("in-app privacy copy makes no blanket 'nothing leaves the device' claim", () => {
  // Lookups also carry the address, connection details, and site cookies (see the privacy
  // policy's iOS section), so the app may only say what lookups never send.
  const viewsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "ScholarMark");
  const swiftFiles = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? swiftFiles(join(dir, entry.name)) : entry.name.endsWith(".swift") ? [join(dir, entry.name)] : [],
    );
  const overclaim = /nothing (else )?(leaves|is sent from|is shared from) (your|the|this) (device|iphone|ipad)|never leaves? (your|the|this) (device|iphone|ipad)/i;
  const found = [];
  for (const file of swiftFiles(viewsDir)) {
    for (const literal of readFileSync(file, "utf8").match(/"(?:[^"\\\n]|\\.)*"/g) ?? []) {
      if (overclaim.test(literal)) found.push(`${file.split("/ios/")[1]}: ${literal}`);
    }
  }
  assert.deepEqual(found, []);

  const settings = readFileSync(join(viewsDir, "Views", "SettingsView.swift"), "utf8");
  const capture = readFileSync(join(viewsDir, "Views", "CaptureSourceView.swift"), "utf8");
  assert.match(settings, /Lookups never send your library, notes, or quotes\./);
  assert.match(capture, /lookups never send your library, notes, or quotes\./);
});

test("DEBUG-only preview and screenshot code is used only inside #if DEBUG", () => {
  // CI's simulator jobs build Debug, so a Release-only compile error (or screenshot fixtures
  // leaking into the App Store build) would first show up in the Release archive. #Preview bodies
  // are compiled in every configuration, so they count as ordinary code here.
  const appDir = join(dirname(fileURLToPath(import.meta.url)), "..", "ScholarMark");
  const swiftFiles = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? swiftFiles(join(dir, entry.name)) : entry.name.endsWith(".swift") ? [join(dir, entry.name)] : [],
    );
  const debugOnly = /\bScreenshotScene\b|\bscreenshotSample\(|\bLibraryStore\.preview\(/;
  const outside = [];
  for (const file of swiftFiles(appDir)) {
    const stack = []; // true for each enclosing #if DEBUG, false for any other #if
    readFileSync(file, "utf8").split("\n").forEach((line, index) => {
      const directive = line.trim();
      if (/^#if\b/.test(directive)) stack.push(/^#if DEBUG\b/.test(directive));
      else if (/^#else\b|^#elseif\b/.test(directive) && stack.length) stack[stack.length - 1] = false;
      else if (/^#endif\b/.test(directive)) stack.pop();
      else if (debugOnly.test(line) && !stack.includes(true) && !directive.startsWith("//")) {
        outside.push(`${file.split("/ios/")[1]}:${index + 1}: ${directive}`);
      }
    });
  }
  assert.deepEqual(outside, []);
});
