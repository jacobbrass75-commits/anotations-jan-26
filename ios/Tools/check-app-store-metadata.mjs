#!/usr/bin/env node
// Checks the App Store Connect listing text in ios/AppStore/metadata against Apple's limits and
// against claims the app does not support. Node 18+, no dependencies.
//
//   node ios/Tools/check-app-store-metadata.mjs [metadata-dir]
//
// Limits (checked 2026-11-06):
// - Name 2-30 characters, subtitle up to 30 characters:
//   https://developer.apple.com/help/app-store-connect/reference/app-information/app-information
// - Promotional text 170 characters, description 4000 characters, keywords 100 bytes with each
//   keyword more than two characters, review notes 4000 bytes, URLs include the protocol:
//   https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = resolve(here, "../AppStore/metadata");

const chars = (text) => Array.from(text).length;
const bytes = (text) => Buffer.byteLength(text, "utf8");

/** Per-locale fields. `unit` is how Apple measures the limit. */
export const LOCALE_FIELDS = {
  "name.txt": { label: "Name", unit: "characters", min: 2, max: 30, required: true },
  "subtitle.txt": { label: "Subtitle", unit: "characters", max: 30 },
  "promotional_text.txt": { label: "Promotional text", unit: "characters", max: 170 },
  "description.txt": { label: "Description", unit: "characters", max: 4000, required: true },
  "keywords.txt": { label: "Keywords", unit: "bytes", max: 100, required: true },
  "release_notes.txt": { label: "What's New", unit: "characters", max: 4000 },
  "support_url.txt": { label: "Support URL", url: true, required: true },
  "marketing_url.txt": { label: "Marketing URL", url: true },
  "privacy_url.txt": { label: "Privacy Policy URL", url: true, required: true },
};

export const REVIEW_NOTES = { label: "App Review notes", unit: "bytes", max: 4000 };

/**
 * Features this version does not have. A sentence may mention one only to say the app does
 * not do it (it must contain "no", "not", "n't", or "without"). Applies to customer-facing text.
 */
export const UNSUPPORTED_CLAIMS = [
  { pattern: /\bsync(s|ed|ing|hroni[sz]\w*)?\b/i, why: "the app does not sync" },
  { pattern: /\bi?cloud\b/i, why: "there is no cloud storage or iCloud" },
  { pattern: /\bsign(ing)?[ -]?in\b|\blog(ging)?[ -]?in\b/i, why: "the app has no sign-in" },
  { pattern: /\b(AI|artificial intelligence|GPT|Claude|ChatGPT)\b/, why: "the iOS app has no AI features" },
  { pattern: /\bPDFs?\b/, why: "the app does not read PDFs" },
  { pattern: /\b(Safari|share) extension\b/i, why: "there is no share or Safari extension" },
  { pattern: /\b(free trial|subscription|in-app purchase|\$\d)/i, why: "pricing does not belong in listing text (guideline 2.3.7)" },
];
const NEGATION = /\b(no|not|without|never)\b|n't\b/i;

/** Other apps' and companies' names are not allowed in keywords. */
export const KEYWORD_BLOCKLIST = ["zotero", "endnote", "mendeley", "easybib", "citationmachine", "scribbr", "google", "notion", "apple"];

