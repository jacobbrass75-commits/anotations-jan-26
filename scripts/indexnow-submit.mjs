/**
 * IndexNow notification for the public marketing pages on https://scholarmark.ai.
 *
 *   node scripts/indexnow-submit.mjs                 Dry run: validate the live site, list what
 *                                                    would be sent. Sends nothing to IndexNow.
 *   node scripts/indexnow-submit.mjs --submit        Validate, then send new or changed URLs.
 *   node scripts/indexnow-submit.mjs --deploy-hook   Same as --submit, but only when
 *                                                    INDEXNOW_SUBMIT_ON_DEPLOY=true (default off).
 *
 * Only the apex homepage, the guide hub and canonical guide articles listed in the live sitemap
 * are ever submitted. Before any IndexNow request, the live robots.txt, sitemap, key file and
 * every candidate page are checked. Successful submissions (HTTP 200 or 202) are recorded in a
 * state file, so unchanged pages are not sent again. IndexNow only notifies participating search
 * engines; it does not guarantee crawling or indexing.
 *
 * The key is read from INDEXNOW_KEY and is never printed.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SITE_HOST = "scholarmark.ai";
export const SITE_ORIGIN = `https://${SITE_HOST}`;
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
/** Same rule as server/static.ts: a generated lowercase hex key of 32 or 64 characters. */
export const INDEXNOW_KEY_PATTERN = /^(?:[0-9a-f]{32}|[0-9a-f]{64})$/;
export const DEFAULT_STATE_PATH = path.join("data", "indexnow-state.json");
/** Protocol maximum per POST; this site is far below it, so larger sets are refused, not split. */
const MAX_URLS_PER_REQUEST = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;
const GUIDE_PATH = /^\/guides\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/;

const ERROR_MEANINGS = {
  400: "bad request (invalid format)",
  403: "forbidden (key not valid: key file missing or key not in it)",
  422: "unprocessable (URLs not on this host, or key does not match the protocol)",
  429: "too many requests (treated as potential spam)",
};

class IndexNowError extends Error {}

/** Only the apex homepage, guide hub and guide articles. Everything else is dropped. */
export function isSubmittableUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.href !== value) return false;
  if (url.protocol !== "https:" || url.host !== SITE_HOST) return false;
  if (url.username || url.password || url.search || url.hash) return false;
  return url.pathname === "/" || url.pathname === "/guides/" || GUIDE_PATH.test(url.pathname);
}

function decodeXml(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function parseSitemapLocs(xml) {
  return Array.from(xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g), ([, loc]) => decodeXml(loc));
}

/** Hashed `/_astro/` asset names change with any CSS/JS rebuild; they don't make a page "changed". */
export function pageFingerprint(html) {
  const normalized = html.replace(/\/_astro\/[A-Za-z0-9._-]+/g, "/_astro/");
  return createHash("sha256").update(normalized).digest("hex");
}

/** robots.txt groups that gate a submission: the default group and Bing's. */
export const ROBOTS_AGENTS = ["*", "bingbot"];

/**
 * RFC 9309 groups: one or more consecutive User-agent lines share the Allow/Disallow rules that
 * follow. Other records (Sitemap, Cloudflare's Content-Signal, comments) are ignored.
 */
export function parseRobotsGroups(text) {
  const groups = [];
  let current = null;
  let collectingAgents = false;
  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (!collectingAgents) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      collectingAgents = true;
    } else if (field === "allow" || field === "disallow") {
      if (current) current.rules.push({ allow: field === "allow", pattern: value });
      collectingAgents = false;
    }
  }
  return groups;
}

/**
 * Rules for one crawler: all groups naming it (merged), else all `*` groups (merged). Blocks
 * aimed at other bots, such as AI-training crawlers, never apply.
 */
export function robotsRulesFor(text, agent) {
  const groups = parseRobotsGroups(text);
  const named = agent === "*" ? [] : groups.filter((group) => group.agents.includes(agent));
  const chosen = named.length > 0 ? named : groups.filter((group) => group.agents.includes("*"));
  return chosen.flatMap((group) => group.rules);
}

