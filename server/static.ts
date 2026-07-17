import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export const HTML_CACHE_CONTROL = "no-store, no-cache, must-revalidate, max-age=0, s-maxage=0";

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

/** Serve public assets and ad landing entries before auth/rate-limit middleware. */
export function servePublicStatic(app: Express) {
  const { distPath, indexPath } = staticPaths();
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
