import express from "express";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalRequest } from "../../server/canonicalRequest";
import { paidInstagramEntry } from "../../server/paidInstagramEntry";
import {
  HTML_CACHE_CONTROL,
  isMarketingSiteEnabled,
  loadMarketingSite,
  shouldServeMarketingRoot,
} from "../../server/static";
import { startHttpServer } from "./helpers/http";

// Test-only value; production keys are generated on the server and never committed.
const INDEXNOW_KEY = "0123456789abcdef0123456789abcdef";

let fixtureRoot: string;
let productionDist: string;
let previewDist: string;
let noSitemapDist: string;
let spaPublic: string;

function writeFixture(root: string, relativePath: string, contents: string) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function page(marker: string, canonicalPath: string | null, robots = "index, follow") {
  const canonical = canonicalPath
    ? `<link rel="canonical" href="https://scholarmark.ai${canonicalPath}">`
    : "";
  return `<html><head><meta name="robots" content="${robots}">${canonical}</head><body>${marker}</body></html>`;
}

// Mirrors the marketing/ Astro output: trailingSlash "always", directory format,
// release-gated robots.txt/sitemap.xml, and a Netlify-style _headers file.
function writeAstroBuild(root: string, release: "production" | "preview") {
  const indexable = release === "production";
  const robots = indexable ? "index, follow" : "noindex, nofollow";
  writeFixture(root, "index.html", page("astro-home", indexable ? "/" : null, robots));
  writeFixture(root, "404.html", "<html><body>astro-404</body></html>");
  writeFixture(root, "_astro/home.Ab12Cd.css", "body{color:red}");
  writeFixture(
    root,
    "guides/index.html",
    page("astro-guides", indexable ? "/guides/" : null, robots),
  );
  writeFixture(
    root,
    "guides/thesis-outline/index.html",
    page("astro-guide", indexable ? "/guides/thesis-outline/" : null, robots),
  );
  writeFixture(root, "guides/diagram.svg", "<svg></svg>");
  writeFixture(root, "pricing/index.html", page("astro-pricing", null));
  writeFixture(root, "og/home.png", "png-bytes");
  writeFixture(root, "favicon.svg", "astro-favicon");
  writeFixture(root, ".well-known/security.txt", "astro-dotfile");
  writeFixture(
    root,
    "_headers",
    [
      "/*",
      "  Content-Security-Policy: frame-ancestors 'none'",
      "  Cache-Control: public, max-age=999",
      ...(indexable ? [] : ["  X-Robots-Tag: noindex, nofollow"]),
      "",
      "/_astro/*",
      "  X-Asset-Rule: yes",
      "",
    ].join("\n"),
  );
  writeFixture(
    root,
    "robots.txt",
    indexable
      ? "User-agent: *\nAllow: /\n\nSitemap: https://scholarmark.ai/sitemap.xml\n"
      : "User-agent: *\nDisallow: /\n",
  );
  writeFixture(
    root,
    "sitemap.xml",
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...(indexable
        ? [
            "  <url>\n    <loc>https://scholarmark.ai/</loc>\n  </url>",
            "  <url>\n    <loc>https://scholarmark.ai/guides/</loc>\n    <lastmod>2026-11-01</lastmod>\n  </url>",
            "  <url>\n    <loc>https://scholarmark.ai/guides/thesis-outline/</loc>\n    <lastmod>2026-11-01</lastmod>\n  </url>",
          ]
        : []),
      "</urlset>",
      "",
    ].join("\n"),
  );
}

beforeAll(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sm-marketing-"));
  productionDist = path.join(fixtureRoot, "production");
  previewDist = path.join(fixtureRoot, "preview");
  noSitemapDist = path.join(fixtureRoot, "no-sitemap");
  spaPublic = path.join(fixtureRoot, "public");

  writeAstroBuild(productionDist, "production");
  writeAstroBuild(previewDist, "preview");
  writeAstroBuild(noSitemapDist, "production");
  fs.rmSync(path.join(noSitemapDist, "sitemap.xml"));

  writeFixture(spaPublic, "index.html", '<div id="root"></div>');
  writeFixture(spaPublic, "favicon.svg", "spa-favicon");
  writeFixture(fixtureRoot, "secret.txt", "outside-build");
});