function robotsPatternMatches(pattern, urlPath) {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`).test(urlPath);
}

/** Longest matching rule wins; on a tie Allow wins (RFC 9309). An empty Disallow allows all. */
export function robotsAllowsPath(rules, urlPath) {
  let allowLength = -1;
  let disallowLength = -1;
  for (const rule of rules) {
    if (!rule.pattern || !robotsPatternMatches(rule.pattern, urlPath)) continue;
    if (rule.allow) allowLength = Math.max(allowLength, rule.pattern.length);
    else disallowLength = Math.max(disallowLength, rule.pattern.length);
  }
  return disallowLength <= allowLength;
}

function hasNoindex(html, headers) {
  if (/noindex/i.test(headers.get("x-robots-tag") ?? "")) return true;
  return (html.match(/<meta\b[^>]*>/gi) ?? []).some(
    (tag) =>
      /\bname\s*=\s*["']?robots\b/i.test(tag) && /\bcontent\s*=\s*["'][^"']*noindex/i.test(tag),
  );
}

function canonicalHref(html) {
  const tag = (html.match(/<link\b[^>]*>/gi) ?? []).find((link) =>
    /\brel\s*=\s*["']?canonical\b/i.test(link),
  );
  return tag?.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] ?? null;
}

async function readState(statePath) {
  let text;
  try {
    text = await readFile(statePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, host: SITE_HOST, urls: {} };
    throw error;
  }
  let state;
  try {
    state = JSON.parse(text);
  } catch {
    state = null;
  }
  if (
    !state ||
    state.version !== 1 ||
    state.host !== SITE_HOST ||
    !state.urls ||
    typeof state.urls !== "object" ||
    Array.isArray(state.urls)
  ) {
    // Refuse rather than treat every page as new and resubmit the whole site.
    throw new IndexNowError(`state file ${statePath} is unreadable; fix or move it, then re-run`);
  }
  return state;
}

async function writeState(statePath, state) {
  await mkdir(path.dirname(path.resolve(statePath)), { recursive: true });
  const tempPath = `${statePath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o644 });
  await rename(tempPath, statePath);
}

/**
 * Runs one IndexNow pass. Returns a process exit code. `fetchImpl`, `env`, `log` and `now` are
 * injectable so tests never reach the network.
 */
