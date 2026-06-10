import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;

function ipKey(req: Request): string {
  return ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? "unknown");
}

const commonOptions = {
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    // ScholarMark intentionally trusts nginx/Cloudflare proxy headers.
    trustProxy: false,
  },
};

export const authLimiter = rateLimit({
  ...commonOptions,
  windowMs: FIFTEEN_MINUTES_MS,
  limit: 20,
  keyGenerator: ipKey,
});

export const aiLimiter = rateLimit({
  ...commonOptions,
  windowMs: ONE_MINUTE_MS,
  limit: 30,
  keyGenerator: (req) => {
    const userId = req.user?.userId;
    return userId ? `user:${userId}` : `ip:${ipKey(req)}`;
  },
});

export const globalLimiter = rateLimit({
  ...commonOptions,
  windowMs: FIFTEEN_MINUTES_MS,
  limit: 600,
  skip: (req) => req.path === "/healthz" || req.path === "/readyz",
});