afterAll(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("Astro marketing site on the marketing host", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function startApp(distPath = productionDist, indexNowKey?: string) {
    const app = express();
    app.set("trust proxy", true);
    app.use(canonicalRequest);
    app.use(paidInstagramEntry);
    const site = loadMarketingSite({
      distPath,
      spaPublicPath: spaPublic,
      previewHosts: ["preview.internal"],
      indexNowKey,
    });
    if (site) app.use(site.middleware);
    app.use(express.static(spaPublic, { index: false }));
    app.all("*", (req, res) => res.status(200).send(`spa:${req.method}:${req.originalUrl}`));
    return startHttpServer(app);
  }

  function request(baseUrl: string, urlPath: string, init: RequestInit & { host?: string } = {}) {
    const host = init.host ?? "scholarmark.ai";
    return fetch(`${baseUrl}${urlPath}`, {
      redirect: "manual",
      ...init,
      headers: {
        host,
        "x-forwarded-host": host,
        "x-forwarded-proto": "https",
        ...init.headers,
      },
    });
  }

  function rawGet(baseUrl: string, rawPath: string): Promise<{ status: number; body: string }> {
    const { hostname, port } = new URL(baseUrl);
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname,
          port,
          path: rawPath,
          headers: { "x-forwarded-host": "scholarmark.ai", "x-forwarded-proto": "https" },
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  it("serves the Astro root as uncached HTML on the marketing host only", async () => {
    const server = await startApp();
    try {
      const marketing = await request(server.baseUrl, "/?utm_source=newsletter");
      expect(marketing.status).toBe(200);
      expect(marketing.headers.get("content-type")).toContain("text/html");
      expect(marketing.headers.get("cache-control")).toBe(HTML_CACHE_CONTROL);
      expect(marketing.headers.get("x-scholarmark-surface")).toBe("marketing");
      expect(marketing.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
      expect(await marketing.text()).toContain("astro-home");

      const head = await request(server.baseUrl, "/", { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(head.headers.get("x-scholarmark-surface")).toBe("marketing");

      const preview = await request(server.baseUrl, "/", { host: "preview.internal" });
      expect(await preview.text()).toContain("astro-home");

      const app = await request(server.baseUrl, "/", { host: "app.scholarmark.ai" });
      expect(await app.text()).toBe("spa:GET:/");

      const post = await request(server.baseUrl, "/", { method: "POST" });
      expect(await post.text()).toBe("spa:POST:/");
    } finally {
      await server.close();
    }
  });

  it.each([
    ["paid Instagram landing", "/?utm_source=ig&utm_medium=paid&utm_campaign=summer"],
    ["referral", "/?ref=friend123"],
    ["landing opt-out", "/?sm_landing=1"],
    ["embedded auth", "/?embedded_auth=1"],
  ])("keeps the SPA root for %s visits", async (_label, urlPath) => {
    const server = await startApp();
    try {
      const response = await request(server.baseUrl, urlPath);
      expect(response.headers.get("x-scholarmark-surface")).toBeNull();
      expect(await response.text()).toBe(`spa:GET:${urlPath}`);
    } finally {
      await server.close();
    }
  });

  it("still redirects explicitly opted-in paid Instagram signups before the marketing root", async () => {
    const server = await startApp();
    try {
      const response = await request(
        server.baseUrl,
        "/?utm_source=ig&utm_medium=paid&sm_direct_signup=1",
      );
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toContain("/sign-up?");
    } finally {
      await server.close();
    }
  });

  it("serves the Astro root regardless of stale or active Clerk cookies", async () => {
    const server = await startApp();
    try {
      for (const cookie of [
        "theme=dark; __client_uat_Ab12=1730000000",
        "__client_uat=1730000000; __session=abc",
        "__client_uat=0",
      ]) {
        const response = await request(server.baseUrl, "/", { headers: { cookie } });
        expect(response.status).toBe(200);
        expect(await response.text()).toContain("astro-home");
      }
    } finally {
      await server.close();
    }
  });

  it("serves hashed Astro assets immutably and never falls back to the SPA", async () => {
    const server = await startApp();
    try {
      const asset = await request(server.baseUrl, "/_astro/home.Ab12Cd.css", {
        host: "app.scholarmark.ai",
      });
      expect(asset.status).toBe(200);
      expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(asset.headers.get("content-type")).toContain("text/css");
      expect(asset.headers.get("x-asset-rule")).toBe("yes");
      expect(await asset.text()).toBe("body{color:red}");

      for (const urlPath of [
        "/_astro/missing.js",
        "/_astro/../../secret.txt",
        "/_astro/%2e%2e/%2e%2e/secret.txt",
        "/_astro/..%2f..%2fsecret.txt",
        "/_astro/%2e%2e%5c%2e%2e%5csecret.txt",
        "/_astro/home.Ab12Cd.css%00.html",
      ]) {
        // Raw request so the client does not normalize the traversal away.
        const response = await rawGet(server.baseUrl, urlPath);
        expect(response.status, urlPath).toBe(404);
        expect(response.body, urlPath).not.toContain("outside-build");
        expect(response.body, urlPath).not.toContain("spa:");
      }
    } finally {
      await server.close();
    }
  });

  it("serves canonical /guides URLs, redirects the slashless form, and returns the Astro 404", async () => {
    const server = await startApp();
    try {
      for (const [urlPath, marker] of [
        ["/guides/", "astro-guides"],
        ["/guides/thesis-outline/", "astro-guide"],
      ]) {
        const response = await request(server.baseUrl, urlPath);
        expect(response.status, urlPath).toBe(200);
        expect(response.headers.get("cache-control"), urlPath).toBe(HTML_CACHE_CONTROL);
        expect(await response.text(), urlPath).toContain(marker);
      }

      const slashless = await request(server.baseUrl, "/guides/thesis-outline?utm_source=x");
      expect(slashless.status).toBe(308);
      expect(slashless.headers.get("location")).toBe("/guides/thesis-outline/?utm_source=x");

      const image = await request(server.baseUrl, "/guides/diagram.svg");
      expect(image.headers.get("cache-control")).toBe("public, max-age=3600");

      const missing = await request(server.baseUrl, "/guides/does-not-exist/");
      expect(missing.status).toBe(404);
      expect(missing.headers.get("cache-control")).toBe(HTML_CACHE_CONTROL);
      expect(await missing.text()).toContain("astro-404");
    } finally {
      await server.close();
    }
  });

  it("redirects /guides on the app host to the canonical marketing origin", async () => {
    const server = await startApp();
    try {
      const response = await request(server.baseUrl, "/guides/thesis-outline/?x=1", {
        host: "app.scholarmark.ai",
      });
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe(
        "https://scholarmark.ai/guides/thesis-outline/?x=1",
      );
    } finally {
      await server.close();
    }
  });

  it("keeps SPA routes, SPA files, host config, and dotfiles out of the Astro build", async () => {
    const server = await startApp();
    try {
      for (const urlPath of [
        "/pricing",
        "/blog",
        "/blog/avoid-hallucinated-quotes",
        "/start",
        "/_headers",
        "/.well-known/security.txt",
      ]) {
        expect(await (await request(server.baseUrl, urlPath)).text(), urlPath).toBe(
          `spa:GET:${urlPath}`,
        );
      }
      expect(await (await request(server.baseUrl, "/favicon.svg")).text()).toBe("spa-favicon");

      const ogImage = await request(server.baseUrl, "/og/home.png");
      expect(ogImage.status).toBe(200);
      expect(await ogImage.text()).toBe("png-bytes");
      // Root-level Astro public files are a marketing-host surface only.
      const appOgImage = await request(server.baseUrl, "/og/home.png", {
        host: "app.scholarmark.ai",
      });
      expect(await appOgImage.text()).toBe("spa:GET:/og/home.png");
    } finally {
      await server.close();
    }
  });

  it("merges the Astro sitemap with legacy public pages in an indexable release", async () => {
    const server = await startApp();
    try {
      const robots = await request(server.baseUrl, "/robots.txt");
      expect(robots.headers.get("content-type")).toContain("text/plain");
      const robotsText = await robots.text();
      expect(robotsText).toContain("Allow: /");
      expect(robotsText).toContain("Sitemap: https://scholarmark.ai/sitemap.xml");
      expect(robotsText).toContain("Disallow: /api/");
      expect(robotsText).not.toMatch(/Disallow: \/(?:pricing|blog|guides|faq)\b/);
      expect(robotsText).not.toMatch(/^Disallow: \/$/m);

      const sitemap = await request(server.baseUrl, "/sitemap.xml");
      expect(sitemap.headers.get("content-type")).toContain("application/xml");
      const xml = await sitemap.text();
      expect(xml).toContain(
        "<loc>https://scholarmark.ai/guides/thesis-outline/</loc><lastmod>2026-11-01</lastmod>",
      );
      for (const loc of [
        "https://scholarmark.ai/",
        "https://scholarmark.ai/guides/",
        "https://scholarmark.ai/pricing",
        "https://scholarmark.ai/faq",
        "https://scholarmark.ai/blog",
        "https://scholarmark.ai/blog/avoid-hallucinated-quotes",
      ]) {
        expect(xml).toContain(`<loc>${loc}</loc>`);
      }
      expect(xml.match(/<loc>https:\/\/scholarmark\.ai\/<\/loc>/g)).toHaveLength(1);

      const appRobots = await request(server.baseUrl, "/robots.txt", {
        host: "app.scholarmark.ai",
      });
      expect(await appRobots.text()).toBe("spa:GET:/robots.txt");
    } finally {
      await server.close();
    }
  });

  it("derives the sitemap from page canonicals when Astro ships none", async () => {
    const server = await startApp(noSitemapDist);
    try {
      const xml = await (await request(server.baseUrl, "/sitemap.xml")).text();
      expect(xml).toContain("<loc>https://scholarmark.ai/guides/thesis-outline/</loc>");
      expect(xml).toContain("<loc>https://scholarmark.ai/blog</loc>");
    } finally {
      await server.close();
    }
  });

  it("keeps a non-production Astro release blocked from crawlers", async () => {
    const server = await startApp(previewDist);
    try {
      const home = await request(server.baseUrl, "/");
      expect(home.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(await home.text()).toContain("astro-home");

      // Without canonicals there is no redirect; both forms render.
      const slashless = await request(server.baseUrl, "/guides/thesis-outline");
      expect(slashless.status).toBe(200);

      const robots = await request(server.baseUrl, "/robots.txt");
      expect(robots.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(await robots.text()).toBe("User-agent: *\nDisallow: /\n");

      const xml = await (await request(server.baseUrl, "/sitemap.xml")).text();
      expect(xml).not.toContain("<loc>");
    } finally {
      await server.close();
    }
  });

  it("serves the IndexNow key file on the exact canonical host only", async () => {
    const server = await startApp(productionDist, ` ${INDEXNOW_KEY}\n`);
    try {
      const keyPath = `/${INDEXNOW_KEY}.txt`;
      const keyFile = await request(server.baseUrl, keyPath);
      expect(keyFile.status).toBe(200);
      expect(keyFile.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(keyFile.headers.get("x-robots-tag")).toBe("noindex");
      expect(keyFile.headers.get("cache-control")).toBe("no-cache");
      expect(await keyFile.text()).toBe(INDEXNOW_KEY);

      const head = await request(server.baseUrl, keyPath, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(head.headers.get("content-type")).toBe("text/plain; charset=utf-8");

      const www = await request(server.baseUrl, keyPath, { host: "www.scholarmark.ai" });
      expect(www.status).toBe(308);
      expect(www.headers.get("location")).toBe(`https://scholarmark.ai${keyPath}`);

      for (const host of ["app.scholarmark.ai", "preview.internal"]) {
        const other = await request(server.baseUrl, keyPath, { host });
        expect(await other.text()).toBe(`spa:GET:${keyPath}`);
      }
      for (const otherPath of [
        "/0123456789abcdef0123456789abcde0.txt",
        `/${INDEXNOW_KEY}.TXT`,
        `/${INDEXNOW_KEY}.txt/`,
        `/guides/${INDEXNOW_KEY}.txt`,
      ]) {
        const other = await request(server.baseUrl, otherPath);
        expect(await other.text()).not.toBe(INDEXNOW_KEY);
      }
      const post = await request(server.baseUrl, keyPath, { method: "POST" });
      expect(await post.text()).toBe(`spa:POST:${keyPath}`);
    } finally {
      await server.close();
    }
  });

  it("serves no IndexNow key file by default, for invalid keys, or for a non-indexable release", async () => {
    const cases: Array<[string, string | undefined, string]> = [
      [productionDist, undefined, INDEXNOW_KEY],
      [productionDist, "", INDEXNOW_KEY],
      [productionDist, INDEXNOW_KEY.toUpperCase(), INDEXNOW_KEY.toUpperCase()],
      [productionDist, "short-key", "short-key"],
      [productionDist, `${INDEXNOW_KEY}0`, `${INDEXNOW_KEY}0`],
      [previewDist, INDEXNOW_KEY, INDEXNOW_KEY],
    ];
    for (const [distPath, configured, requested] of cases) {
      const server = await startApp(distPath, configured);
      try {
        const response = await request(server.baseUrl, `/${requested}.txt`);
        expect(await response.text()).toBe(`spa:GET:/${requested}.txt`);
      } finally {
        await server.close();
      }
    }
  });

  it("falls back to the SPA root when the marketing build is missing", async () => {
    const missing = path.join(fixtureRoot, "missing");
    expect(loadMarketingSite({ distPath: missing, spaPublicPath: spaPublic })).toBeNull();
    const server = await startApp(missing);
    try {
      expect(await (await request(server.baseUrl, "/")).text()).toBe("spa:GET:/");
      expect(await (await request(server.baseUrl, "/robots.txt")).text()).toBe(
        "spa:GET:/robots.txt",
      );
    } finally {
      await server.close();
    }
  });
});

describe("marketing site switches", () => {
  it("only enables the Astro root when explicitly set to astro", () => {
    expect(isMarketingSiteEnabled({})).toBe(false);
    expect(isMarketingSiteEnabled({ SCHOLARMARK_MARKETING_SITE: "spa" })).toBe(false);
    expect(isMarketingSiteEnabled({ SCHOLARMARK_MARKETING_SITE: "true" })).toBe(false);
    expect(isMarketingSiteEnabled({ SCHOLARMARK_MARKETING_SITE: " Astro " })).toBe(true);
  });

  it("routes the root by query flags only", () => {
    expect(shouldServeMarketingRoot("")).toBe(true);
    expect(shouldServeMarketingRoot("?utm_source=google&utm_medium=cpc")).toBe(true);
    expect(shouldServeMarketingRoot("?ref=abc")).toBe(false);
    expect(shouldServeMarketingRoot("?sm_landing=legacy")).toBe(false);
    expect(shouldServeMarketingRoot("?embedded_auth=1")).toBe(false);
  });
});
