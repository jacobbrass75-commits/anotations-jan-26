import { execFile } from "child_process";
import { createHash } from "crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { INDEXNOW_KEY_PATTERN as SERVER_INDEXNOW_KEY_PATTERN } from "../../server/static";
import {
  INDEXNOW_ENDPOINT,
  INDEXNOW_KEY_PATTERN,
  decodeCloudflareEmail,
  isSubmittableUrl,
  normalizeCloudflareEmails,
  pageFingerprint,
  parseRobotsGroups,
  parseSitemapLocs,
  robotsAllowsPath,
  robotsRulesFor,
  runIndexNow,
} from "../../scripts/indexnow-submit.mjs";
import {
  parseOriginManifest,
  publicGetOnly,
  rebaselineFromOrigin,
} from "../../scripts/oneoff/indexnow-rebaseline-cloudflare-email.mjs";

// Test-only key. Every request below goes to an in-memory mock; nothing leaves the process.
const KEY = "fedcba9876543210fedcba9876543210";
const SITE = "https://scholarmark.ai";
const GUIDES = ["apa-7-direct-quotation-citations", "scholarmark-vs-zotero", "best-tools-2026"];
const PUBLIC_URLS = [`${SITE}/`, `${SITE}/guides/`, ...GUIDES.map((g) => `${SITE}/guides/${g}/`)];

interface MockResponse {
  status: number;
  type?: string;
  body?: string;
  headers?: Record<string, string>;
}

interface Call {
  url: string;
  method: string;
  redirect?: string;
  body?: string;
}

/** Origin HTML, footer included, as the app serves it before Cloudflare. */
function html(
  canonical: string,
  extra = "",
  robots = "index, follow",
  email = "support@scholarmark.ai",
) {
  return `<html><head><meta name="robots" content="${robots}"><link rel="canonical" href="${canonical}"><link rel="stylesheet" href="/_astro/BaseLayout.CZlErd4B.css"></head><body>${extra}<footer><ul data-astro-cid-nns7i3if><li data-astro-cid-nns7i3if><a href="mailto:${email}" data-astro-cid-nns7i3if>${email}</a></li></ul></footer></body></html>`;
}

/** Cloudflare's email-protection encoding: a key byte, then the UTF-8 text XORed with it. */
function cfEncode(text: string, key: number) {
  const bytes = Buffer.from(text, "utf8").map((byte) => byte ^ key);
  return key.toString(16).padStart(2, "0") + Buffer.from(bytes).toString("hex");
}

/**
 * What Cloudflare email obfuscation does to each HTML response: mailto links and the visible
 * address are re-encoded with a fresh key, and the decoder script is injected.
 */
function cloudflareProtect(origin: string, nextKey: () => number) {
  if (!origin.includes("mailto:")) return origin;
  return origin
    .replace(
      /<a href="mailto:([^"]+)"([^>]*)>([^<]+)<\/a>/g,
      (_match, address: string, attrs: string, text: string) =>
        `<a href="/cdn-cgi/l/email-protection#${cfEncode(address, nextKey())}"${attrs}><span class="__cf_email__" data-cfemail="${cfEncode(text, nextKey())}">[email&#160;protected]</span></a>`,
    )
    .replace(
      "</body>",
      '<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script></body>',
    );
}

function sitemap(locs: string[]) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...locs.map((loc) => `  <url>\n    <loc>${loc.replace(/&/g, "&amp;")}</loc>\n  </url>`),
    "</urlset>",
  ].join("\n");
}

/** A healthy production site; tests override single routes. */
// Shape of the live Cloudflare-managed robots.txt: AI-training bots blocked site-wide (one group
// with consecutive User-agent lines), two `*` groups that allow / and keep the app's private
// paths disallowed, and search crawlers left alone.
const CLOUDFLARE_ROBOTS = [
  "# As a condition of accessing this website, you agree to abide by the following",
  "# content signals.",
  "",
  "# BEGIN Cloudflare Managed content",
  "",
  "User-agent: *",
  "Content-Signal: search=yes,ai-train=no",
  "Allow: /",
  "",
  "User-agent: Amazonbot",
  "Disallow: /",
  "",
  "User-agent: Applebot-Extended",
  "Disallow: /",
  "",
  "User-agent: Bytespider",
  "User-agent: CCBot",
  "Disallow: /",
  "",
  "User-agent: ClaudeBot",
  "Disallow: /",
  "",
  "User-agent: Google-Extended",
  "Disallow: /",
  "",
  "User-agent: GPTBot",
  "User-agent: meta-externalagent",
  "Disallow: /",
  "",
  "# END Cloudflare Managed Content",
  "",
  "User-agent: *",
  "Allow: /",
  "Disallow: /api/",
  "Disallow: /dashboard",
  "Disallow: /projects",
  "Disallow: /account",
  "Disallow: /admin",
  "Disallow: /sign-in",
  "Disallow: /sign-up",
  "",
  `Sitemap: ${SITE}/sitemap.xml`,
  "",
].join("\n");

