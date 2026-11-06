/**
 * ONE-OFF, November 2026. Not an npm script; delete once it has been used.
 *
 * The first IndexNow submission (HTTP 202 for 32 URLs) stored fingerprints of live pages whose
 * Cloudflare email-protection hex is random per response, so every later run saw all 32 pages as
 * changed. pageFingerprint now decodes that hex. This rewrites the stored fingerprints with the
 * fixed ones, keeping each receipt's status and submittedAt, after checking that:
 *
 *   1. the origin HTML on disk matches a SHA-256 manifest you verified independently,
 *   2. the recorded receipts are exactly those manifest URLs, all with status 200 or 202,
 *   3. every page fingerprints the same on two consecutive live fetches, and
 *   4. the usual live preflight (robots, sitemap, key file, canonical, noindex) passes.
 *
 * It only ever sends GET requests to https://scholarmark.ai/; anything else is refused before it
 * leaves the process, so it cannot reach IndexNow.
 *
 * Run from /opt/app as the deploy user, with INDEXNOW_SUBMIT_ON_DEPLOY still off:
 *
 *   (cd dist/marketing && sha256sum index.html $(find guides -name index.html | sort)) > /tmp/origin.sha256
 *   (compare /tmp/origin.sha256 with your saved hashes; it must list 32 files), then:
 *   node scripts/oneoff/indexnow-rebaseline-cloudflare-email.mjs --origin-sha256 /tmp/origin.sha256
 *   node scripts/oneoff/indexnow-rebaseline-cloudflare-email.mjs --origin-sha256 /tmp/origin.sha256 --apply
 *
 * Without --apply it checks and writes nothing. --apply first copies the state file to
 * <state>.pre-rebaseline-<timestamp>.json, then verifies a fresh live pass matches what it wrote.
 */
import { createHash } from "node:crypto";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_STATE_PATH,
  IndexNowError,
  SITE_ORIGIN,
  isSubmittableUrl,
  pageFingerprint,
  runIndexNow,
} from "../indexnow-submit.mjs";

const GUIDE_FILE = /^guides\/([a-z0-9]+(?:-[a-z0-9]+)*)\/index\.html$/;

/** Maps a built file path (relative to dist/marketing) to its canonical URL, or null. */
export function originFileToUrl(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized === "index.html") return `${SITE_ORIGIN}/`;
  if (normalized === "guides/index.html") return `${SITE_ORIGIN}/guides/`;
  const guide = normalized.match(GUIDE_FILE);
  return guide ? `${SITE_ORIGIN}/guides/${guide[1]}/` : null;
}

/** Parses `sha256sum` output (text or `*` binary markers, LF or CRLF) into url -> {file, sha256}. */
export function parseOriginManifest(text) {
  const entries = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^([0-9a-fA-F]{64}) [ *](.+)$/);
    if (!match) throw new IndexNowError(`manifest line is not sha256sum output: ${line}`);
    const file = match[2].trim().replace(/\\/g, "/").replace(/^\.\//, "");
    const url = originFileToUrl(file);
    if (!url || !isSubmittableUrl(url)) {
      throw new IndexNowError(`manifest lists ${file}, which is not a homepage/guide page`);
    }
    if (entries.has(url)) throw new IndexNowError(`manifest lists ${url} twice`);
    entries.set(url, { file, sha256: match[1].toLowerCase() });
  }
  if (entries.size === 0) throw new IndexNowError("manifest is empty");
  return entries;
}

/** A fetch that can only GET the public site; everything else throws before any request. */
export function publicGetOnly(fetchImpl) {
  return (url, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET" || !String(url).startsWith(`${SITE_ORIGIN}/`)) {
      throw new IndexNowError(
        `refused ${method} ${url}: this migration only reads the public site`,
      );
    }
    return fetchImpl(url, init);
  };
}