export async function runIndexNow({
  mode = "dry-run",
  env = process.env,
  fetchImpl = globalThis.fetch,
  log = console.log,
  logError = console.error,
  now = () => new Date(),
} = {}) {
  const deployHook = mode === "deploy-hook";
  const submit = mode === "submit" || deployHook;
  const rawKey = env.INDEXNOW_KEY?.trim() ?? "";
  const redact = (text) => (rawKey ? String(text).split(rawKey).join("[redacted]") : String(text));
  const info = (message) => log(`[indexnow] ${redact(message)}`);
  const fail = (message) => {
    logError(`[indexnow] ERROR: ${redact(message)}`);
    return 1;
  };

  if (deployHook && env.INDEXNOW_SUBMIT_ON_DEPLOY?.trim().toLowerCase() !== "true") {
    info("deploy submission is off (INDEXNOW_SUBMIT_ON_DEPLOY is not true); nothing sent");
    return 0;
  }

  const marketingOn = env.SCHOLARMARK_MARKETING_SITE?.trim().toLowerCase() === "astro";
  const production = env.SITE_RELEASE_ENV?.trim().toLowerCase() === "production";
  if (!marketingOn || !production) {
    const message =
      "requires SCHOLARMARK_MARKETING_SITE=astro and SITE_RELEASE_ENV=production; nothing sent";
    if (deployHook) {
      info(`skipped: ${message}`);
      return 0;
    }
    return fail(message);
  }

  if (!INDEXNOW_KEY_PATTERN.test(rawKey)) {
    return fail("INDEXNOW_KEY is missing or not 32/64 lowercase hex characters; nothing sent");
  }
  const key = rawKey;
  const keyLocation = `${SITE_ORIGIN}/${key}.txt`;
  const statePath = env.INDEXNOW_STATE_PATH?.trim() || DEFAULT_STATE_PATH;

  const get = (url) =>
    fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      headers: { "user-agent": "scholarmark-indexnow-check" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

  try {
    const state = await readState(statePath);

    const robots = await get(`${SITE_ORIGIN}/robots.txt`);
    const robotsText = await robots.text();
    if (robots.status !== 200) throw new IndexNowError(`robots.txt returned ${robots.status}`);
    const robotsRules = ROBOTS_AGENTS.map((agent) => [agent, robotsRulesFor(robotsText, agent)]);
    for (const [agent, rules] of robotsRules) {
      if (!robotsAllowsPath(rules, "/")) {
        throw new IndexNowError(
          `robots.txt blocks the whole site for User-agent: ${agent} (non-production release?)`,
        );
      }
    }

    const sitemap = await get(`${SITE_ORIGIN}/sitemap.xml`);
    const sitemapText = await sitemap.text();
    if (sitemap.status !== 200 || !/xml/i.test(sitemap.headers.get("content-type") ?? "")) {
      throw new IndexNowError(`sitemap.xml returned ${sitemap.status}, not XML`);
    }
    const listed = parseSitemapLocs(sitemapText);
    const candidates = [...new Set(listed.filter(isSubmittableUrl))];
    const guideCount = candidates.filter((url) => GUIDE_PATH.test(new URL(url).pathname)).length;
    if (!candidates.includes(`${SITE_ORIGIN}/`) || !candidates.includes(`${SITE_ORIGIN}/guides/`)) {
      throw new IndexNowError("live sitemap does not list the homepage and guide hub");
    }
    info(
      `sitemap lists ${listed.length} URLs; ${candidates.length} eligible (homepage, guide hub, ${guideCount} guides)`,
    );
    for (const url of candidates) {
      for (const [agent, rules] of robotsRules) {
        if (!robotsAllowsPath(rules, new URL(url).pathname)) {
          throw new IndexNowError(`robots.txt blocks ${url} for User-agent: ${agent}`);
        }
      }
    }
    if (candidates.length > MAX_URLS_PER_REQUEST) {
      throw new IndexNowError(`${candidates.length} URLs exceed one IndexNow request`);
    }

    // Ownership: the exact root key file must hold the key as plain text. An HTML SPA fallback
    // or a redirect fails here, before anything is sent.
    const keyFile = await get(keyLocation);
    const keyBody = await keyFile.text();
    if (
      keyFile.status !== 200 ||
      !/^text\/plain\b/i.test(keyFile.headers.get("content-type") ?? "") ||
      keyBody.trim() !== key
    ) {
      throw new IndexNowError(
        `key file /[INDEXNOW_KEY].txt is not live as plain text with the key (status ${keyFile.status}); is INDEXNOW_KEY set in the running app?`,
      );
    }

    const changed = [];
    const fingerprints = {};
    for (const url of candidates) {
      const page = await get(url);
      const html = await page.text();
      if (page.status !== 200 || !/^text\/html\b/i.test(page.headers.get("content-type") ?? "")) {
        throw new IndexNowError(`${url} returned ${page.status}, not an HTML page`);
      }
      if (hasNoindex(html, page.headers)) throw new IndexNowError(`${url} is noindex`);
      const canonical = canonicalHref(html);
      if (canonical !== url) {
        throw new IndexNowError(`${url} has canonical ${canonical ?? "(none)"}, not itself`);
      }
      fingerprints[url] = pageFingerprint(html);
      if (state.urls[url]?.fingerprint !== fingerprints[url]) changed.push(url);
    }

    if (changed.length === 0) {
      info(`all ${candidates.length} eligible URLs are unchanged since their last submission`);
      return 0;
    }
    info(`${changed.length} new or changed URL(s):`);
    for (const url of changed) info(`  ${url}`);

    if (!submit) {
      info("dry run: nothing sent. Re-run with --submit to notify IndexNow.");
      return 0;
    }

    const response = await fetchImpl(INDEXNOW_ENDPOINT, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: SITE_HOST, key, keyLocation, urlList: changed }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const responseText = (await response.text().catch(() => "")).slice(0, 300);

    if (response.status !== 200 && response.status !== 202) {
      const meaning = ERROR_MEANINGS[response.status] ?? "unexpected response";
      throw new IndexNowError(
        `IndexNow returned ${response.status}: ${meaning}. Nothing recorded; fix the cause before re-running. ${responseText}`.trim(),
      );
    }

    const submittedAt = now().toISOString();
    const urls = {};
    for (const url of candidates) {
      if (changed.includes(url)) {
        urls[url] = { fingerprint: fingerprints[url], submittedAt, status: response.status };
      } else if (state.urls[url]) {
        urls[url] = state.urls[url];
      }
    }
    await writeState(statePath, { version: 1, host: SITE_HOST, urls });

    info(
      response.status === 200
        ? `IndexNow received ${changed.length} URL(s) (HTTP 200)`
        : `IndexNow received ${changed.length} URL(s) (HTTP 202: key verification pending)`,
    );
    info(`recorded in ${statePath}; this notifies engines and does not guarantee indexing`);
    return 0;
  } catch (error) {
    if (error instanceof IndexNowError) return fail(error.message);
    return fail(`${error?.name ?? "Error"}: ${error?.message ?? error}`);
  }
}

function parseMode(argv) {
  const args = argv.filter((arg) => arg !== "--");
  if (args.length === 0) return "dry-run";
  if (args.length === 1 && args[0] === "--submit") return "submit";
  if (args.length === 1 && args[0] === "--deploy-hook") return "deploy-hook";
  return null;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  const mode = parseMode(process.argv.slice(2));
  if (!mode) {
    console.error("usage: node scripts/indexnow-submit.mjs [--submit | --deploy-hook]");
    process.exit(2);
  }
  // Same .env as the app (cwd), without overriding variables already set.
  await import("dotenv/config");
  process.exitCode = await runIndexNow({ mode });
}