function liveSite(): Map<string, MockResponse> {
  const routes = new Map<string, MockResponse>();
  routes.set(`${SITE}/robots.txt`, {
    status: 200,
    type: "text/plain",
    body: CLOUDFLARE_ROBOTS,
  });
  routes.set(`${SITE}/sitemap.xml`, {
    status: 200,
    type: "application/xml",
    body: sitemap([
      ...PUBLIC_URLS,
      // Listed in the real composed sitemap, but out of scope for IndexNow here.
      `${SITE}/pricing`,
      `${SITE}/faq`,
      `${SITE}/blog`,
      `${SITE}/blog/some-post`,
      // Never eligible, even if a sitemap ever listed them.
      `${SITE}/dashboard`,
      `${SITE}/api/projects`,
      `${SITE}/sign-up`,
      `${SITE}/guides/scholarmark-vs-zotero`,
      `${SITE}/guides/scholarmark-vs-zotero/?utm_source=x`,
      `${SITE}/guides/nested/path/`,
      `${SITE}/guides/Upper-Case/`,
      `http://scholarmark.ai/guides/scholarmark-vs-zotero/`,
      `https://www.scholarmark.ai/guides/`,
      `https://app.scholarmark.ai/guides/`,
      `https://staging.scholarmark.ai/`,
    ]),
  });
  routes.set(`${SITE}/${KEY}.txt`, { status: 200, type: "text/plain; charset=utf-8", body: KEY });
  for (const url of PUBLIC_URLS) {
    routes.set(url, { status: 200, type: "text/html; charset=utf-8", body: html(url, url) });
  }
  return routes;
}

let cloudflareKeySeed = 0;
// Deterministic, but a different key on every response, like the live site.
const nextCloudflareKey = () => (cloudflareKeySeed = (cloudflareKeySeed * 37 + 11) % 256);

function mockFetch(routes: Map<string, MockResponse>, indexNow: MockResponse = { status: 200 }) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const call: Call = {
      url,
      method: init.method ?? "GET",
      redirect: init.redirect,
      body: typeof init.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    const route =
      call.method === "POST" && url === INDEXNOW_ENDPOINT
        ? indexNow
        : call.method === "GET"
          ? routes.get(url)
          : undefined;
    if (!route) return new Response("not found", { status: 404 });
    const body = /^text\/html\b/.test(route.type ?? "")
      ? cloudflareProtect(route.body ?? "", nextCloudflareKey)
      : (route.body ?? "");
    return new Response(route.status === 204 ? null : body, {
      status: route.status,
      headers: { ...(route.type ? { "content-type": route.type } : {}), ...route.headers },
    });
  };
  return { calls, fetchImpl, posts: () => calls.filter((c) => c.method === "POST") };
}

