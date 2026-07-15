import type { NextFunction, Request, Response } from "express";

const CANONICAL_HOST = "scholarmark.ai";
const PUBLIC_HOSTS = new Set([CANONICAL_HOST, `www.${CANONICAL_HOST}`]);

export function canonicalRequest(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV !== "production") {
    next();
    return;
  }

  const host = (req.hostname || "").toLowerCase();
  if (!PUBLIC_HOSTS.has(host)) {
    next();
    return;
  }

  if (host !== CANONICAL_HOST || !req.secure) {
    res.redirect(308, `https://${CANONICAL_HOST}${req.originalUrl}`);
    return;
  }

  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
}
