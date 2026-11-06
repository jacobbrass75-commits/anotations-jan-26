// Builds the native Claude custom-skill ZIP for direct upload (claude.ai Customize >
// Skills > Upload skill, or unzipping into ~/.claude/skills/). It is the text-only
// skill from skills-only.mjs, so connected-mode passages are already removed, laid
// out as one top-level citation-audit/ folder that holds SKILL.md and its Markdown
// references. No manifest, MCP config, assets, scripts, or executables are included.
//
// Limits checked here (verified 2026-11-06):
//   - claude.ai "How to create custom skills": the ZIP contains the skill folder as its
//     root, the folder name matches the skill name, name at most 64 characters, and
//     description at most 200 characters.
//   - Agent Skills overview (platform docs): name is lowercase letters, numbers, and
//     hyphens without "anthropic" or "claude"; description is non-empty, at most 1,024
//     characters, and has no XML tags. The stricter 200-character upload limit applies.

import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { FORBIDDEN, skillsOnlyFiles } from "./skills-only.mjs";
import { buildZip, readZip } from "./zip.mjs";

export const CLAUDE_SKILL_NAME = "citation-audit";
export const CLAUDE_SKILL_DESCRIPTION_MAX = 200;
const NAME_MAX = 64;
const SOURCE_PREFIX = `skills/${CLAUDE_SKILL_NAME}/`;

// The canonical description (432 characters) is too long for a claude.ai upload. This
// shorter one keeps both what the skill does and when to use it.
export const CLAUDE_SKILL_DESCRIPTION =
  "Audit claims, quotations, page locators, and DOIs in an academic draft against source text in the conversation. Use to check citations, verify quotes, or find unsupported claims.";

export function claudeSkillZipName(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error(`claude skill: bad version "${version}"`);
  return `scholarmark-citation-audit-skill-${version}.zip`;
}

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split("\n")) {
    const pair = line.match(/^([a-z][a-z0-9_-]*):\s*(.*)$/);
    if (!pair) return { __unparsed: line };
    fields[pair[1]] = pair[2].trim();
  }
  return fields;
}

/** entries: [{ name, data, mode? }]. Returns a list of problems; empty means valid. */
export function validateClaudeSkillEntries(entries) {
  const problems = [];
  if (entries.length === 0) return ["archive is empty"];
  const names = new Set(entries.map((entry) => entry.name));
  const topLevel = new Set();
  for (const { name, mode } of entries) {
    if (name.endsWith("/")) problems.push(`${name}: directory entries are not used`);
    if (name.startsWith("/") || name.includes("\\") || name.split("/").some((part) => part === ".." || part === "" || part.startsWith("."))) {
      problems.push(`${name}: unsafe or hidden path`);
    }
    topLevel.add(name.split("/")[0]);
    if (!name.endsWith(".md")) problems.push(`${name}: only Markdown files belong in the skill`);
    if (mode !== undefined && mode !== 0o100644) problems.push(`${name}: mode ${mode.toString(8)} is not a plain rw-r--r-- file`);
  }
  if (topLevel.size !== 1 || !topLevel.has(CLAUDE_SKILL_NAME)) {
    problems.push(`expected exactly one top-level folder "${CLAUDE_SKILL_NAME}/", found ${[...topLevel].join(", ")}`);
  }

  const skillPath = `${CLAUDE_SKILL_NAME}/SKILL.md`;
  const skill = entries.find((entry) => entry.name === skillPath);
  if (!skill) return [...problems, `${skillPath} is missing`];
  const front = parseFrontmatter(skill.data.toString("utf8"));
  if (!front) problems.push("SKILL.md: missing YAML front matter");
  else if (front.__unparsed !== undefined) problems.push(`SKILL.md: unparsed front matter line "${front.__unparsed}"`);
  else {
    const keys = Object.keys(front).sort().join(",");
    if (keys !== "description,name") problems.push(`SKILL.md: front matter must hold only name and description, found ${keys}`);
    const { name = "", description = "" } = front;
    if (name !== CLAUDE_SKILL_NAME) problems.push(`SKILL.md: name "${name}" must match the folder name`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > NAME_MAX) problems.push("SKILL.md: name must be lowercase hyphen-case, at most 64 characters");
    if (/anthropic|claude/i.test(name)) problems.push("SKILL.md: name uses a reserved word");
    if (!description) problems.push("SKILL.md: description is required");
    if (description.length > CLAUDE_SKILL_DESCRIPTION_MAX) problems.push(`SKILL.md: description is ${description.length} characters; the upload limit is ${CLAUDE_SKILL_DESCRIPTION_MAX}`);
    if (/[<>]/.test(description)) problems.push("SKILL.md: description cannot contain angle brackets");
  }

  for (const { name, data } of entries) {
    const text = data.toString("utf8");
    for (const pattern of FORBIDDEN) {
      const hit = text.match(pattern);
      if (hit) problems.push(`${name}: connected-mode text "${hit[0]}"`);
    }
    for (const [, target] of text.matchAll(/\]\(((?!https?:|mailto:|#)[^)\s]+)\)/g)) {
      const resolved = posix.normalize(posix.join(posix.dirname(name), target.split("#")[0]));
      if (!names.has(resolved)) problems.push(`${name}: link target ${target} is not in the archive`);
    }
  }
  return problems;
}

export function validateClaudeSkillZip(buffer) {
  try {
    return validateClaudeSkillEntries(readZip(buffer));
  } catch (err) {
    return [err.message];
  }
}

/** Returns { name, version, fileName, entries: [path, Buffer][], zip }. Throws if invalid. */
export function buildClaudeSkill(pluginRoot, skillsOnlyRoot) {
  const version = JSON.parse(readFileSync(join(skillsOnlyRoot, "plugin.json"), "utf8")).version;
  const entries = [];
  for (const [path, data] of skillsOnlyFiles(pluginRoot, skillsOnlyRoot)) {
    if (!path.startsWith(SOURCE_PREFIX)) continue;
    let out = data;
    if (path === `${SOURCE_PREFIX}SKILL.md`) {
      const text = data.toString("utf8");
      const count = (text.match(/^description: .*$/gm) ?? []).length;
      if (count !== 1) throw new Error(`claude skill: expected one description line in SKILL.md, found ${count}`);
      out = Buffer.from(text.replace(/^description: .*$/m, `description: ${CLAUDE_SKILL_DESCRIPTION}`), "utf8");
    }
    entries.push([`${CLAUDE_SKILL_NAME}/${path.slice(SOURCE_PREFIX.length)}`, out]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : 1));
  const problems = validateClaudeSkillEntries(entries.map(([name, data]) => ({ name, data })));
  if (problems.length) throw new Error(`claude skill: ${problems.join("; ")}`);
  return { name: CLAUDE_SKILL_NAME, version, fileName: claudeSkillZipName(version), entries, zip: buildZip(entries) };
}