describe("indexnow-submit", () => {
  let dir: string;
  let statePath: string;
  let output: string[];

  const env = (overrides: Record<string, string | undefined> = {}) => ({
    SCHOLARMARK_MARKETING_SITE: "astro",
    SITE_RELEASE_ENV: "production",
    INDEXNOW_KEY: KEY,
    INDEXNOW_STATE_PATH: statePath,
    ...overrides,
  });

  function run(mode: string, fetchImpl: unknown, envValues = env()) {
    return runIndexNow({
      mode,
      env: envValues,
      fetchImpl,
      log: (line: string) => output.push(line),
      logError: (line: string) => output.push(line),
      now: () => new Date("2026-11-06T12:00:00.000Z"),
    });
  }

  async function readState() {
    return JSON.parse(await readFile(statePath, "utf8"));
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "scholarmark-indexnow-"));
    statePath = join(dir, "data", "indexnow-state.json");
    output = [];
  });

  afterEach(async () => {
    // The key must never reach logs, whatever the outcome.
    expect(output.join("\n")).not.toContain(KEY);
    await rm(dir, { recursive: true, force: true });
  });

  it("does nothing on deploy unless INDEXNOW_SUBMIT_ON_DEPLOY=true", async () => {
    const site = mockFetch(liveSite());
    for (const flag of [undefined, "", "false", "1", "yes"]) {
      expect(
        await run("deploy-hook", site.fetchImpl, env({ INDEXNOW_SUBMIT_ON_DEPLOY: flag })),
      ).toBe(0);
    }
    expect(site.calls).toEqual([]);
    expect(output.at(-1)).toContain("deploy submission is off");
  });

  it("skips staging, preview and SPA releases without any request", async () => {
    const site = mockFetch(liveSite());
    const releases = [
      { SITE_RELEASE_ENV: "staging" },
      { SITE_RELEASE_ENV: "preview" },
      { SITE_RELEASE_ENV: undefined },
      { SCHOLARMARK_MARKETING_SITE: "spa" },
      { SCHOLARMARK_MARKETING_SITE: undefined },
    ];
    for (const release of releases) {
      const hookEnv = env({ INDEXNOW_SUBMIT_ON_DEPLOY: "true", ...release });
      expect(await run("deploy-hook", site.fetchImpl, hookEnv)).toBe(0);
      // A manual run in the wrong release is an operator mistake, so it fails loudly.
      expect(await run("submit", site.fetchImpl, env(release))).toBe(1);
    }
    expect(site.calls).toEqual([]);
  });

  it("refuses a missing or malformed key before any request", async () => {
    const site = mockFetch(liveSite());
    for (const key of [undefined, "", "abc12345", KEY.toUpperCase(), `${KEY}-x`, `${KEY}0`]) {
      expect(await run("submit", site.fetchImpl, env({ INDEXNOW_KEY: key }))).toBe(1);
      expect(
        await run(
          "deploy-hook",
          site.fetchImpl,
          env({ INDEXNOW_KEY: key, INDEXNOW_SUBMIT_ON_DEPLOY: "true" }),
        ),
      ).toBe(1);
    }
    expect(site.calls).toEqual([]);
  });

  it("dry run validates the live site but sends nothing and records nothing", async () => {
    const site = mockFetch(liveSite());
    expect(await run("dry-run", site.fetchImpl)).toBe(0);
    expect(site.posts()).toEqual([]);
    expect(site.calls.every((call) => call.url.startsWith(`${SITE}/`))).toBe(true);
    expect(site.calls.every((call) => call.redirect === "manual")).toBe(true);
    await expect(readFile(statePath, "utf8")).rejects.toThrow();
    expect(output.join("\n")).toContain("5 eligible (homepage, guide hub, 3 guides)");
    expect(output.join("\n")).toContain("dry run: nothing sent");
  });

  it("sends one POST with only the public pages, then never resends unchanged ones", async () => {
    const routes = liveSite();
    const first = mockFetch(routes);
    expect(await run("submit", first.fetchImpl)).toBe(0);

    const posts = first.posts();
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe("https://api.indexnow.org/indexnow");
    expect(posts[0].redirect).toBe("error");
    expect(JSON.parse(posts[0].body!)).toEqual({
      host: "scholarmark.ai",
      key: KEY,
      keyLocation: `https://scholarmark.ai/${KEY}.txt`,
      urlList: PUBLIC_URLS,
    });
    // Ownership and every page are checked before the POST.
    const postIndex = first.calls.indexOf(posts[0]);
    expect(first.calls.slice(0, postIndex).map((c) => c.url)).toEqual([
      `${SITE}/robots.txt`,
      `${SITE}/sitemap.xml`,
      `${SITE}/${KEY}.txt`,
      ...PUBLIC_URLS,
    ]);
    expect(postIndex).toBe(first.calls.length - 1);

    const state = await readState();
    expect(Object.keys(state.urls)).toEqual(PUBLIC_URLS);
    expect(state.urls[`${SITE}/`]).toMatchObject({
      status: 200,
      submittedAt: "2026-11-06T12:00:00.000Z",
    });
    expect(JSON.stringify(state)).not.toContain(KEY);

    // Same pages again, including a deploy that only rehashed CSS: nothing is sent.
    for (const url of PUBLIC_URLS) {
      routes.get(url)!.body = routes.get(url)!.body!.replace("CZlErd4B", "Zz99Yy88");
    }
    const second = mockFetch(routes);
    expect(await run("submit", second.fetchImpl)).toBe(0);
    expect(second.posts()).toEqual([]);
    expect(output.at(-1)).toContain("unchanged since their last submission");
    expect(await readState()).toEqual(state);
  });

  it("deploy hook sends only a changed or newly added guide", async () => {
    const routes = liveSite();
    expect(await run("submit", mockFetch(routes).fetchImpl)).toBe(0);
    const before = await readState();

    const changed = `${SITE}/guides/scholarmark-vs-zotero/`;
    const added = `${SITE}/guides/new-guide/`;
    routes.get(changed)!.body = html(changed, "updated copy");
    routes.set(added, { status: 200, type: "text/html", body: html(added, "new") });
    routes.get(`${SITE}/sitemap.xml`)!.body = sitemap([...PUBLIC_URLS, added]);

    const site = mockFetch(routes, { status: 202 });
    expect(
      await run("deploy-hook", site.fetchImpl, env({ INDEXNOW_SUBMIT_ON_DEPLOY: "true" })),
    ).toBe(0);
    expect(JSON.parse(site.posts()[0].body!).urlList).toEqual([changed, added]);
    expect(output.join("\n")).toContain("HTTP 202: key verification pending");

    const after = await readState();
    expect(after.urls[changed].status).toBe(202);
    expect(after.urls[changed].fingerprint).not.toBe(before.urls[changed].fingerprint);
    expect(after.urls[added].status).toBe(202);
    expect(after.urls[`${SITE}/`]).toEqual(before.urls[`${SITE}/`]);
  });

  it.each([400, 403, 422, 429, 500])(
    "treats HTTP %i as a failure and records nothing",
    async (status) => {
      const site = mockFetch(liveSite(), { status, body: `rejected ${KEY}` });
      expect(await run("submit", site.fetchImpl)).toBe(1);
      expect(site.posts()).toHaveLength(1);
      await expect(readFile(statePath, "utf8")).rejects.toThrow();
      expect(output.join("\n")).toContain(`IndexNow returned ${status}`);
      expect(output.join("\n")).toContain("rejected [redacted]");
    },
  );

  it("does not record a POST that fails in transit", async () => {
    const site = mockFetch(liveSite());
    const fetchImpl = async (url: string, init: RequestInit = {}) => {
      if (init.method === "POST") throw new TypeError("fetch failed");
      return site.fetchImpl(url, init);
    };
    expect(await run("submit", fetchImpl)).toBe(1);
    await expect(readFile(statePath, "utf8")).rejects.toThrow();
  });

  const brokenSites: Array<[string, (routes: Map<string, MockResponse>) => void, string]> = [
    [
      "a key path answered by the SPA fallback",
      (routes) =>
        routes.set(`${SITE}/${KEY}.txt`, {
          status: 200,
          type: "text/html",
          body: `<div id="root"></div>`,
        }),
      "key file",
    ],
    [
      "a key file with another key",
      (routes) =>
        routes.set(`${SITE}/${KEY}.txt`, {
          status: 200,
          type: "text/plain",
          body: "00000000000000000000000000000000",
        }),
      "key file",
    ],
    [
      "a redirected key file",
      (routes) =>
        routes.set(`${SITE}/${KEY}.txt`, {
          status: 308,
          headers: { location: "https://elsewhere.example/" },
        }),
      "key file",
    ],
    ["a missing key file", (routes) => routes.delete(`${SITE}/${KEY}.txt`), "key file"],
    [
      "a default-blocking staging robots.txt",
      (routes) =>
        routes.set(`${SITE}/robots.txt`, {
          status: 200,
          type: "text/plain",
          // Exactly what a non-production Astro build serves.
          body: "User-agent: *\nDisallow: /\n",
        }),
      "robots.txt blocks the whole site for User-agent: *",
    ],
    [
      "a Bing-specific site-wide block",
      (routes) =>
        routes.set(`${SITE}/robots.txt`, {
          status: 200,
          type: "text/plain",
          body: `${CLOUDFLARE_ROBOTS}\nUser-agent: Googlebot\nUser-agent: Bingbot\nDisallow: /\n`,
        }),
      "robots.txt blocks the whole site for User-agent: bingbot",
    ],
    [
      "a wildcard block of the guides",
      (routes) =>
        routes.set(`${SITE}/robots.txt`, {
          status: 200,
          type: "text/plain",
          body: CLOUDFLARE_ROBOTS.replace("Disallow: /api/", "Disallow: /api/\nDisallow: /guides"),
        }),
      `robots.txt blocks ${SITE}/guides/ for User-agent: *`,
    ],
    [
      "an empty staging sitemap",
      (routes) =>
        routes.set(`${SITE}/sitemap.xml`, {
          status: 200,
          type: "application/xml",
          body: sitemap([]),
        }),
      "does not list the homepage",
    ],
    [
      "a sitemap served as SPA HTML",
      (routes) =>
        routes.set(`${SITE}/sitemap.xml`, { status: 200, type: "text/html", body: "<html>" }),
      "not XML",
    ],
    [
      "a noindex guide",
      (routes) => {
        const url = `${SITE}/guides/scholarmark-vs-zotero/`;
        routes.set(url, { status: 200, type: "text/html", body: html(url, "", "noindex") });
      },
      "is noindex",
    ],
    [
      "an X-Robots-Tag noindex page",
      (routes) => {
        routes.get(`${SITE}/guides/`)!.headers = { "x-robots-tag": "noindex, nofollow" };
      },
      "is noindex",
    ],
    [
      "a guide whose canonical points elsewhere",
      (routes) => {
        const url = `${SITE}/guides/scholarmark-vs-zotero/`;
        routes.set(url, { status: 200, type: "text/html", body: html(`${SITE}/guides/`) });
      },
      "has canonical",
    ],
    [
      "a redirected guide",
      (routes) =>
        routes.set(`${SITE}/guides/best-tools-2026/`, {
          status: 308,
          headers: { location: `${SITE}/guides/` },
        }),
      "returned 308",
    ],
  ];

  it.each(brokenSites)("sends nothing for %s", async (_label, breakSite, message) => {
    const routes = liveSite();
    breakSite(routes);
    const site = mockFetch(routes);
    expect(await run("submit", site.fetchImpl)).toBe(1);
    expect(site.posts()).toEqual([]);
    expect(output.join("\n")).toContain(message);
    await expect(readFile(statePath, "utf8")).rejects.toThrow();
  });

  it("sees Cloudflare-protected pages as unchanged on repeated live-style dry runs", async () => {
    const routes = liveSite();
    const site = mockFetch(routes, { status: 202 });
    // The live bytes really differ per response, as on scholarmark.ai.
    const [a, b] = await Promise.all([1, 2].map(() => site.fetchImpl(`${SITE}/`)));
    const [textA, textB] = await Promise.all([a.text(), b.text()]);
    expect(textA).toContain("/cdn-cgi/l/email-protection#");
    expect(textA).not.toBe(textB);
    expect(textA.length).toBe(textB.length);

    expect(await run("submit", site.fetchImpl)).toBe(0);
    for (let pass = 0; pass < 3; pass++) {
      expect(await run("dry-run", site.fetchImpl)).toBe(0);
      expect(output.at(-1)).toContain("all 5 eligible URLs are unchanged");
    }
    expect(site.posts()).toHaveLength(1);
  });

  it("treats CRLF pages the same way", async () => {
    const routes = liveSite();
    for (const url of PUBLIC_URLS) {
      routes.get(url)!.body = html(url, `<main>\r\n<p>${url}</p>\r\n</main>`).replace(
        /></g,
        ">\r\n<",
      );
    }
    const site = mockFetch(routes);
    expect(await run("submit", site.fetchImpl)).toBe(0);
    expect(await run("dry-run", site.fetchImpl)).toBe(0);
    expect(output.at(-1)).toContain("unchanged");
  });

  it("still sees a real footer address edit as a change", async () => {
    const routes = liveSite();
    expect(await run("submit", mockFetch(routes).fetchImpl)).toBe(0);
    const edited = `${SITE}/guides/`;
    routes.get(edited)!.body = html(edited, edited, "index, follow", "help@scholarmark.ai");
    const site = mockFetch(routes);
    expect(await run("submit", site.fetchImpl)).toBe(0);
    expect(JSON.parse(site.posts()[0].body!).urlList).toEqual([edited]);
  });

  it("stops before any POST on a malformed Cloudflare encoding", async () => {
    const routes = liveSite();
    const url = `${SITE}/guides/scholarmark-vs-zotero/`;
    // No mailto, so the mock leaves this already-"protected" (and broken) markup alone.
    routes.get(url)!.body = html(
      url,
      '<span class="__cf_email__" data-cfemail="5a3">x</span>',
    ).replace(/<footer>.*<\/footer>/, "");
    const site = mockFetch(routes);
    expect(await run("submit", site.fetchImpl)).toBe(1);
    expect(site.posts()).toEqual([]);
    expect(output.join("\n")).toContain(`${url}: unrecognized Cloudflare email-protection value`);
    await expect(readFile(statePath, "utf8")).rejects.toThrow();
  });

  describe("rebaselining receipts recorded with per-response fingerprints", () => {
    const receivedAt = "2026-11-06T03:40:00.000Z";

    async function seedOldReceipts(urls = PUBLIC_URLS, status = 202) {
      // What the first live submission stored: one fingerprint per (random) response.
      const state = {
        version: 1,
        host: "scholarmark.ai",
        urls: Object.fromEntries(
          urls.map((url, index) => [
            url,
            { fingerprint: `${index}`.repeat(64).slice(0, 64), submittedAt: receivedAt, status },
          ]),
        ),
      };
      await mkdir(join(dir, "data"), { recursive: true });
      await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
      return state;
    }

    async function writeOrigin(root: string, eol = "\n", marker = " ") {
      const lines: string[] = [];
      for (const url of PUBLIC_URLS) {
        const pathname = new URL(url).pathname;
        const file = `${pathname.slice(1)}index.html`;
        const contents = html(url, url);
        await mkdir(join(root, ...file.split("/").slice(0, -1)), { recursive: true });
        await writeFile(join(root, ...file.split("/")), contents);
        lines.push(`${createHash("sha256").update(contents).digest("hex")} ${marker}${file}`);
      }
      return lines.join(eol) + eol;
    }

    it("rebaseline mode keeps receipts, sends nothing, and ends repeated changes", async () => {
      const before = await seedOldReceipts();
      const site = mockFetch(liveSite());
      expect(await run("dry-run", site.fetchImpl)).toBe(0);
      expect(output.join("\n")).toContain("5 new or changed URL(s)");

      expect(await run("rebaseline", site.fetchImpl)).toBe(0);
      const after = await readState();
      for (const url of PUBLIC_URLS) {
        expect(after.urls[url]).toMatchObject({
          status: before.urls[url].status,
          submittedAt: before.urls[url].submittedAt,
          rebaselinedAt: "2026-11-06T12:00:00.000Z",
        });
        expect(after.urls[url].fingerprint).not.toBe(before.urls[url].fingerprint);
      }

      for (let pass = 0; pass < 2; pass++) {
        expect(await run("dry-run", site.fetchImpl)).toBe(0);
        expect(output.at(-1)).toContain("all 5 eligible URLs are unchanged");
      }
      expect(site.posts()).toEqual([]);
    });

    it.each([
      ["a live URL with no receipt", () => seedOldReceipts(PUBLIC_URLS.slice(1))],
      [
        "a receipt for a URL no longer live",
        () => seedOldReceipts([...PUBLIC_URLS, `${SITE}/guides/removed/`]),
      ],
      ["a receipt with another status", () => seedOldReceipts(PUBLIC_URLS, 403)],
    ])("rebaseline refuses %s and changes nothing", async (_label, seed) => {
      await seed();
      const original = await readFile(statePath, "utf8");
      const site = mockFetch(liveSite());
      expect(await run("rebaseline", site.fetchImpl)).toBe(1);
      expect(await readFile(statePath, "utf8")).toBe(original);
      expect(site.posts()).toEqual([]);
    });

    it("is not reachable from the public CLI", async () => {
      const script = new URL("../../scripts/indexnow-submit.mjs", import.meta.url);
      const result = await promisify(execFile)(process.execPath, [
        fileURLToPath(script),
        "--rebaseline",
      ]).catch((error) => error);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("usage:");
    });

    it("one-off check verifies origin hashes and live stability, GET only, writing nothing", async () => {
      const originDir = join(dir, "origin");
      const manifestText = await writeOrigin(originDir, "\r\n", "*");
      const original = JSON.stringify(await seedOldReceipts(), null, 2) + "\n";
      const site = mockFetch(liveSite());
      const code = await rebaselineFromOrigin({
        manifestText,
        originDir,
        env: env(),
        fetchImpl: site.fetchImpl,
        log: (line: string) => output.push(line),
        logError: (line: string) => output.push(line),
      });
      expect(code).toBe(0);
      expect(await readFile(statePath, "utf8")).toBe(original);
      expect(
        site.calls.every((call) => call.method === "GET" && call.url.startsWith(`${SITE}/`)),
      ).toBe(true);
      expect(output.join("\n")).toContain("check passed; nothing written");
    });

    it("one-off apply backs up, rebaselines, and verifies a fresh live pass", async () => {
      const originDir = join(dir, "origin");
      const manifestText = await writeOrigin(originDir);
      const before = await seedOldReceipts();
      const site = mockFetch(liveSite());
      const code = await rebaselineFromOrigin({
        apply: true,
        manifestText,
        originDir,
        env: env(),
        fetchImpl: site.fetchImpl,
        log: (line: string) => output.push(line),
        logError: (line: string) => output.push(line),
        now: () => new Date("2026-11-06T12:00:00.000Z"),
      });
      expect(code).toBe(0);
      expect(site.posts()).toEqual([]);
      const backups = (await readdir(join(dir, "data"))).filter((f) =>
        f.includes("pre-rebaseline"),
      );
      expect(backups).toHaveLength(1);
      expect(JSON.parse(await readFile(join(dir, "data", backups[0]), "utf8"))).toEqual(before);
      const after = await readState();
      expect(after.urls[`${SITE}/`]).toMatchObject({ status: 202, submittedAt: receivedAt });
      expect(output.join("\n")).toContain("a fresh live pass matches all 5");

      expect(await run("dry-run", site.fetchImpl)).toBe(0);
      expect(output.at(-1)).toContain("unchanged");
    });

    it("one-off refuses changed origin HTML or a manifest that doesn't match the receipts", async () => {
      const originDir = join(dir, "origin");
      const manifestText = await writeOrigin(originDir);
      await seedOldReceipts();
      const original = await readFile(statePath, "utf8");
      const attempt = async (text: string) => {
        const site = mockFetch(liveSite());
        const code = await rebaselineFromOrigin({
          apply: true,
          manifestText: text,
          originDir,
          env: env(),
          fetchImpl: site.fetchImpl,
          log: (line: string) => output.push(line),
          logError: (line: string) => output.push(line),
        });
        expect(site.calls).toEqual([]);
        return code;
      };

      await writeFile(join(originDir, "guides", "index.html"), html(`${SITE}/guides/`, "edited"));
      expect(await attempt(manifestText)).toBe(1);
      expect(output.join("\n")).toContain("does not match the manifest hash");

      const fresh = await writeOrigin(originDir);
      expect(await attempt(fresh.split("\n").slice(1).join("\n"))).toBe(1);
      expect(output.join("\n")).toContain("recorded receipts and manifest differ");
      expect(await readFile(statePath, "utf8")).toBe(original);
    });

    it("one-off refuses a page that is unstable for reasons other than Cloudflare email", async () => {
      const originDir = join(dir, "origin");
      const manifestText = await writeOrigin(originDir);
      await seedOldReceipts();
      const original = await readFile(statePath, "utf8");
      const routes = liveSite();
      const site = mockFetch(routes);
      let counter = 0;
      const fetchImpl = async (url: string, init: RequestInit = {}) => {
        const response = await site.fetchImpl(url, init);
        if (url !== `${SITE}/guides/`) return response;
        const text = (await response.text()).replace("</body>", `<i>${counter++}</i></body>`);
        return new Response(text, { status: response.status, headers: response.headers });
      };
      const code = await rebaselineFromOrigin({
        apply: true,
        manifestText,
        originDir,
        env: env(),
        fetchImpl,
        log: (line: string) => output.push(line),
        logError: (line: string) => output.push(line),
      });
      expect(code).toBe(1);
      expect(output.join("\n")).toContain("fingerprints differently on two consecutive fetches");
      expect(await readFile(statePath, "utf8")).toBe(original);
    });
  });

  it("refuses an unreadable state file instead of resubmitting everything", async () => {
    await rm(join(dir, "data"), { recursive: true, force: true });
    await writeFile(join(dir, "state.json"), "{not json");
    const site = mockFetch(liveSite());
    expect(
      await run("submit", site.fetchImpl, env({ INDEXNOW_STATE_PATH: join(dir, "state.json") })),
    ).toBe(1);
    expect(site.calls).toEqual([]);
    expect(output.join("\n")).toContain("unreadable");
  });
});

