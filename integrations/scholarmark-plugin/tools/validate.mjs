#!/usr/bin/env node
// Validates the ScholarMark plugin package against the rules in the official
// Claude and OpenAI plugin docs (see ../README.md for the list of sources).
// Uses only Node built-ins (Node 22.2+).
//
//   node integrations/scholarmark-plugin/tools/validate.mjs            # offline checks
//   node integrations/scholarmark-plugin/tools/validate.mjs --live     # + unauthenticated endpoint probes
//   node integrations/scholarmark-plugin/tools/validate.mjs --claude-cli  # + `claude plugin validate --strict`
//
// Exit code 1 when any error is found. Warnings don't fail the run.

import { readFileSync, existsSync, statSync, lstatSync, readdirSync } from "node:fs";
import { dirname, join, resolve, relative, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const pluginRoot = resolve(option("--dir") ?? join(here, "..", "plugin"));
const repoRoot = resolve(here, "..", "..", "..");
const MCP_URL = "https://mcp.scholarmark.ai/mcp";
// --target claude|openai checks one packaging only, for an extracted ZIP.
const target = option("--target") ?? "both";
const checkClaude = target !== "openai";
const checkOpenai = target !== "claude";

const errors = [];
const warnings = [];
const notes = [];
const error = (message) => errors.push(message);
const warn = (message) => warnings.push(message);
const note = (message) => notes.push(message);

const rel = (path) => relative(pluginRoot, path).split(sep).join("/");
const pluginPath = (path) => join(pluginRoot, ...path.replace(/^\.\//, "").split("/"));

function readJson(path, label) {
  if (!existsSync(path)) {
    error(`${label}: file not found`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    error(`${label}: invalid JSON (${cause.message})`);
    return null;
  }
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (lstatSync(full).isSymbolicLink()) {
      error(`${rel(full)}: symbolic links aren't accepted by the Claude directory`);
      continue;
    }
    if (entry.isDirectory()) out.push(full, ...walk(full));
    else out.push(full);
  }
  return out;
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

// --- image helpers -----------------------------------------------------------

function imageSize(path) {
  const ext = extname(path).toLowerCase();
  const buf = readFileSync(path);
  if (ext === ".png") {
    if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (ext === ".svg") {
    const text = buf.toString("utf8");
    const viewBox = text.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/);
    if (viewBox) return { width: Number(viewBox[1]), height: Number(viewBox[2]) };
    const w = text.match(/\swidth\s*=\s*["']([\d.]+)/);
    const h = text.match(/\sheight\s*=\s*["']([\d.]+)/);
    return w && h ? { width: Number(w[1]), height: Number(h[1]) } : null;
  }
  return null;
}

function checkIcon(path, label, { maxBytes = 5 * 1024 * 1024 } = {}) {
  if (typeof path !== "string" || !path.startsWith("./")) {
    error(`${label}: must be a ./-prefixed path relative to the plugin root`);
    return;
  }
  const full = pluginPath(path);
  if (!existsSync(full)) {
    error(`${label}: ${path} not found`);
    return;
  }
  const ext = extname(full).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp", ".svg"].includes(ext)) {
    error(`${label}: ${path} must be PNG, JPEG, WebP, or SVG`);
  }
  if (statSync(full).size > maxBytes) error(`${label}: ${path} is larger than 5 MiB`);
  const size = imageSize(full);
  if (!size) {
    warn(`${label}: couldn't read the dimensions of ${path}`);
    return;
  }
  if (size.width !== size.height) error(`${label}: ${path} is ${size.width}x${size.height}; icons must be square`);
  if (size.width < 48) error(`${label}: ${path} is smaller than 48x48`);
  if (ext !== ".svg" && size.width > 4096) error(`${label}: ${path} is larger than 4096 px`);
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// --- skill helpers -----------------------------------------------------------

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return null;
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) {
      data.__unparsed = (data.__unparsed ?? 0) + 1;
      continue;
    }
    let value = kv[2].trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    data[kv[1]] = value;
  }
  return data;
}

function wordsOutsideCode(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .split(/\s+/)
    .filter((word) => /[A-Za-z]/.test(word)).length;
}

// --- ScholarMark tool inventory from the repo's MCP server source ------------

function loadToolInventory() {
  const source = join(repoRoot, "mcp-server", "dist", "mcp-tools.js");
  if (!existsSync(source)) return null;
  const text = readFileSync(source, "utf8");
  const registered = [...text.matchAll(/^\s*register\("([a-z_]+)"/gm)].map((m) => m[1]);
  const serverAiBlock = text.match(/const SERVER_AI_TOOLS = new Set\(\[([\s\S]*?)\]\)/);
  const serverAi = new Set(serverAiBlock ? [...serverAiBlock[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]) : []);
  const readOnly = new Set(
    [...text.matchAll(/^\s*([a-z_]+): \{ title: "[^"]*", annotations: READ_ONLY \}/gm)].map((m) => m[1]),
  );
  const host = registered.filter((name) => !serverAi.has(name));
  return { host: new Set(host), readOnly, serverAi };
}

// ============================================================================

console.log(`Validating ${pluginRoot} (target: ${target})\n`);

if (!existsSync(pluginRoot)) {
  console.error("Plugin directory not found.");
  process.exit(1);
}

// --- files -------------------------------------------------------------------

const files = walk(pluginRoot).filter((path) => statSync(path).isFile());
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
const TEXT_EXT = new Set([".md", ".json", ".txt", ".svg"]);
const SYSTEM_FILES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);
const seenLower = new Map();

if (files.length > 512) warn(`plugin has ${files.length} files; the Claude directory holds plugins over 512 files for review`);

for (const full of files) {
  const name = rel(full);
  const base = name.split("/").pop();
  const ext = extname(base).toLowerCase();
  const lower = name.toLowerCase();
  if (seenLower.has(lower)) error(`${name}: differs from ${seenLower.get(lower)} only by case`);
  seenLower.set(lower, name);
  if (SYSTEM_FILES.has(base.toLowerCase()) || name.includes("__MACOSX")) error(`${name}: remove OS system files`);
  if (/[:<>|"?*]/.test(base) || /[ .]$/.test(base)) error(`${name}: file name isn't valid on Windows and macOS`);
  if (base === "CLAUDE.md") warn(`${name}: a CLAUDE.md at the plugin root isn't loaded as context`);
  if (name.startsWith("bin/")) error(`${name}: a top-level bin/ directory blocks install on claude.ai and Cowork`);
  if (name.startsWith("hooks/")) error(`${name}: plugins with lifecycle hooks can't be submitted to the OpenAI directory`);
  if (base === ".app.json") error(`${name}: OpenAI rejects ZIPs with app references; declare the MCP URL in mcp.json`);
  if (!IMAGE_EXT.has(ext) && !TEXT_EXT.has(ext) && base !== "LICENSE") {
    warn(`${name}: not a text or image file; the Claude directory holds other binaries for review`);
  }
  const size = statSync(full).size;
  if (!IMAGE_EXT.has(ext) && size > 256 * 1024) warn(`${name}: over 256 KiB; the Claude directory holds it for review`);
  if (size > 5 * 1024 * 1024) error(`${name}: over 5 MiB`);
  if (TEXT_EXT.has(ext) || base === "LICENSE") {
    const text = readFileSync(full, "utf8");
    const secret = text.match(/\b(mcp_sm_[A-Za-z0-9]{8,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})/);
    if (secret) error(`${name}: looks like it contains a credential (${secret[1].slice(0, 12)}...)`);
  }
}

// --- README and license ------------------------------------------------------

const readmePath = join(pluginRoot, "README.md");
const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : "";
if (!readme) error("README.md: missing (the Claude directory requires one)");
else if (wordsOutsideCode(readme) < 40) error("README.md: needs at least 40 words outside code blocks");

// --- Claude manifest ---------------------------------------------------------

const claude = checkClaude ? readJson(join(pluginRoot, ".claude-plugin", "plugin.json"), ".claude-plugin/plugin.json") : null;
const RESERVED_WHOLE = new Set(["claude", "anthropic", "anthropics", "claude-code", "claude-mods", "official", "plugin", "mcp", "test"]);
const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

if (claude) {
  const label = ".claude-plugin/plugin.json";
  const allowed = new Set([
    "$schema", "name", "displayName", "version", "description", "author", "homepage", "repository", "license",
    "keywords", "metadata", "icon", "documentationUrl", "supportUrl", "privacyPolicyUrl", "termsOfServiceUrl",
    "defaultEnabled", "dependencies", "settings", "userConfig", "types", "channels", "skills", "commands", "agents",
    "hooks", "mcpServers", "lspServers", "outputStyles", "workflows", "experimental",
  ]);
  for (const key of Object.keys(claude)) if (!allowed.has(key)) warn(`${label}: unknown top-level field "${key}" is stripped by Claude Code`);
  if (!claude.name || !NAME_PATTERN.test(claude.name) || claude.name.length > 64) error(`${label}: name must be lowercase kebab-case, at most 64 characters`);
  if (RESERVED_WHOLE.has(claude.name) || /^(claude|anthropic|anthropics|cc-plugin)-/.test(claude.name ?? "")) error(`${label}: name "${claude.name}" is reserved`);
  for (const key of ["version", "description", "author"]) if (!claude[key]) warn(`${label}: set "${key}"`);
  if (!claude.author?.name) error(`${label}: author.name is required when author is set`);
  if (claude.homepage && !isHttpsUrl(claude.homepage)) error(`${label}: homepage must be an https URL`);
  for (const key of ["documentationUrl", "supportUrl", "privacyPolicyUrl", "termsOfServiceUrl"]) {
    if (claude[key] !== undefined && !isHttpsUrl(claude[key])) error(`${label}: ${key} must be an https URL`);
  }
  for (const key of ["supportUrl", "privacyPolicyUrl", "termsOfServiceUrl"]) if (!claude[key]) warn(`${label}: ${key} is recommended for the directory listing`);
  if (claude.icon) checkIcon(claude.icon, `${label} icon`);
  else warn(`${label}: no icon for the directory listing`);
  if (!claude.license && !existsSync(join(pluginRoot, "LICENSE"))) error(`${label}: set "license" or add a LICENSE file`);
  if (/[^\x20-\x7E]/.test(`${claude.displayName ?? ""}${claude.author?.name ?? ""}`)) {
    error(`${label}: displayName and author.name should use plain ASCII to avoid look-alike characters`);
  }
}

// Claude MCP servers: .mcp.json at the root and/or inline mcpServers.
const claudeServers = {};
const dotMcp = join(pluginRoot, ".mcp.json");
if (checkClaude && existsSync(dotMcp)) Object.assign(claudeServers, readJson(dotMcp, ".mcp.json")?.mcpServers ?? {});
if (claude?.mcpServers && typeof claude.mcpServers === "object" && !Array.isArray(claude.mcpServers)) {
  Object.assign(claudeServers, claude.mcpServers);
}
if (checkClaude && Object.keys(claudeServers).length === 0) error("Claude: no MCP server declared (.mcp.json or plugin.json mcpServers)");
for (const [name, server] of Object.entries(claudeServers)) {
  const label = `Claude MCP server "${name}"`;
  if (server.url !== undefined) {
    if (!["http", "sse", "ws"].includes(server.type)) error(`${label}: a url entry needs "type": "http", "sse", or "ws"`);
    if (!/^(https|wss):\/\//.test(server.url)) error(`${label}: url must be https:// or wss://`);
  }
  if (server.headers && Object.keys(server.headers).length) error(`${label}: don't ship headers; OAuth supplies the token`);
}

// --- OpenAI / Agent Plugins manifest -----------------------------------------

const openai = checkOpenai ? readJson(join(pluginRoot, "plugin.json"), "plugin.json") : null;
const tools = loadToolInventory();
if (!tools) warn("mcp-server/dist/mcp-tools.js not found; skipping tool-name cross-checks");

if (openai) {
  const label = "plugin.json";
  const PLUGIN_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
  const allowed = new Set(["$schema", "name", "version", "description", "author", "homepage", "repository", "license", "keywords", "extensions"]);
  if (openai.$schema !== PLUGIN_SCHEMA) error(`${label}: $schema must be ${PLUGIN_SCHEMA}`);
  for (const key of Object.keys(openai)) if (!allowed.has(key)) error(`${label}: "${key}" isn't allowed by the Agent Plugins schema`);
  if (!/^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(openai.name ?? "") || openai.name.length > 64) {
    error(`${label}: name doesn't match the Agent Plugins pattern`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(openai.version ?? "")) error(`${label}: use an explicit semantic version for submission`);
  if ((openai.description ?? "").length > 4000) error(`${label}: description over 4000 characters`);
  if (openai.author) {
    for (const key of Object.keys(openai.author)) if (!["name", "email", "url"].includes(key)) error(`${label}: author.${key} isn't allowed`);
    if ((openai.author.name ?? "").length > 120) error(`${label}: author.name over 120 characters`);
    if (openai.author.url && !isHttpsUrl(openai.author.url)) error(`${label}: author.url must be https`);
  }
  if (openai.homepage && !isHttpsUrl(openai.homepage)) error(`${label}: homepage must be https`);

  const ext = openai.extensions?.["com.openai"];
  if (!ext) error(`${label}: extensions["com.openai"] is missing`);
  const ui = ext?.interface ?? {};
  const limit = (key, max, required = true) => {
    const value = ui[key];
    if (value === undefined || value === "") {
      if (required) error(`${label}: interface.${key} is required`);
      return;
    }
    if (typeof value !== "string") error(`${label}: interface.${key} must be a string`);
    else if (value.length > max) error(`${label}: interface.${key} is ${value.length} characters; the limit is ${max}`);
  };
  limit("displayName", 30);
  limit("shortDescription", 30);
  limit("longDescription", 4000);
  limit("developerName", 80);
  limit("category", 200);
  if (/\b(mcp|mcp server|plugin)\s*$/i.test(ui.displayName ?? "")) error(`${label}: don't append "MCP" or "Plugin" to the display name`);
  for (const key of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"]) {
    if (!ui[key]) error(`${label}: interface.${key} is required for MCP review`);
    else if (!isHttpsUrl(ui[key]) || ui[key].length > 1024) error(`${label}: interface.${key} must be an https URL of at most 1024 characters`);
  }
  if (ui.capabilities !== undefined) {
    if (!Array.isArray(ui.capabilities) || ui.capabilities.length > 20) error(`${label}: capabilities must be an array of at most 20`);
    for (const item of ui.capabilities ?? []) if (String(item).length > 120) error(`${label}: capability "${item}" over 120 characters`);
  }
  const prompts = Array.isArray(ui.defaultPrompt) ? ui.defaultPrompt : ui.defaultPrompt ? [ui.defaultPrompt] : [];
  if (prompts.length > 3) error(`${label}: at most three defaultPrompt entries`);
  if (new Set(prompts).size !== prompts.length) error(`${label}: defaultPrompt entries must be unique`);
  for (const prompt of prompts) {
    if (prompt.length > 128) error(`${label}: defaultPrompt "${prompt.slice(0, 40)}..." over 128 characters`);
    if (prompt.includes("@")) error(`${label}: defaultPrompt must not @mention the app`);
  }
  for (const [key, background] of [["brandColor", "#FFFFFF"], ["brandColorDark", "#212121"]]) {
    if (ui[key] === undefined) continue;
    if (!/^#[0-9A-Fa-f]{6}$/.test(ui[key])) error(`${label}: interface.${key} must be #RRGGBB`);
    else if (contrast(ui[key], background) < 2) error(`${label}: interface.${key} has under 2:1 contrast against ${background}`);
    else note(`${key} ${ui[key]} contrast against ${background}: ${contrast(ui[key], background).toFixed(2)}:1`);
  }
  if (ui.logo) checkIcon(ui.logo, `${label} interface.logo`);
  else error(`${label}: interface.logo is required for submission`);
  if (ui.composerIcon) checkIcon(ui.composerIcon, `${label} interface.composerIcon`);
  for (const key of ["composerIconDark", "logoDark"]) if (ui[key]) checkIcon(ui[key], `${label} interface.${key}`);

  if (ext?.apps) error(`${label}: "apps" (.app.json) blocks OpenAI ZIP submission`);
  if (ext?.hooks) error(`${label}: lifecycle hooks block OpenAI directory submission`);
  if (ext?.onboardingSkill && !existsSync(pluginPath(ext.onboardingSkill))) error(`${label}: onboardingSkill ${ext.onboardingSkill} not found`);

  const review = ext?.review;
  const serialized = JSON.stringify(ext ?? {});
  if (/test_credentials|reviewer_instructions/.test(serialized)) error(`${label}: ZIP metadata rejects test_credentials and reviewer_instructions`);
  const positive = review?.test_cases?.positive ?? [];
  const negative = review?.test_cases?.negative ?? [];
  if (positive.length !== 5) error(`${label}: initial MCP review needs exactly 5 positive test cases (found ${positive.length})`);
  if (negative.length !== 3) error(`${label}: initial MCP review needs exactly 3 negative test cases (found ${negative.length})`);
  positive.forEach((test, index) => {
    for (const key of ["description", "prompt", "tools_triggered", "expected_behavior"]) {
      if (!test[key]) error(`${label}: positive case ${index + 1} is missing ${key}`);
    }
    if ((test.description ?? "").length > 4000) error(`${label}: positive case ${index + 1} description over 4000 characters`);
    if (tools) {
      for (const tool of String(test.tools_triggered ?? "").split(/[,\s]+/).filter(Boolean)) {
        if (!tools.host.has(tool)) error(`${label}: positive case ${index + 1} names "${tool}", which the host-mode server doesn't expose`);
      }
    }
  });
  negative.forEach((test, index) => {
    for (const key of ["description", "prompt"]) if (!test[key]) error(`${label}: negative case ${index + 1} is missing ${key}`);
  });
  if (!review?.demo_recording_url) warn(`${label}: review.demo_recording_url is required before MCP review (add it once the walkthrough video exists)`);
  else if (!isHttpsUrl(review.demo_recording_url)) error(`${label}: demo_recording_url must be https`);
  const translations = ext?.publication?.translations;
  for (const [locale, text] of Object.entries(translations ?? {})) {
    if ((text?.subtitle ?? "").length > 30) error(`${label}: ${locale} subtitle over 30 characters`);
    if ((text?.description ?? "").length > 4000) error(`${label}: ${locale} description over 4000 characters`);
  }
}

const portableMcp = checkOpenai ? readJson(join(pluginRoot, "mcp.json"), "mcp.json") : null;
if (portableMcp) {
  const label = "mcp.json";
  const MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
  if (portableMcp.$schema !== MCP_SCHEMA) error(`${label}: $schema must be ${MCP_SCHEMA}`);
  const servers = Object.entries(portableMcp.mcpServers ?? {});
  if (servers.length !== 1) error(`${label}: plugin-level review cases require exactly one MCP server (found ${servers.length})`);
  for (const [name, server] of servers) {
    if (server.type !== "streamable-http") error(`${label}: "${name}" should be "type": "streamable-http" for a remote server`);
    if (!isHttpsUrl(server.url ?? "")) error(`${label}: "${name}" url must be https`);
    if (server.headers && Object.keys(server.headers).length) error(`${label}: public submission rejects nonempty server headers`);
    const auth = server.extensions?.["com.openai"]?.auth;
    if (!auth) warn(`${label}: "${name}" has no auth declaration; the portal will rely on OAuth discovery only`);
    else {
      if (auth.type === "none") error(`${label}: don't declare a protected server as auth type "none"`);
      if (auth.clientSecret || auth.client?.clientSecret) error(`${label}: the manifest rejects clientSecret`);
      if (["dcr", "cimd"].includes(auth.client?.mode) && auth.client?.clientId) error(`${label}: don't include clientId with ${auth.client.mode}`);
      if (server.extensions) {
        note(
          `${label}: "${name}" uses extensions["com.openai"].auth as the OpenAI packaging guide shows. The published ` +
            "Agent Plugins mcp.schema.json 1.0.0 doesn't list 'extensions' on server entries, so a strict generic schema validator would reject it.",
        );
      }
    }
  }
}

// --- consistency between the two packagings ----------------------------------

if (claude && openai) {
  for (const key of ["name", "version", "description", "license", "homepage"]) {
    if (JSON.stringify(claude[key]) !== JSON.stringify(openai[key])) error(`manifests disagree on "${key}"`);
  }
  const ui = openai.extensions?.["com.openai"]?.interface ?? {};
  for (const [claudeKey, openaiKey] of [["supportUrl", "supportURL"], ["privacyPolicyUrl", "privacyPolicyURL"], ["termsOfServiceUrl", "termsOfServiceURL"]]) {
    if (claude[claudeKey] !== ui[openaiKey]) error(`manifests disagree on ${claudeKey} / ${openaiKey}`);
  }
  if (claude.displayName !== ui.displayName) error("manifests disagree on the display name");
}
const mcpUrls = new Set([
  ...Object.values(claudeServers).map((server) => server.url),
  ...Object.values(portableMcp?.mcpServers ?? {}).map((server) => server.url),
]);
if (mcpUrls.size !== 1 || !mcpUrls.has(MCP_URL)) error(`MCP URLs must all be ${MCP_URL} (found ${[...mcpUrls].join(", ")})`);

// --- skills ------------------------------------------------------------------

const skillsDir = join(pluginRoot, "skills");
const skillDirs = existsSync(skillsDir) ? readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory()) : [];
if (skillDirs.length === 0) error("skills/: no skills found");
for (const dir of skillDirs) {
  const skillFile = join(skillsDir, dir.name, "SKILL.md");
  const label = `skills/${dir.name}/SKILL.md`;
  if (!existsSync(skillFile)) {
    error(`${label}: missing`);
    continue;
  }
  const text = readFileSync(skillFile, "utf8");
  const front = parseFrontmatter(text);
  if (!front) {
    error(`${label}: missing YAML front matter`);
    continue;
  }
  if (front.__unparsed) error(`${label}: front matter has lines this validator can't parse; keep name and description on single lines`);
  if (front.name !== dir.name) error(`${label}: name "${front.name}" must match the folder name`);
  if (!NAME_PATTERN.test(front.name ?? "") || front.name.length > 64) error(`${label}: name must be lowercase kebab-case, at most 64 characters`);
  if (!front.description) error(`${label}: description is required`);
  else if (front.description.length > 1024) error(`${label}: description is ${front.description.length} characters; the limit is 1024`);
  for (const [, target] of text.matchAll(/\]\(((?!https?:|#)[^)\s]+)\)/g)) {
    const path = join(skillsDir, dir.name, ...target.split("#")[0].split("/"));
    if (!existsSync(path)) error(`${label}: link target ${target} not found`);
  }
  if (tools) {
    const mentioned = [...text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]);
    for (const file of walk(join(skillsDir, dir.name)).filter((p) => p.endsWith(".md"))) {
      mentioned.push(...[...readFileSync(file, "utf8").matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]));
    }
    for (const name of new Set(mentioned)) {
      if (tools.serverAi.has(name)) error(`skills/${dir.name}: mentions ${name}, which host-AI mode doesn't expose`);
      if (/^(get|save|find|read|search|create|add|upload|update|delete)_/.test(name) && !tools.host.has(name)) {
        error(`skills/${dir.name}: mentions ${name}, which the ScholarMark server doesn't register`);
      }
    }
  }
}

// README tool lists must match the server's read-only annotations.
if (tools && readme) {
  const section = (heading) => {
    const match = readme.match(new RegExp(`${heading}[^\\n]*:\\s*([^\\n]+)`));
    return match ? [...match[1].matchAll(/`([a-z_]+)`/g)].map((m) => m[1]) : [];
  };
  const readList = section("Read-only tools");
  const writeList = section("Tools that change your library");
  const listed = new Set([...readList, ...writeList]);
  for (const name of tools.host) if (!listed.has(name)) error(`README.md: host-mode tool ${name} isn't listed`);
  for (const name of listed) if (!tools.host.has(name)) error(`README.md: lists ${name}, which host mode doesn't expose`);
  for (const name of readList) if (!tools.readOnly.has(name)) error(`README.md: ${name} is listed as read-only but isn't annotated READ_ONLY`);
  for (const name of writeList) if (tools.readOnly.has(name)) error(`README.md: ${name} is listed as a write tool but is annotated READ_ONLY`);
  note(`tool inventory: ${tools.host.size} host-mode tools (${tools.readOnly.size - [...tools.readOnly].filter((n) => tools.serverAi.has(n)).length} read-only)`);
}

// --- optional: Claude Code's own validator ------------------------------------

if (flag("--claude-cli")) {
  const run = spawnSync("claude", ["plugin", "validate", "--strict", pluginRoot], { encoding: "utf8", shell: process.platform === "win32" });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
  if (run.error) warn(`claude CLI not runnable: ${run.error.message}`);
  else if (run.status !== 0) error(`claude plugin validate --strict failed:\n${output}`);
  else note(`claude plugin validate --strict: ${output.split("\n").pop()}`);
}

// --- optional: live, unauthenticated, read-only probes -------------------------

if (flag("--live")) {
  const get = async (url, init = {}) => {
    try {
      return await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000), ...init });
    } catch (cause) {
      return { ok: false, status: 0, cause };
    }
  };

  const urls = new Set();
  for (const full of files.filter((p) => /\.(md|json)$/.test(p))) {
    for (const [url] of readFileSync(full, "utf8").matchAll(/https:\/\/[^\s)"'`<>\]]+/g)) {
      if (/\.\.+$/.test(url)) continue; // ends in an ellipsis: an illustrative fragment, not a link
      urls.add(url.replace(/[.,;]+$/, ""));
    }
  }
  const skipped = (url) => url.includes("<") || url.includes("agent-plugins.org/schemas") || /api\.(crossref|datacite)\.org|doi\.org\/(api|ra)/.test(url);
  for (const url of [...urls].sort()) {
    if (skipped(url)) continue;
    const response = await get(url, { method: url === MCP_URL ? "HEAD" : "GET" });
    if (!response.ok) error(`live: ${url} returned ${response.status || response.cause?.message}`);
    else note(`live: ${url} ${response.status}`);
  }

  const resource = await (await get("https://mcp.scholarmark.ai/.well-known/oauth-protected-resource")).json?.().catch(() => null);
  if (resource?.resource !== "https://mcp.scholarmark.ai") error("live: protected resource metadata doesn't name https://mcp.scholarmark.ai");
  const issuer = resource?.authorization_servers?.[0];
  const metadata = issuer ? await (await get(`${issuer}/.well-known/oauth-authorization-server`)).json?.().catch(() => null) : null;
  if (!metadata?.registration_endpoint) error("live: authorization server metadata has no registration_endpoint (mcp.json declares DCR)");
  if (!metadata?.code_challenge_methods_supported?.includes("S256")) error("live: authorization server doesn't advertise PKCE S256");
  if (metadata) note(`live: OAuth issuer ${metadata.issuer}, DCR ${metadata.registration_endpoint}`);

  // initialize is allowed without a token; tools/list must answer 401 with resource metadata.
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  const init = await get(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "scholarmark-plugin-validate", version: "1.0.0" } },
    }),
  });
  const session = init.headers?.get?.("mcp-session-id");
  const body = init.ok ? await init.json().catch(() => null) : null;
  if (!body?.result?.serverInfo) error(`live: initialize failed (${init.status})`);
  else note(`live: ${body.result.serverInfo.name} ${body.result.serverInfo.version}, protocol ${body.result.protocolVersion}`);
  if (session) {
    const list = await get(MCP_URL, {
      method: "POST",
      headers: { ...headers, "Mcp-Session-Id": session },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const challenge = list.headers?.get?.("www-authenticate") ?? "";
    if (list.status !== 401 || !challenge.includes("resource_metadata=")) error(`live: tools/list without a token should return 401 with resource_metadata (got ${list.status})`);
    else note("live: tools/list without a token returns 401 with a resource_metadata challenge");
    await get(MCP_URL, { method: "DELETE", headers: { "Mcp-Session-Id": session } });
  }
}

// --- report ------------------------------------------------------------------

for (const message of notes) console.log(`note:    ${message}`);
for (const message of warnings) console.log(`warning: ${message}`);
for (const message of errors) console.log(`error:   ${message}`);
console.log(`\n${errors.length} error(s), ${warnings.length} warning(s), ${files.length} files checked.`);
process.exit(errors.length ? 1 : 0);