export async function rebaselineFromOrigin({
  apply = false,
  manifestText,
  originDir = path.join("dist", "marketing"),
  env = process.env,
  fetchImpl = globalThis.fetch,
  log = console.log,
  logError = console.error,
  now = () => new Date(),
} = {}) {
  const info = (message) => log(`[indexnow-rebaseline] ${message}`);
  const get = publicGetOnly(fetchImpl);
  const statePath = env.INDEXNOW_STATE_PATH?.trim() || DEFAULT_STATE_PATH;

  try {
    const manifest = parseOriginManifest(manifestText);
    for (const [url, { file, sha256 }] of manifest) {
      const actual = createHash("sha256")
        .update(await readFile(path.join(originDir, ...file.split("/"))))
        .digest("hex");
      if (actual !== sha256) {
        throw new IndexNowError(`origin ${file} (${url}) does not match the manifest hash`);
      }
    }
    info(`origin matches the manifest for ${manifest.size} pages`);

    const state = JSON.parse(await readFile(statePath, "utf8"));
    const recorded = Object.keys(state?.urls ?? {});
    const unmatched = [
      ...recorded.filter((url) => !manifest.has(url)),
      ...[...manifest.keys()].filter((url) => !state.urls[url]),
    ];
    if (unmatched.length > 0) {
      throw new IndexNowError(
        `recorded receipts and manifest differ (${unmatched.length} URLs, e.g. ${unmatched[0]})`,
      );
    }
    const statusBefore = Object.fromEntries(
      recorded.map((url) => [url, [state.urls[url].status, state.urls[url].submittedAt]]),
    );

    const fingerprintLive = async (url) => {
      const response = await get(url, { method: "GET", redirect: "manual" });
      const html = await response.text();
      if (response.status !== 200) throw new IndexNowError(`${url} returned ${response.status}`);
      try {
        return pageFingerprint(html);
      } catch (error) {
        throw new IndexNowError(`${url}: ${error.message}`);
      }
    };
    for (const url of manifest.keys()) {
      if ((await fingerprintLive(url)) !== (await fingerprintLive(url))) {
        throw new IndexNowError(`${url} fingerprints differently on two consecutive fetches`);
      }
    }
    info(`all ${manifest.size} live pages fingerprint identically on repeated fetches`);

    if (!apply) {
      info("check passed; nothing written. Re-run with --apply to rebaseline.");
      return 0;
    }

    const backupPath = `${statePath}.pre-rebaseline-${now().toISOString().replace(/[:.]/g, "-")}.json`;
    await copyFile(statePath, backupPath);
    info(`backed up the state file to ${backupPath}`);

    const code = await runIndexNow({ mode: "rebaseline", env, fetchImpl: get, log, logError, now });
    if (code !== 0) return code;

    const after = JSON.parse(await readFile(statePath, "utf8"));
    for (const url of manifest.keys()) {
      const entry = after.urls[url];
      const [status, submittedAt] = statusBefore[url];
      if (entry.status !== status || entry.submittedAt !== submittedAt) {
        throw new IndexNowError(`${url} receipt changed during rebaseline`);
      }
      if (entry.fingerprint !== (await fingerprintLive(url))) {
        throw new IndexNowError(`${url} still differs from the live page after rebaseline`);
      }
    }
    info(`done: a fresh live pass matches all ${manifest.size} rebaselined fingerprints`);
    return 0;
  } catch (error) {
    logError(`[indexnow-rebaseline] ERROR: ${error?.message ?? error}`);
    return 1;
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const manifestIndex = args.indexOf("--origin-sha256");
  const originDirIndex = args.indexOf("--origin-dir");
  const known = new Set(["--origin-sha256", "--origin-dir", "--apply"]);
  const manifestPath = manifestIndex === -1 ? undefined : args[manifestIndex + 1];
  const values = new Set([manifestIndex + 1, originDirIndex + 1].filter((index) => index > 0));
  if (!manifestPath || args.some((arg, index) => !values.has(index) && !known.has(arg))) {
    console.error(
      "usage: node scripts/oneoff/indexnow-rebaseline-cloudflare-email.mjs --origin-sha256 FILE [--origin-dir dist/marketing] [--apply]",
    );
    process.exit(2);
  }
  await import("dotenv/config");
  process.exitCode = await rebaselineFromOrigin({
    apply: args.includes("--apply"),
    manifestText: await readFile(manifestPath, "utf8"),
    ...(originDirIndex === -1 ? {} : { originDir: args[originDirIndex + 1] }),
  });
}
