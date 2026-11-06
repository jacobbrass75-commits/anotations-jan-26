#!/usr/bin/env node
// Builds the upload ZIPs for each plugin directory from ../plugin, after
// running validate.mjs. Output is deterministic: sorted entries, fixed
// timestamps, and forward-slash paths, so the same source gives the same
// SHA-256. Uses only Node built-ins.
//
//   node integrations/scholarmark-plugin/tools/package.mjs
//
// Writes, under integrations/scholarmark-plugin/dist/:
//   scholarmark-openai-<version>.zip  plugin.json + mcp.json (Agent Plugins format) for ChatGPT and Codex
//   scholarmark-claude-<version>.zip  .claude-plugin/plugin.json for claude.ai "Upload plugin" and Claude Code
//   scholarmark-citation-audit-<version>.zip  skills-only Agent Plugins package (no MCP server), from
//                                     ../skills-only plus the canonical skill (see skills-only.mjs)
//   scholarmark-citation-audit-skill-<version>.zip  native Claude custom skill for Customize > Skills
//                                     upload: one citation-audit/ folder (see claude-skill.mjs)
// The plugin ZIPs hold the plugin files at their root, with no wrapping folder.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, mkdtempSync } from "node:fs";
import { dirname, join, resolve, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { skillsOnlyFiles } from "./skills-only.mjs";
import { buildClaudeSkill, validateClaudeSkillZip } from "./claude-skill.mjs";
import { buildZip, extractZip } from "./zip.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(here, "..", "plugin");
const skillsOnlyRoot = resolve(here, "..", "skills-only");
const distDir = resolve(here, "..", "dist");

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

mkdirSync(distDir, { recursive: true });
const all = listFiles(pluginRoot).sort();
let failed = false;

const builds = Object.entries(targets).map(([name, include]) => ({
  file: `scholarmark-${name}-${version}.zip`,
  target: name,
  entries: all.filter(include).map((path) => [path, readFileSync(join(pluginRoot, ...path.split("/")))]),
}));

let skillsOnly;
try {
  skillsOnly = skillsOnlyFiles(pluginRoot, skillsOnlyRoot);
} catch (err) {
  console.error(`\n${err.message}\nNo packages written.`);
  process.exit(1);
}
const skillsOnlyManifest = JSON.parse(skillsOnly.get("plugin.json").toString("utf8"));
builds.push({ file: `${skillsOnlyManifest.name}-${skillsOnlyManifest.version}.zip`, target: "skills-only", entries: [...skillsOnly] });

let claudeSkill;
try {
  claudeSkill = buildClaudeSkill(pluginRoot, skillsOnlyRoot);
} catch (err) {
  console.error(`\n${err.message}\nNo packages written.`);
  process.exit(1);
}
builds.push({ file: claudeSkill.fileName, target: "claude-skill", entries: claudeSkill.entries });

for (const { file: fileName, target, entries } of builds) {
  const zip = buildZip(entries);
  const file = join(distDir, fileName);
  writeFileSync(file, zip);
  const sha = createHash("sha256").update(zip).digest("hex");
  console.log(`\nwrote dist/${relative(distDir, file)}  ${entries.length} files, ${zip.length} bytes`);
  console.log(`sha256 ${sha}`);

  // Re-validate what was actually zipped.
  if (target === "claude-skill") {
    const problems = validateClaudeSkillZip(zip);
    for (const problem of problems) console.error(`error:   ${fileName}: ${problem}`);
    if (problems.length) failed = true;
    else console.log("native skill archive: one citation-audit/ folder, SKILL.md and Markdown references only");
    continue;
  }
  const scratch = mkdtempSync(join(tmpdir(), `scholarmark-${target}-`));
  try {
    extractZip(zip, scratch);
    if (!validate(scratch, target)) failed = true;
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
