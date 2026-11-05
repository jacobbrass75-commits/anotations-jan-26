#!/usr/bin/env node
/**
 * Route, link and release verification for the static marketing build.
 *
 *   node scripts/verify.mjs               Build a fixture matrix (production, staging, preview
 *                                         guard, price-live, invalid frontmatter) and check each.
 *   node scripts/verify.mjs --dist dist   Check an existing build of the real guides. Expectations
 *                                         come from SITE_RELEASE_ENV / PUBLIC_PRO_PRICE_LIVE.
 *                                         Add --fixtures for a build made from the test fixtures.
 *
 * No dependencies: the generated HTML is predictable enough for targeted parsing.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASTRO_BIN = path.join(ROOT, "node_modules", "astro", "bin", "astro.mjs");
const SITE = "https://scholarmark.ai";
const APP = "https://app.scholarmark.ai";
const SIGNUP_REDIRECT = "/pricing?onboarding=1&source=summer";
const SUPPORT_MAILTO = "mailto:support@scholarmark.ai";
const CONTROLLED_ENV = [
  "SITE_RELEASE_ENV",
  "PUBLIC_PRO_PRICE_LIVE",
  "VERCEL_ENV",
  "CONTEXT",
  "GUIDES_CONTENT_DIR",
];

/** Affirmative claims the site's own copy must never make. Guide prose is reviewed separately. */
const CLAIM_PATTERNS = [
  [/\btestimonials?\b/i, "testimonial"],
  [/\btrusted by\b/i, "social-proof claim"],
  [/\b(?:loved|used) by (?:thousands|millions|\d)/i, "usage claim"],
  [/\bguarantee[sd]\b/i, "guarantee claim"],
  [/\b100% (?:accurate|accuracy|correct)\b/i, "accuracy promise"],
  [/\b(?:always|perfectly) accurate\b/i, "accuracy promise"],
  [/\bhallucination[- ]free\b/i, "accuracy promise"],
  [/\b(?:App Store|Google Play|iOS|iPhone|iPad|Android)\b/, "mobile app availability"],
  [/#1\b|\brank(?:s|ed|ing)? (?:#?1|first|higher)\b/i, "ranking claim"],
];

/** Third-party analytics, ad or session-replay hosts that must not appear in shipped JS. */
const TRACKER_PATTERN =
  /googletagmanager|google-analytics|connect\.facebook|facebook\.net|fbevents|segment\.(?:io|com)|plausible\.io|posthog|hotjar|clarity\.ms|mixpanel|amplitude|intercom|fullstory|heap(?:analytics)?\.|sentry\.io/i;

const FIXTURE_GUIDES = [
  "fixture-keep-quote-context",
  "fixture-mdx-guide",
  "fixture-citation-basics",
];

// ---------------------------------------------------------------------------
// Small HTML helpers

const decode = (value) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

function attrs(tag) {
  const found = {};
  for (const match of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = match[1].toLowerCase();
    if (name === tag.match(/^<\s*([a-z0-9-]+)/i)?.[1].toLowerCase()) continue;
    found[name] = decode(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return found;
}

function tags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((match) => ({
    raw: match[0],
    index: match.index,
    attrs: attrs(match[0]),
  }));
}

function visibleText(html) {
  return decode(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Guide prose is authored separately; claim and dollar-amount rules apply to everything else. */
function withoutGuideProse(html) {
  const start = html.indexOf('<div class="prose"');
  if (start === -1) return html;
  const end = html.indexOf('<aside class="guide__note"', start);
  return end === -1 ? html : html.slice(0, start) + html.slice(end);
}

function proseRange(html) {
  const start = html.indexOf('<div class="prose"');
  const end = start === -1 ? -1 : html.indexOf('<aside class="guide__note"', start);
  return start === -1 || end === -1 ? null : [start, end];
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

function routeFor(dist, file) {
  const rel = path.relative(dist, file).split(path.sep).join("/");
  if (rel === "404.html") return "/404.html";
  return `/${rel.replace(/index\.html$/, "")}`;
}

// ---------------------------------------------------------------------------
// Checks

async function verifyDist(dist, expect) {
  const errors = [];
  const fail = (where, message) => errors.push(`${where}: ${message}`);

  for (const file of ["index.html", "guides/index.html", "404.html", "robots.txt", "sitemap.xml", "_headers", "favicon.svg"]) {
    if (!existsSync(path.join(dist, file))) fail("routes", `missing ${file}`);
  }
  for (const slug of expect.guides) {
    if (!existsSync(path.join(dist, "guides", slug, "index.html"))) {
      fail("routes", `missing /guides/${slug}/`);
    }
  }
  if (errors.length) return errors;

  const files = await walk(dist);
  const htmlFiles = files.filter((file) => file.endsWith(".html"));
  const pages = new Map();
  for (const file of htmlFiles) {
    pages.set(routeFor(dist, file), await readFile(file, "utf8"));
  }

  const idsByRoute = new Map(
    [...pages].map(([route, html]) => [
      route,
      new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => decode(match[1]))),
    ]),
  );

  const resolveInternal = (fromRoute, href, where) => {
    const [beforeHash, hash = ""] = href.split("#");
    const pathname = decodeURI(beforeHash.split("?")[0]);
    let targetRoute = fromRoute;
    if (pathname) {
      if (!pathname.endsWith("/") && !path.posix.extname(pathname)) {
        fail(where, `internal link without trailing slash: ${href}`);
        return;
      }
      if (pathname.endsWith("/")) {
        targetRoute = pathname;
        if (!pages.has(targetRoute)) {
          fail(where, `broken internal link: ${href}`);
          return;
        }
      } else if (!existsSync(path.join(dist, pathname))) {
        fail(where, `missing internal file: ${href}`);
        return;
      } else {
        return;
      }
    }
    if (hash && !idsByRoute.get(targetRoute)?.has(decodeURIComponent(hash))) {
      fail(where, `missing anchor #${hash} on ${targetRoute}`);
    }
  };

  const titles = new Map();

  for (const [route, html] of pages) {
    const where = route;
    const isNotFound = route === "/404.html";
    const isGuide = /^\/guides\/[^/]+\/$/.test(route);
    const prose = proseRange(html);
    const inProse = (index) => prose !== null && index > prose[0] && index < prose[1];

    // Document basics and accessibility
    if (!/<html lang="en"/.test(html)) fail(where, "missing <html lang=\"en\">");
    const h1Count = (html.match(/<h1\b/g) ?? []).length;
    if (h1Count !== 1) fail(where, `expected one <h1>, found ${h1Count}`);
    const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "").trim();
    if (!title) fail(where, "empty <title>");
    else if (!isNotFound) {
      if (titles.has(title)) fail(where, `duplicate title also used on ${titles.get(title)}`);
      titles.set(title, route);
    }
    const metas = tags(html, "meta");
    const meta = (key, value) => metas.find((tag) => tag.attrs[key] === value)?.attrs.content;
    if (!meta("name", "description")?.trim()) fail(where, "missing meta description");
    if (!/href="#main"/.test(html) || !idsByRoute.get(route).has("main")) {
      fail(where, "skip link or #main target missing");
    }
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (duplicateIds.length) fail(where, `duplicate ids: ${[...new Set(duplicateIds)].join(", ")}`);
    for (const img of tags(html, "img")) {
      if (!("alt" in img.attrs)) fail(where, `<img> without alt: ${img.attrs.src}`);
    }

    // Indexing and canonical URLs
    const robots = meta("name", "robots") ?? "";
    const canonicals = tags(html, "link").filter((tag) => tag.attrs.rel === "canonical");
    const shouldIndex = expect.indexable && !isNotFound;
    if (shouldIndex) {
      if (!/^index, follow$/.test(robots)) fail(where, `robots meta should be "index, follow", got "${robots}"`);
      const expected = `${SITE}${route}`;
      if (canonicals.length !== 1 || canonicals[0].attrs.href !== expected) {
        fail(where, `canonical should be ${expected}, got ${canonicals.map((tag) => tag.attrs.href).join(", ") || "none"}`);
      }
      if (meta("property", "og:url") !== expected) fail(where, `og:url should be ${expected}`);
    } else {
      if (!robots.includes("noindex")) fail(where, `robots meta should contain noindex, got "${robots}"`);
      if (canonicals.length) fail(where, "canonical must be omitted on noindex pages");
    }

    for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try {
        JSON.parse(match[1]);
      } catch {
        fail(where, "invalid JSON-LD");
      }
    }

    // Third-party resources: nothing may load from another origin.
    for (const name of ["script", "img", "iframe", "source", "video", "audio", "embed", "object"]) {
      for (const tag of tags(html, name)) {
        if (name === "iframe" || name === "embed" || name === "object") fail(where, `<${name}> is not allowed`);
        const src = tag.attrs.src ?? tag.attrs.data;
        if (src && /^(?:https?:)?\/\//i.test(src)) fail(where, `third-party <${name}>: ${src}`);
      }
    }
    for (const tag of tags(html, "link")) {
      if (tag.attrs.rel === "canonical") continue;
      if (/^(?:https?:)?\/\//i.test(tag.attrs.href ?? "")) fail(where, `third-party <link rel="${tag.attrs.rel}">: ${tag.attrs.href}`);
    }
    if (tags(html, "form").length) fail(where, "<form> is not expected on the marketing site");
    // Astro inlines small scripts, so inline code gets the same tracker and network checks as bundles.
    for (const match of html.matchAll(/<script\b(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/gi)) {
      const tracker = match[1].match(TRACKER_PATTERN);
      if (tracker) fail(where, `tracker reference in inline script: ${tracker[0]}`);
      if (/\bfetch\(|sendBeacon|XMLHttpRequest/.test(match[1])) fail(where, "inline script makes network requests");
    }

    // Links
    let signupLinks = 0;
    let pricingLinks = 0;
    for (const tag of tags(html, "a")) {
      const href = tag.attrs.href;
      if (href === undefined || href === "") {
        fail(where, `<a> without href: ${tag.raw.slice(0, 80)}`);
        continue;
      }
      if (href.startsWith("mailto:")) {
        if (href !== SUPPORT_MAILTO && !inProse(tag.index)) fail(where, `unexpected mailto: ${href}`);
        continue;
      }
      if (href.startsWith("#") || (href.startsWith("/") && !href.startsWith("//"))) {
        resolveInternal(route, href, where);
        continue;
      }
      let url;
      try {
        url = new URL(href);
      } catch {
        fail(where, `unparseable href: ${href}`);
        continue;
      }
      if (url.protocol !== "https:") fail(where, `non-https link: ${href}`);
      if (url.origin === SITE) {
        fail(where, `absolute link to own origin should be root-relative: ${href}`);
        continue;
      }
      if (url.origin === APP) {
        if (url.pathname === "/sign-up") {
          signupLinks += 1;
          if (!("data-signup" in tag.attrs)) fail(where, `signup link without data-signup: ${href}`);
          if (url.searchParams.get("redirect_url") !== SIGNUP_REDIRECT) {
            fail(where, `signup link must redirect to ${SIGNUP_REDIRECT}: ${href}`);
          }
        } else if (url.pathname === "/pricing") {
          pricingLinks += 1;
        } else if (!["/sign-in", "/privacy", "/terms", "/support"].includes(url.pathname)) {
          fail(where, `unexpected app link: ${href}`);
        }
        continue;
      }
      if (!inProse(tag.index)) fail(where, `external link outside guide prose: ${href}`);
    }
    if (signupLinks === 0) fail(where, "no signup link");
    if (route === "/" && pricingLinks === 0) fail(where, "homepage must link to live app pricing");

    // Copy rules
    const ownText = visibleText(withoutGuideProse(html));
    for (const [pattern, label] of CLAIM_PATTERNS) {
      const hit = ownText.match(pattern);
      if (hit) fail(where, `${label} in site copy: "${hit[0]}"`);
    }
    const fullText = visibleText(html);
    if (expect.priceLive) {
      if (/\$\d/.test(ownText.replace(/\$5\/month/g, ""))) fail(where, "dollar amount other than $5/month in site copy");
    } else {
      if (/\$\s?5\b/.test(fullText)) fail(where, "$5 price shown while PUBLIC_PRO_PRICE_LIVE is not true");
      const amount = ownText.match(/\$\d[\d,.]*/);
      if (amount) fail(where, `dollar amount in site copy without a live price: ${amount[0]}`);
    }

    if (isGuide && !/<article class="guide"/.test(html)) fail(where, "guide page missing article layout");
  }

  if (expect.priceLive && !visibleText(pages.get("/")).includes("$5/month")) {
    fail("/", "PUBLIC_PRO_PRICE_LIVE=true but $5/month is not shown");
  }

  // Shipped JavaScript: no trackers, no network calls.
  for (const file of files.filter((name) => name.endsWith(".js"))) {
    const js = await readFile(file, "utf8");
    const rel = path.relative(dist, file);
    const tracker = js.match(TRACKER_PATTERN);
    if (tracker) fail(rel, `tracker reference: ${tracker[0]}`);
    if (/\bfetch\(|sendBeacon|XMLHttpRequest/.test(js)) fail(rel, "client script makes network requests");
  }

  // robots.txt, sitemap.xml, _headers
  const robotsTxt = await readFile(path.join(dist, "robots.txt"), "utf8");
  const sitemap = await readFile(path.join(dist, "sitemap.xml"), "utf8");
  const headers = await readFile(path.join(dist, "_headers"), "utf8");
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  const lastmods = [...sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((match) => match[1]);

  if (expect.indexable) {
    if (!/^Allow: \/$/m.test(robotsTxt) || /^Disallow: \/$/m.test(robotsTxt)) fail("robots.txt", "production must allow crawling");
    if (!robotsTxt.includes(`Sitemap: ${SITE}/sitemap.xml`)) fail("robots.txt", "missing Sitemap line");
    const expected = [...pages.keys()].filter((route) => route !== "/404.html").map((route) => `${SITE}${route}`).sort();
    const actual = [...locs].sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      fail("sitemap.xml", `urls differ from built pages.\n    expected: ${expected.join(", ")}\n    actual:   ${actual.join(", ")}`);
    }
    for (const lastmod of lastmods) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(lastmod)) fail("sitemap.xml", `bad lastmod ${lastmod}`);
    }
    if (/X-Robots-Tag/i.test(headers)) fail("_headers", "production must not send X-Robots-Tag");
  } else {
    if (!/^Disallow: \/$/m.test(robotsTxt)) fail("robots.txt", "non-production must disallow all crawling");
    if (/Sitemap:/i.test(robotsTxt)) fail("robots.txt", "non-production must not advertise a sitemap");
    if (locs.length) fail("sitemap.xml", "non-production sitemap must be empty");
    if (!/X-Robots-Tag: noindex/i.test(headers)) fail("_headers", "non-production must send X-Robots-Tag: noindex");
  }

  if (expect.fixtures) errors.push(...fixtureChecks(pages));
  return errors;
}

/** Behaviour that only the fixture guides can prove. */
function fixtureChecks(pages) {
  const errors = [];
  const fail = (where, message) => errors.push(`${where}: ${message}`);
  const first = pages.get("/guides/fixture-keep-quote-context/") ?? "";
  const mdx = pages.get("/guides/fixture-mdx-guide/") ?? "";
  const home = pages.get("/") ?? "";
  const listing = pages.get("/guides/") ?? "";

  if (!first.includes('href="/guides/fixture-mdx-guide/"')) fail("fixture", "slash-less internal link was not normalized");
  if (!first.includes('href="/guides/"')) fail("fixture", "absolute own-origin link was not normalized");
  if (!first.includes('href="https://example.org/reference"')) fail("fixture", "external prose link missing");
  if (!/<a href="https:\/\/app\.scholarmark\.ai\/sign-up\?redirect_url=[^"]+"[^>]*data-signup/.test(first)) {
    fail("fixture", "bare signup link in prose was not decorated");
  }
  if (!first.includes("In this guide")) fail("fixture", "table of contents missing for 3+ sections");
  if (!first.includes('datetime="2026-02-01"') || !first.includes('"dateModified":"2026-02-01"')) {
    fail("fixture", "updated date not rendered");
  }
  if (!mdx.includes("rendered from MDX")) fail("fixture", "MDX expression did not render");
  if (!mdx.includes('datetime="2026-03-05"')) fail("fixture", "unquoted YAML date not normalized");

  // Newest first: mdx (published 2026-03-05), keep-quote (updated 2026-02-01), citation (2025-12-01).
  const positions = ["fixture-mdx-guide", "fixture-keep-quote-context", "fixture-citation-basics"].map(
    (slug) => home.indexOf(`href="/guides/${slug}/"`),
  );
  if (positions.includes(-1)) fail("fixture", "homepage does not list the newest guides");
  else if (!(positions[0] < positions[1] && positions[1] < positions[2])) {
    fail("fixture", "homepage guides are not newest-first");
  }
  for (const category of ["Citations", "Research skills"]) {
    if (!new RegExp(`<h2[^>]*>\\s*${category}\\s*</h2>`).test(listing)) {
      fail("fixture", `listing missing category group ${category}`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Runner

function cleanEnv(overrides) {
  const env = { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" };
  for (const key of CONTROLLED_ENV) delete env[key];
  return { ...env, ...overrides };
}

async function build(name, overrides) {
  const outDir = path.join("dist-verify", name);
  await rm(path.join(ROOT, outDir), { recursive: true, force: true });
  const result = spawnSync(process.execPath, [ASTRO_BIN, "build", "--outDir", outDir, "--force"], {
    cwd: ROOT,
    env: cleanEnv(overrides),
    encoding: "utf8",
  });
  return { ...result, dist: path.join(ROOT, outDir), log: `${result.stdout}\n${result.stderr}` };
}

const FIXTURE_ENV = { GUIDES_CONTENT_DIR: "./tests/fixtures/guides" };

const MATRIX = [
  { name: "production", env: { SITE_RELEASE_ENV: "production" }, expect: { indexable: true, priceLive: false } },
  { name: "staging", env: { SITE_RELEASE_ENV: "staging" }, expect: { indexable: false, priceLive: false } },
  { name: "unset-env", env: {}, expect: { indexable: false, priceLive: false } },
  {
    name: "preview-guard",
    env: { SITE_RELEASE_ENV: "production", VERCEL_ENV: "preview" },
    expect: { indexable: false, priceLive: false },
  },
  {
    name: "price-live",
    env: { SITE_RELEASE_ENV: "production", PUBLIC_PRO_PRICE_LIVE: "true" },
    expect: { indexable: true, priceLive: true },
  },
];

async function guideSlugsFromSource() {
  const dir = path.join(ROOT, "src", "content", "guides");
  if (!existsSync(dir)) return [];
  return (await readdir(dir))
    .filter((name) => /\.mdx?$/.test(name))
    .map((name) => name.replace(/\.mdx?$/, ""));
}

function report(name, errors) {
  if (errors.length === 0) {
    console.log(`  ✓ ${name}`);
    return true;
  }
  console.log(`  ✗ ${name} (${errors.length} problem${errors.length === 1 ? "" : "s"})`);
  for (const error of errors) console.log(`      - ${error}`);
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  const distIndex = args.indexOf("--dist");
  let ok = true;

  if (distIndex !== -1) {
    const dist = path.resolve(ROOT, args[distIndex + 1] ?? "dist");
    const releaseEnv = (process.env.SITE_RELEASE_ENV ?? "").trim().toLowerCase();
    // --fixtures re-checks a build made from tests/fixtures/guides instead of the real guides.
    const fixtures = args.includes("--fixtures");
    const expect = {
      indexable: releaseEnv === "production",
      priceLive: (process.env.PUBLIC_PRO_PRICE_LIVE ?? "").trim() === "true",
      guides: fixtures ? FIXTURE_GUIDES : await guideSlugsFromSource(),
      fixtures,
    };
    console.log(`Verifying ${path.relative(ROOT, dist) || "."} (release=${releaseEnv || "development"}, price-live=${expect.priceLive})`);
    ok = report("build output", await verifyDist(dist, expect));
  } else {
    console.log("Building and verifying the fixture matrix:");
    for (const item of MATRIX) {
      const result = await build(item.name, { ...FIXTURE_ENV, ...item.env });
      if (result.status !== 0) {
        ok = report(item.name, [`build failed:\n${result.log.slice(-2000)}`]) && ok;
        continue;
      }
      const errors = await verifyDist(result.dist, {
        ...item.expect,
        guides: FIXTURE_GUIDES,
        fixtures: true,
      });
      ok = report(item.name, errors) && ok;
    }

    const invalid = await build("invalid-frontmatter", {
      GUIDES_CONTENT_DIR: "./tests/fixtures/guides-invalid",
      SITE_RELEASE_ENV: "production",
    });
    const rejected = invalid.status !== 0 && /category/i.test(invalid.log) && /published/i.test(invalid.log);
    ok =
      report(
        "invalid-frontmatter is rejected",
        rejected ? [] : [`expected the build to fail on category and published; status ${invalid.status}`],
      ) && ok;
  }

  console.log(ok ? "\nAll checks passed." : "\nVerification failed.");
  process.exit(ok ? 0 : 1);
}

await main();
