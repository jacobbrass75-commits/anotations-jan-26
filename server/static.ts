import express, { type Express, type NextFunction, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import { blogArticles } from "../client/src/content/marketingContent";
import { isPaidInstagramCampaign, isScholarMarkMarketingHost } from "../shared/paidInstagramEntry";
import { createLogger } from "./logger";

export const HTML_CACHE_CONTROL = "no-store, no-cache, must-revalidate, max-age=0, s-maxage=0";

/** `astro` serves the static marketing build on the marketing host; anything else keeps the SPA root. */
export const MARKETING_SITE_ENV = "SCHOLARMARK_MARKETING_SITE";
export const MARKETING_PREVIEW_HOSTS_ENV = "SCHOLARMARK_MARKETING_PREVIEW_HOSTS";
export const MARKETING_ORIGIN = "https://scholarmark.ai";

const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const PUBLIC_FILE_CACHE_CONTROL = "public, max-age=3600";
const MAX_MARKETING_FILES = 20_000;

// Root-level query params that belong to SPA landing flows (paid Instagram,
// referrals, embedded auth). Those visits keep the existing React landing.
const SPA_ROOT_QUERY_PARAMS = [
  "ref",
  "code",
  "invite",
  "sm_landing",
  "sm_direct_signup",
  "embedded_auth",
];

// Public SPA pages that stay indexable after the Astro root ships.
const LEGACY_PUBLIC_PATHS = ["/pricing", "/faq", "/blog", "/privacy", "/terms", "/support"];

const ROBOTS_DISALLOW = [
  "/api/",
  "/dashboard",
  "/projects",
  "/web-clips",
  "/chat",
  "/write",
  "/account",
  "/admin",
  "/extension-auth",
  "/sign-in",
  "/sign-up",
  "/sso-callback",
  "/summer/onboarding",
];

const staticLogger = createLogger("static");

function setHtmlHeaders(res: express.Response): void {
  res.setHeader("Cache-Control", HTML_CACHE_CONTROL);
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

function staticPaths() {
  const distPath = path.resolve(__dirname, "public");
  const indexPath = path.resolve(distPath, "index.html");
  if (!fs.existsSync(distPath) || !fs.existsSync(indexPath)) {
    throw new Error(`Could not find the production client build at ${distPath}`);
  }
  return { distPath, indexPath };
}

function setStaticHeaders(res: express.Response, filePath: string): void {
  if (filePath.endsWith(".html")) {
    setHtmlHeaders(res);
    return;
  }
  if (filePath.includes(`${path.sep}assets${path.sep}`)) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
}

export function isMarketingSiteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[MARKETING_SITE_ENV]?.trim().toLowerCase() === "astro";
}

function hasSignedInHint(cookieHeader: string | undefined): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(";").some((part) => {
    const separator = part.indexOf("=");
    if (separator === -1) return false;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    const isClientUat = name === "__client_uat" || name.startsWith("__client_uat_");
    return isClientUat && value !== "" && value !== "0";
  });
}

/** The marketing root yields to the SPA for campaign, referral, and signed-in visits. */
export function shouldServeMarketingRoot(search: string, cookieHeader?: string): boolean {
  if (isPaidInstagramCampaign(search)) return false;
  const params = new URLSearchParams(search);
  if (SPA_ROOT_QUERY_PARAMS.some((key) => params.has(key))) return false;
  // Clerk's client cookie marks a signed-in browser; the SPA sends it to /dashboard.
  return !hasSignedInHint(cookieHeader);
}

interface MarketingPage {
  filePath: string;
  canonicalPath: string | null;
  noindex: boolean;
}

interface HeaderRule {
  pattern: string;
  headers: Array<[string, string]>;
}

interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

interface MarketingManifest {
  rootPage: MarketingPage;
  pages: Map<string, MarketingPage>;
  files: Map<string, { filePath: string; cacheControl: string }>;
  notFoundHtml: Buffer | null;
  headerRules: HeaderRule[];
  indexable: boolean;
  robots: string;
  sitemap: string;
  ignoredPages: string[];
}

// Caching stays server-owned so HTML is never cached across asset deployments.
const IGNORED_RULE_HEADERS = new Set([
  "cache-control",
  "connection",
  "content-length",
  "content-type",
  "location",
  "set-cookie",
  "transfer-encoding",
]);