function sentences(text) {
  return text.split(/(?<=[.!?:;])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

export function unsupportedClaims(text) {
  const found = [];
  for (const sentence of sentences(text)) {
    for (const { pattern, why } of UNSUPPORTED_CLAIMS) {
      if (pattern.test(sentence) && !NEGATION.test(sentence)) found.push(`"${sentence}" (${why})`);
    }
  }
  return found;
}

export function checkKeywords(value, appName) {
  const problems = [];
  if (/,\s|\s,/.test(value)) problems.push("Keywords: remove spaces around commas; they count toward the 100 bytes");
  const words = value.split(",").map((w) => w.trim());
  const seen = new Set();
  for (const word of words) {
    if (chars(word) <= 2) problems.push(`Keywords: "${word}" must be more than two characters`);
    const lower = word.toLowerCase();
    if (seen.has(lower)) problems.push(`Keywords: "${word}" is repeated`);
    seen.add(lower);
    if (appName && lower.includes(appName.toLowerCase())) problems.push(`Keywords: "${word}" repeats the app name, which is already indexed`);
    if (KEYWORD_BLOCKLIST.some((name) => lower.replace(/\s+/g, "").includes(name))) problems.push(`Keywords: "${word}" names another app or company`);
  }
  return problems;
}

function checkLength(label, value, { unit, min, max }) {
  const size = unit === "bytes" ? bytes(value) : chars(value);
  const problems = [];
  if (max !== undefined && size > max) problems.push(`${label}: ${size} ${unit}, limit is ${max}`);
  if (min !== undefined && size < min) problems.push(`${label}: ${size} ${unit}, minimum is ${min}`);
  return { size, problems };
}

function read(path) {
  // Trailing newlines are a file convention, not part of the field.
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n").replace(/\n+$/, "");
}

/** Returns { rows, problems } where rows describe each field that was found. */
export function checkMetadata(dir = DEFAULT_DIR) {
  const rows = [];
  const problems = [];
  const locales = existsSync(dir) ? readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory() && n !== "review_information") : [];
  if (locales.length === 0) problems.push(`no locale folders (such as en-US) in ${dir}`);

  for (const locale of locales) {
    const values = {};
    for (const [file, spec] of Object.entries(LOCALE_FIELDS)) {
      const path = join(dir, locale, file);
      if (!existsSync(path)) {
        if (spec.required) problems.push(`${locale}/${file}: required field is missing`);
        continue;
      }
      const value = read(path);
      values[file] = value;
      if (spec.required && !value.trim()) problems.push(`${locale}/${file}: required field is empty`);
      if (/TODO|TBD|\[.*?\]|lorem ipsum/i.test(value)) problems.push(`${locale}/${file}: contains a placeholder`);
      if (spec.url) {
        let ok;
        try {
          ok = new URL(value).protocol === "https:";
        } catch {
          ok = false; // not a parseable URL
        }
        if (!ok) problems.push(`${locale}/${file}: must be a full https:// URL`);
        rows.push({ field: `${locale} ${spec.label}`, size: value, limit: "full URL with protocol" });
        continue;
      }
      if (file === "description.txt" && /<[a-z][^>]*>/i.test(value)) problems.push(`${locale}/${file}: HTML is not supported; use plain text`);
      const { size, problems: lengthProblems } = checkLength(`${locale} ${spec.label}`, value, spec);
      problems.push(...lengthProblems);
      rows.push({ field: `${locale} ${spec.label}`, size: `${size} ${spec.unit}`, limit: `${spec.min ? `${spec.min}-` : ""}${spec.max}` });
    }
    if (values["keywords.txt"] !== undefined) problems.push(...checkKeywords(values["keywords.txt"], values["name.txt"]).map((p) => `${locale} ${p}`));
    for (const file of ["name.txt", "subtitle.txt", "promotional_text.txt", "description.txt", "keywords.txt", "release_notes.txt"]) {
      if (values[file]) problems.push(...unsupportedClaims(values[file]).map((c) => `${locale}/${file}: unsupported claim ${c}`));
    }
  }

  const notesPath = join(dir, "review_information", "notes.txt");
  if (existsSync(notesPath)) {
    const { size, problems: lengthProblems } = checkLength(REVIEW_NOTES.label, read(notesPath), REVIEW_NOTES);
    problems.push(...lengthProblems);
    rows.push({ field: REVIEW_NOTES.label, size: `${size} bytes`, limit: String(REVIEW_NOTES.max) });
  } else {
    problems.push("review_information/notes.txt is missing");
  }
  for (const file of ["copyright.txt", "primary_category.txt"]) {
    const path = join(dir, file);
    if (!existsSync(path) || !read(path).trim()) problems.push(`${file}: required field is missing`);
  }
  const copyrightPath = join(dir, "copyright.txt");
  if (existsSync(copyrightPath) && !/^\d{4} \S/.test(read(copyrightPath))) {
    problems.push("copyright.txt: start with the year, e.g. \"2026 Example, Inc.\" (App Store Connect adds the © symbol)");
  }
  return { rows, problems };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { rows, problems } = checkMetadata(process.argv[2] ? resolve(process.argv[2]) : DEFAULT_DIR);
  for (const row of rows) console.log(`${row.field.padEnd(28)} ${String(row.size).padEnd(40)} limit ${row.limit}`);
  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`);
    process.exitCode = 1;
  } else {
    console.log("OK listing metadata is within App Store Connect limits.");
  }
}