describe("indexnow Cloudflare email normalization", () => {
  const footer = (hrefKey: number, textKey: number, address = "support@scholarmark.ai") =>
    `<p>Guide text.</p><a href="/cdn-cgi/l/email-protection#${cfEncode(address, hrefKey)}" data-astro-cid-nns7i3if><span class="__cf_email__" data-cfemail="${cfEncode(address, textKey)}">[email&#160;protected]</span></a>`;

  it("ignores the per-response XOR key but keeps the address", () => {
    const fingerprints = new Set(
      [0, 1, 0x5a, 0x80, 0xff].map((key) => pageFingerprint(footer(key, 255 - key))),
    );
    expect(fingerprints.size).toBe(1);
    expect(normalizeCloudflareEmails(footer(0x42, 0x17))).toContain(
      'href="mailto:support@scholarmark.ai"',
    );
    expect(normalizeCloudflareEmails(footer(0x42, 0x17))).toContain(
      'data-cfemail="support@scholarmark.ai"',
    );
    // Upper-case hex and single quotes are the same encoding.
    const upper = `<a href='/cdn-cgi/l/email-protection#${cfEncode("support@scholarmark.ai", 9).toUpperCase()}'>`;
    expect(normalizeCloudflareEmails(upper)).toBe("<a href='mailto:support@scholarmark.ai'>");
  });

  it("changes the fingerprint for real address and content edits", () => {
    const base = pageFingerprint(footer(1, 2));
    expect(pageFingerprint(footer(3, 4, "help@scholarmark.ai"))).not.toBe(base);
    expect(pageFingerprint(footer(1, 2).replace("Guide text.", "Guide text!"))).not.toBe(base);
    expect(pageFingerprint(footer(1, 2).replace("[email&#160;protected]", "x"))).not.toBe(base);
    // Mismatched link and visible address are both kept.
    expect(pageFingerprint(`${footer(1, 2)}${footer(1, 2, "a@b.co")}`)).not.toBe(
      pageFingerprint(`${footer(1, 2)}${footer(1, 2)}`),
    );
  });

  it("decodes ASCII addresses and fails closed on non-ASCII ones", () => {
    expect(decodeCloudflareEmail(cfEncode("support@scholarmark.ai", 0x6c))).toBe(
      "support@scholarmark.ai",
    );
    expect(decodeCloudflareEmail(cfEncode("jos\u00e9@example.org", 0x21))).toBeNull();
  });

  it.each([
    ["odd length", "5a3"],
    ["key only", "5a"],
    ["empty", ""],
    ["non-hex", "zz1234"],
    ["not an address", cfEncode("not an email", 0x33)],
    ["markup", cfEncode('a"b@c.de', 0x33)],
    ["invalid UTF-8", "00ff"],
  ])("rejects a malformed value (%s)", (_label, encoded) => {
    expect(decodeCloudflareEmail(encoded)).toBeNull();
    expect(() => normalizeCloudflareEmails(`<span data-cfemail="${encoded}">`)).toThrow(
      "unrecognized Cloudflare email-protection value",
    );
    expect(() =>
      normalizeCloudflareEmails(`<a href="/cdn-cgi/l/email-protection#${encoded}">`),
    ).toThrow("unrecognized Cloudflare email-protection value");
  });

  it("leaves text that only mentions the encoding untouched", () => {
    const prose =
      '<p>/cdn-cgi/l/email-protection#zz and data-cfemail="zz"</p><code>data-cfemail=&quot;5a&quot;</code><a href="/cdn-cgi/l/email-protection">x</a>';
    expect(normalizeCloudflareEmails(prose)).toBe(prose);
  });
});