function listMarketingFiles(root: string): string[] {
  const files: string[] = [];
  const pending = [""];
  while (pending.length > 0) {
    const relativeDir = pending.pop()!;
    for (const entry of fs.readdirSync(path.join(root, relativeDir), { withFileTypes: true })) {
      // Dotfiles never ship, and symlinks are skipped so nothing resolves outside the build.
      if (entry.name.startsWith(".")) continue;
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        pending.push(relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
        if (files.length > MAX_MARKETING_FILES) {
          throw new Error(`Marketing build has more than ${MAX_MARKETING_FILES} files`);
        }
      }
    }
  }
  return files.sort();
}

function readOptionalFile(filePath: string): string | null {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

function readPage(filePath: string): MarketingPage {
  const html = fs.readFileSync(filePath, "utf8");
  const noindex = (html.match(/<meta\b[^>]*>/gi) ?? []).some(
    (tag) =>
      /\bname\s*=\s*["']?robots\b/i.test(tag) && /\bcontent\s*=\s*["'][^"']*noindex/i.test(tag),
  );
  const canonicalTag = (html.match(/<link\b[^>]*>/gi) ?? []).find((tag) =>
    /\brel\s*=\s*["']?canonical\b/i.test(tag),
  );
  const href = canonicalTag?.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
  let canonicalPath: string | null = null;
  if (href) {
    try {
      const url = new URL(href, MARKETING_ORIGIN);
      if (isScholarMarkMarketingHost(url.hostname)) canonicalPath = url.pathname;
    } catch {
      canonicalPath = null;
    }
  }
  return { filePath, canonicalPath, noindex };
}

/** Netlify/Cloudflare `_headers`: exact paths and trailing `*` wildcards. */
function parseHeaderRules(text: string | null): HeaderRule[] {
  const rules: HeaderRule[] = [];
  let current: HeaderRule | null = null;
  for (const line of (text ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      current = { pattern: trimmed, headers: [] };
      rules.push(current);
      continue;
    }
    const separator = trimmed.indexOf(":");
    if (!current || separator <= 0) continue;
    const name = trimmed.slice(0, separator).trim();
    if (!IGNORED_RULE_HEADERS.has(name.toLowerCase())) {
      current.headers.push([name, trimmed.slice(separator + 1).trim()]);
    }
  }
  return rules;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => `&#${char.charCodeAt(0)};`);
}

function parseSitemap(xml: string): SitemapEntry[] {
  return Array.from(xml.matchAll(/<url>([\s\S]*?)<\/url>/g)).flatMap(([, body]) => {
    const loc = body.match(/<loc>\s*([^<]+?)\s*<\/loc>/)?.[1];
    const lastmod = body.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/)?.[1];
    return loc ? [{ loc: decodeXml(loc), lastmod }] : [];
  });
}

