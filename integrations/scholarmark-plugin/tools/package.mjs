#!/usr/bin/env node
// Builds the upload ZIPs for each plugin directory from ../plugin, after
// running validate.mjs. Output is deterministic: sorted entries, fixed
// timestamps, and forward-slash paths, so the same source gives the same
// SHA-256. Uses only Node built-ins (Node 22.2+ for zlib.crc32).
//
//   node integrations/scholarmark-plugin/tools/package.mjs
//
// Writes, under integrations/scholarmark-plugin/dist/:
//   scholarmark-openai-<version>.zip  plugin.json + mcp.json (Agent Plugins format) for ChatGPT and Codex
//   scholarmark-claude-<version>.zip  .claude-plugin/plugin.json for claude.ai "Upload plugin" and Claude Code
// Each ZIP holds the plugin files at its root, with no wrapping folder.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, mkdtempSync } from "node:fs";
import { dirname, join, resolve, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import zlib from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(here, "..", "plugin");
const distDir = resolve(here, "..", "dist");

if (typeof zlib.crc32 !== "function") {
  console.error("error: Node 22.2 or later is required (zlib.crc32).");
  process.exit(1);
}

const validate = (dir, target) =>
  spawnSync(process.execPath, [join(here, "validate.mjs"), "--dir", dir, "--target", target], { stdio: "inherit" }).status === 0;

if (!validate(pluginRoot, "both")) {
  console.error("\nValidation failed; no packages written.");
  process.exit(1);
}

const version = JSON.parse(readFileSync(join(pluginRoot, "plugin.json"), "utf8")).version;

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [relative(pluginRoot, full).split(sep).join("/")];
  });
}

const SHARED = (path) => path.startsWith("skills/") || path.startsWith("assets/") || path === "README.md" || path === "LICENSE";
const targets = {
  openai: (path) => SHARED(path) || path === "plugin.json" || path === "mcp.json",
  claude: (path) => SHARED(path) || path.startsWith(".claude-plugin/") || path === ".mcp.json",
};

// DOS date/time for 2026-01-01 00:00:00, applied to every entry.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

function buildZip(paths) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const path of paths) {
    const data = readFileSync(join(pluginRoot, ...path.split("/")));
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const name = Buffer.from(path, "utf8");
    const crc = zlib.crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // made by: Unix, spec 3.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // regular file, rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(paths.length, 8);
  end.writeUInt16LE(paths.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function extractZip(buffer, into) {
  let pointer = 0;
  while (buffer.readUInt32LE(pointer) === 0x04034b50) {
    const method = buffer.readUInt16LE(pointer + 8);
    const size = buffer.readUInt32LE(pointer + 18);
    const nameLength = buffer.readUInt16LE(pointer + 26);
    const extraLength = buffer.readUInt16LE(pointer + 28);
    const name = buffer.toString("utf8", pointer + 30, pointer + 30 + nameLength);
    const start = pointer + 30 + nameLength + extraLength;
    const raw = buffer.subarray(start, start + size);
    const target = join(into, ...name.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, method === 8 ? zlib.inflateRawSync(raw) : raw);
    pointer = start + size;
  }
}

mkdirSync(distDir, { recursive: true });
const all = listFiles(pluginRoot).sort();
let failed = false;

for (const [name, include] of Object.entries(targets)) {
  const paths = all.filter(include);
  const zip = buildZip(paths);
  const file = join(distDir, `scholarmark-${name}-${version}.zip`);
  writeFileSync(file, zip);
  const sha = createHash("sha256").update(zip).digest("hex");
  console.log(`\nwrote dist/${relative(distDir, file)}  ${paths.length} files, ${zip.length} bytes`);
  console.log(`sha256 ${sha}`);

  // Re-validate what was actually zipped.
  const scratch = mkdtempSync(join(tmpdir(), `scholarmark-${name}-`));
  try {
    extractZip(zip, scratch);
    if (!validate(scratch, name)) failed = true;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

writeFileSync(
  join(distDir, "SHA256SUMS"),
  readdirSync(distDir)
    .filter((file) => file.endsWith(".zip"))
    .sort()
    .map((file) => `${createHash("sha256").update(readFileSync(join(distDir, file))).digest("hex")}  ${file}`)
    .join("\n") + "\n",
);

if (failed) {
  console.error("\nA packaged ZIP failed validation.");
  process.exit(1);
}
console.log(`\nPackages are in ${distDir}`);