describe("indexnow one-off rebaseline helpers", () => {
  it("parses sha256sum manifests with CRLF, binary markers and Windows paths", () => {
    const hash = "a".repeat(64);
    const entries = parseOriginManifest(
      `${hash}  index.html\r\n${hash} *guides\\index.html\r\n${hash}  ./guides/mla-9/index.html\r\n`,
    );
    expect([...entries.keys()]).toEqual([
      "https://scholarmark.ai/",
      "https://scholarmark.ai/guides/",
      "https://scholarmark.ai/guides/mla-9/",
    ]);
    for (const bad of [
      `${hash}  pricing/index.html`,
      `${hash}  guides/a/b/index.html`,
      "nope",
      "",
    ]) {
      expect(() => parseOriginManifest(bad)).toThrow();
    }
    expect(() => parseOriginManifest(`${hash}  index.html\n${hash}  ./index.html\n`)).toThrow(
      "twice",
    );
  });

  it("only lets GET requests to the public site through", async () => {
    const calls: string[] = [];
    const get = publicGetOnly(async (url: string) => {
      calls.push(url);
      return new Response("ok");
    });
    await get("https://scholarmark.ai/guides/");
    expect(() => get(INDEXNOW_ENDPOINT, { method: "POST" })).toThrow("refused POST");
    expect(() => get("https://scholarmark.ai/", { method: "POST" })).toThrow("refused POST");
    expect(() => get("https://api.indexnow.org/indexnow")).toThrow("refused GET");
    expect(() => get("https://scholarmark.ai.evil.example/")).toThrow("refused GET");
    expect(calls).toEqual(["https://scholarmark.ai/guides/"]);
  });
});

