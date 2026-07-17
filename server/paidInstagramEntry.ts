import type { NextFunction, Request, Response } from "express";
import { getPaidInstagramSignupRedirect } from "../shared/paidInstagramEntry";
import { HTML_CACHE_CONTROL } from "./static";

export function paidInstagramEntry(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    next();
    return;
  }

  const queryStart = req.originalUrl.indexOf("?");
  const search = queryStart === -1 ? "" : req.originalUrl.slice(queryStart);
  const redirect = getPaidInstagramSignupRedirect(req.hostname, req.path, search);

  if (!redirect) {
    next();
    return;
  }

  res.setHeader("Cache-Control", HTML_CACHE_CONTROL);
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.redirect(302, redirect);
}