function renderSitemap(entries: SitemapEntry[]): string {
  const urls = entries.map((entry) =>
    entry.lastmod
      ? `  <url><loc>${escapeXml(entry.loc)}</loc><lastmod>${escapeXml(entry.lastmod)}</lastmod></url>`
      : `  <url><loc>${escapeXml(entry.loc)}</loc></url>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

function renderRobots(): string {
  return [
    "User-agent: *",
    "Allow: /",
    ...ROBOTS_DISALLOW.map((disallowed) => `Disallow: ${disallowed}`),
    "",
    `Sitemap: ${MARKETING_ORIGIN}/sitemap.xml`,
    "",
  ].join("\n");
}

function buildMarketingManifest(distPath: string, spaPublicPath: string): MarketingManifest {
  const rootPage = readPage(path.join(distPath, "index.html"));
  const pages = new Map<string, MarketingPage>();
  const files = new Map<string, { filePath: string; cacheControl: string }>();
  const ignoredPages: string[] = [];
  let notFoundHtml: Buffer | null = null;

  for (const relativePath of listMarketingFiles(distPath)) {
    const filePath = path.join(distPath, ...relativePath.split("/"));
    const urlPath = `/${relativePath}`;
    const isHtml = relativePath.endsWith(".html");

    if (relativePath === "index.html") continue;
    if (relativePath === "404.html") {
      notFoundHtml = fs.readFileSync(filePath);
    } else if (relativePath.startsWith("_astro/")) {
      files.set(urlPath, { filePath, cacheControl: IMMUTABLE_CACHE_CONTROL });
    } else if (relativePath.startsWith("guides/") && isHtml) {
      const route = urlPath.replace(/\.html$/, "").replace(/\/index$/, "");
      pages.set(route, readPage(filePath));
    } else if (relativePath.startsWith("guides/")) {
      files.set(urlPath, { filePath, cacheControl: PUBLIC_FILE_CACHE_CONTROL });
    } else if (isHtml) {
      // Only `/` and `/guides` are reserved for Astro; SPA routes keep their pages.
      ignoredPages.push(urlPath);
    } else if (
      // `_headers`/`_redirects` are host config; robots/sitemap are composed below.
      !relativePath.startsWith("_") &&
      relativePath !== "robots.txt" &&
      !/^sitemap[\w.-]*\.xml(?:\.gz)?$/.test(relativePath) &&
      !relativePath.startsWith("assets/") &&
      !relativePath.startsWith("api/") &&
      !fs.existsSync(path.join(spaPublicPath, ...relativePath.split("/")))
    ) {
      files.set(urlPath, { filePath, cacheControl: PUBLIC_FILE_CACHE_CONTROL });
    }
  }

  // Astro gates indexing on its release env; a non-production build keeps its
  // own blocking robots.txt and empty sitemap so previews never get indexed.
  const astroRobots = readOptionalFile(path.join(distPath, "robots.txt"));
  const astroSitemap = readOptionalFile(path.join(distPath, "sitemap.xml"));
  const indexable =
    astroRobots === null ? !rootPage.noindex : !/^\s*Disallow:\s*\/\s*$/im.test(astroRobots);

  let robots: string;
  let sitemap: string;
  if (indexable) {
    const entries: SitemapEntry[] = [];
    const addEntry = (entry: SitemapEntry) => {
      if (!entries.some((existing) => existing.loc === entry.loc)) entries.push(entry);
    };
    if (astroSitemap !== null) {
      parseSitemap(astroSitemap).forEach(addEntry);
    } else {
      const astroPages: Array<[string, MarketingPage]> = [
        ["/", rootPage],
        ...Array.from(pages.entries()),
      ];
      for (const [route, page] of astroPages) {
        if (!page.noindex) addEntry({ loc: `${MARKETING_ORIGIN}${page.canonicalPath ?? route}` });
      }
    }
    for (const legacyPath of LEGACY_PUBLIC_PATHS) {
      addEntry({ loc: `${MARKETING_ORIGIN}${legacyPath}` });
    }
    for (const article of blogArticles) {
      addEntry({ loc: `${MARKETING_ORIGIN}/blog/${article.slug}` });
    }
    robots = renderRobots();
    sitemap = renderSitemap(entries);
  } else {
    robots = astroRobots ?? "User-agent: *\nDisallow: /\n";
    sitemap = astroSitemap ?? renderSitemap([]);
  }

  return {
    rootPage,
    pages,
    files,
    notFoundHtml,
    headerRules: parseHeaderRules(readOptionalFile(path.join(distPath, "_headers"))),
    indexable,
    robots,
    sitemap,
    ignoredPages,
  };
}

export interface MarketingSite {
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  indexable: boolean;
  ignoredPages: string[];
}

export interface MarketingSiteOptions {
  distPath: string;
  spaPublicPath: string;
  previewHosts?: string[];
}

/**
 * Load the Astro build once at startup. Returns null when the build is missing
 * so the caller keeps serving the SPA root instead of failing the process.
 */
export function loadMarketingSite(options: MarketingSiteOptions): MarketingSite | null {
  const distPath = path.resolve(options.distPath);
  if (!fs.existsSync(path.join(distPath, "index.html"))) {
    staticLogger.error(
      { distPath },
      "marketing site enabled but build is missing; serving SPA root",
    );
    return null;
  }

  let manifest: MarketingManifest;
  try {
    manifest = buildMarketingManifest(distPath, path.resolve(options.spaPublicPath));
  } catch (err) {
    staticLogger.error({ err, distPath }, "marketing site build is unreadable; serving SPA root");
    return null;
  }

  const previewHosts = new Set(
    (options.previewHosts ?? []).map((host) => host.trim().toLowerCase()),
  );
  const isMarketingHost = (host: string) =>
    isScholarMarkMarketingHost(host) || previewHosts.has(host.toLowerCase());

  if (manifest.ignoredPages.length > 0) {
    staticLogger.warn(
      { ignoredPages: manifest.ignoredPages },
      "marketing pages outside / and /guides are not served",
    );
  }
  staticLogger.info(
    {
      distPath,
      pages: manifest.pages.size + 1,
      files: manifest.files.size,
      indexable: manifest.indexable,
    },
    "serving Astro marketing site on the marketing host",
  );

  function setMarketingHeaders(res: Response, pathname: string, cacheControl: string): void {
    for (const rule of manifest.headerRules) {
      const matches = rule.pattern.endsWith("*")
        ? pathname.startsWith(rule.pattern.slice(0, -1))
        : pathname === rule.pattern;
      if (matches) for (const [name, value] of rule.headers) res.setHeader(name, value);
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-ScholarMark-Surface", "marketing");
    if (cacheControl === HTML_CACHE_CONTROL) {
      setHtmlHeaders(res);
    } else {
      res.setHeader("Cache-Control", cacheControl);
    }
  }

  function sendNotFound(res: Response, pathname: string, notFoundHtml: Buffer | null): void {
    setMarketingHeaders(res, pathname, HTML_CACHE_CONTROL);
    if (notFoundHtml) {
      res.status(404).type("html").send(notFoundHtml);
    } else {
      res.status(404).type("text/plain").send("Not found");
    }
  }

  function sendFile(res: Response, pathname: string, filePath: string, cacheControl: string) {
    setMarketingHeaders(res, pathname, cacheControl);
    // Paths come from the startup manifest, never from the request.
    res.sendFile(filePath, { cacheControl: false, dotfiles: "allow" }, (error) => {
      if (error && !res.headersSent) sendNotFound(res, pathname, null);
    });
  }

  function sendPage(req: Request, res: Response, pathname: string, page: MarketingPage) {
    // Redirect to the canonical trailing-slash form so each page has one URL.
    const canonical = page.canonicalPath;
    if (
      canonical &&
      canonical !== pathname &&
      canonical.replace(/\/$/, "") === pathname.replace(/\/$/, "")
    ) {
      const queryStart = req.originalUrl.indexOf("?");
      const search = queryStart === -1 ? "" : req.originalUrl.slice(queryStart);
      return res.redirect(308, `${canonical}${search}`);
    }
    sendFile(res, pathname, page.filePath, HTML_CACHE_CONTROL);
  }

  const middleware = (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();

    let pathname: string;
    try {
      pathname = decodeURIComponent(req.path);
    } catch {
      return next();
    }

    // Hashed Astro assets are host-neutral and never fall through to the SPA.
    if (pathname.startsWith("/_astro/")) {
      const asset = manifest.files.get(pathname);
      if (asset) return sendFile(res, pathname, asset.filePath, asset.cacheControl);
      return sendNotFound(res, pathname, null);
    }

    const onMarketingHost = isMarketingHost(req.hostname || "");
    if (pathname === "/guides" || pathname.startsWith("/guides/")) {
      if (!onMarketingHost) return res.redirect(308, `${MARKETING_ORIGIN}${req.originalUrl}`);
      const route = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
      const page = manifest.pages.get(route);
      if (page) return sendPage(req, res, pathname, page);
      const file = manifest.files.get(pathname);
      if (file) return sendFile(res, pathname, file.filePath, file.cacheControl);
      return sendNotFound(res, pathname, manifest.notFoundHtml);
    }

    if (!onMarketingHost) return next();

    if (pathname === "/") {
      const queryStart = req.originalUrl.indexOf("?");
      const search = queryStart === -1 ? "" : req.originalUrl.slice(queryStart);
      if (!shouldServeMarketingRoot(search, req.headers.cookie)) return next();
      return sendPage(req, res, pathname, manifest.rootPage);
    }

    if (pathname === "/robots.txt" || pathname === "/sitemap.xml") {
      setMarketingHeaders(res, pathname, PUBLIC_FILE_CACHE_CONTROL);
      res.type(pathname === "/robots.txt" ? "text/plain" : "application/xml");
      return res.send(pathname === "/robots.txt" ? manifest.robots : manifest.sitemap);
    }

    const file = manifest.files.get(pathname);
    if (file) return sendFile(res, pathname, file.filePath, file.cacheControl);
    next();
  };

  return { middleware, indexable: manifest.indexable, ignoredPages: manifest.ignoredPages };
}

/** Serve public assets and ad landing entries before auth/rate-limit middleware. */
export function servePublicStatic(app: Express) {
  const { distPath, indexPath } = staticPaths();
  if (isMarketingSiteEnabled()) {
    const marketingSite = loadMarketingSite({
      distPath: path.resolve(__dirname, "marketing"),
      spaPublicPath: distPath,
      previewHosts: (process.env[MARKETING_PREVIEW_HOSTS_ENV] ?? "").split(",").filter(Boolean),
    });
    if (marketingSite) app.use(marketingSite.middleware);
  }
  app.use(express.static(distPath, { index: false, setHeaders: setStaticHeaders }));
  app.get(["/", "/start", "/summer", "/invite", "/invite/:code"], (_req, res) => {
    setHtmlHeaders(res);
    res.sendFile(indexPath);
  });
}

export function serveStatic(app: Express) {
  const { indexPath } = staticPaths();

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    setHtmlHeaders(res);
    res.sendFile(indexPath);
  });
}