describe("indexnow robots.txt rules", () => {
  it("groups consecutive User-agent lines and ignores non-rule records", () => {
    const groups = parseRobotsGroups(CLOUDFLARE_ROBOTS);
    expect(groups.map((group) => group.agents)).toEqual([
      ["*"],
      ["amazonbot"],
      ["applebot-extended"],
      ["bytespider", "ccbot"],
      ["claudebot"],
      ["google-extended"],
      ["gptbot", "meta-externalagent"],
      ["*"],
    ]);
    expect(groups[0].rules).toEqual([{ allow: true, pattern: "/" }]);
    expect(groups[3].rules).toEqual([{ allow: false, pattern: "/" }]);
  });

  it("applies only the wildcard and Bing groups, and keeps private paths blocked", () => {
    for (const agent of ["*", "bingbot", "oai-searchbot"]) {
      const rules = robotsRulesFor(CLOUDFLARE_ROBOTS, agent);
      expect(robotsAllowsPath(rules, "/"), agent).toBe(true);
      expect(robotsAllowsPath(rules, "/guides/scholarmark-vs-zotero/"), agent).toBe(true);
      expect(robotsAllowsPath(rules, "/dashboard"), agent).toBe(false);
      expect(robotsAllowsPath(rules, "/api/projects"), agent).toBe(false);
    }
    for (const agent of ["gptbot", "ccbot", "claudebot", "google-extended", "meta-externalagent"]) {
      expect(robotsAllowsPath(robotsRulesFor(CLOUDFLARE_ROBOTS, agent), "/"), agent).toBe(false);
    }
  });

  it("uses longest match, Allow on ties, wildcards and end anchors", () => {
    const rules = (text: string) => robotsRulesFor(text, "bingbot");
    expect(robotsAllowsPath(rules("User-agent: *\nDisallow: /\n"), "/")).toBe(false);
    expect(robotsAllowsPath(rules("User-agent: *\nDisallow:\n"), "/")).toBe(true);
    expect(robotsAllowsPath(rules(""), "/")).toBe(true);
    expect(robotsAllowsPath(rules("User-agent: *\nDisallow: /*\n"), "/")).toBe(false);
    expect(robotsAllowsPath(rules("User-agent: *\nDisallow: /$\n"), "/")).toBe(false);
    expect(robotsAllowsPath(rules("User-agent: *\nDisallow: /$\n"), "/guides/")).toBe(true);
    expect(
      robotsAllowsPath(rules("User-agent: *\nDisallow: /\nAllow: /guides/\n"), "/guides/a/"),
    ).toBe(true);
    // A Bing group replaces the wildcard groups for Bing.
    const bingOnly = "User-agent: *\nDisallow: /\n\nUser-agent: bingbot\nAllow: /\n";
    expect(robotsAllowsPath(rules(bingOnly), "/")).toBe(true);
    expect(robotsAllowsPath(robotsRulesFor(bingOnly, "*"), "/")).toBe(false);
  });
});

describe("indexnow key rules", () => {
  it("accepts the same keys as the server's key file route", () => {
    expect(INDEXNOW_KEY_PATTERN.source).toBe(SERVER_INDEXNOW_KEY_PATTERN.source);
    expect(INDEXNOW_KEY_PATTERN.test(KEY)).toBe(true);
    expect(INDEXNOW_KEY_PATTERN.test(`${KEY}${KEY}`)).toBe(true);
    expect(INDEXNOW_KEY_PATTERN.test(KEY.slice(1))).toBe(false);
    expect(INDEXNOW_KEY_PATTERN.test(KEY.toUpperCase())).toBe(false);
    expect(INDEXNOW_KEY_PATTERN.test(`${KEY.slice(1)}-`)).toBe(false);
  });

  it("has no shebang, which breaks Vitest collection on CRLF (Windows) checkouts", async () => {
    // Always run as `node scripts/indexnow-submit.mjs`; tests import it as a module.
    const source = await readFile(
      new URL("../../scripts/indexnow-submit.mjs", import.meta.url),
      "utf8",
    );
    expect(source.startsWith("#!")).toBe(false);
  });
});

describe("indexnow URL rules", () => {
  it("accepts only the apex homepage, guide hub and guide articles", () => {
    expect(isSubmittableUrl("https://scholarmark.ai/")).toBe(true);
    expect(isSubmittableUrl("https://scholarmark.ai/guides/")).toBe(true);
    expect(isSubmittableUrl("https://scholarmark.ai/guides/mla-9-works-cited-core-elements/")).toBe(
      true,
    );
    for (const url of [
      "https://scholarmark.ai",
      "https://scholarmark.ai/guides",
      "https://scholarmark.ai/guides/a--b/",
      "https://scholarmark.ai/guides/-a/",
      "https://scholarmark.ai/guides/a/b/",
      "https://scholarmark.ai/guides/a/?x=1",
      "https://scholarmark.ai/guides/a/#top",
      "https://scholarmark.ai:443/guides/a/",
      "https://scholarmark.ai:8443/guides/a/",
      "https://user@scholarmark.ai/guides/a/",
      "https://scholarmark.ai/guides/%2e%2e/",
      "https://scholarmark.ai/pricing",
      "https://scholarmark.ai/blog/post",
      "https://scholarmark.ai/dashboard",
      "https://scholarmark.ai/sign-in",
      "https://scholarmark.ai/api/x",
      "http://scholarmark.ai/",
      "https://www.scholarmark.ai/",
      "https://app.scholarmark.ai/guides/",
      "https://scholarmark.ai.evil.example/",
      "not a url",
    ]) {
      expect(isSubmittableUrl(url), url).toBe(false);
    }
  });

  it("decodes sitemap entries and ignores asset hashes in fingerprints", () => {
    expect(parseSitemapLocs("<url><loc> https://scholarmark.ai/?a=1&amp;b=2 </loc></url>")).toEqual(
      ["https://scholarmark.ai/?a=1&b=2"],
    );
    expect(pageFingerprint('<link href="/_astro/a.Ab12.css">x')).toBe(
      pageFingerprint('<link href="/_astro/a.Zz99.css">x'),
    );
    expect(pageFingerprint("<p>x</p>")).not.toBe(pageFingerprint("<p>y</p>"));
  });
});
