import type { Express, Request, Response, NextFunction } from "express";
import { clerkMiddleware, getAuth, clerkClient } from "@clerk/express";
import { getOrCreateUser } from "./authStorage";

// Extend Express Request to include user property (same shape as before)
declare global {
  namespace Express {
    interface User {
      userId: string;
      email: string;
      tier: string;
    }
  }
}

// ── Tier hierarchy ──────────────────────────────────────────────────
const TIER_LEVELS: Record<string, number> = { free: 0, pro: 1, max: 2 };

const TIER_TOKEN_LIMITS: Record<string, number> = {
  free: 50_000,
  pro: 500_000,
  max: 2_000_000,
};

const TIER_STORAGE_LIMITS: Record<string, number> = {
  free: 52_428_800,       // 50 MB
  pro: 524_288_000,       // 500 MB
  max: 5_368_709_120,     // 5 GB
};

// ── Install Clerk middleware globally ────────────────────────────────
export function configureClerk(app: Express): void {
  app.use(clerkMiddleware());
}

// ── Resolve Clerk user → local DB user, set req.user ────────────────
async function resolveUser(req: Request): Promise<Express.User | null> {
  const auth = getAuth(req);
  if (!auth?.userId) return null;

  // Get Clerk user details for email + metadata
  const clerkUser = await clerkClient.users.getUser(auth.userId);
  const email = clerkUser.emailAddresses?.[0]?.emailAddress ?? "";
  const tier = (clerkUser.publicMetadata?.tier as string) || "free";

  // Ensure a local DB row exists (for usage tracking)
  await getOrCreateUser(auth.userId, email, tier);

  return { userId: auth.userId, email, tier };
}

// ── Middleware: requires a valid Clerk session ───────────────────────
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }
    req.user = user;
    next();
  } catch (err) {
    console.error("Auth error:", err);
    res.status(401).json({ message: "Authentication failed" });
  }
}

// ── Middleware: attaches user if present, doesn't reject ─────────────
export async function optionalAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await resolveUser(req);
    if (user) req.user = user;
  } catch {
    // silently ignore
  }
  next();
}

// ── Middleware: require minimum tier ─────────────────────────────────
export function requireTier(minTier: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userTier = req.user?.tier ?? "free";
    const userLevel = TIER_LEVELS[userTier] ?? 0;
    const requiredLevel = TIER_LEVELS[minTier] ?? 0;

    if (userLevel < requiredLevel) {
      res.status(403).json({
        message: `This feature requires the ${minTier} plan`,
        requiredTier: minTier,
        currentTier: userTier,
      });
      return;
    }
    next();
  };
}

// ── Middleware: check monthly token budget ───────────────────────────
export function checkTokenBudget(req: Request, res: Response, next: NextFunction): void {
  // Actual check happens in the AI call handlers where token counts are known.
  // This is a placeholder hook — usage is tracked via authStorage.incrementTokenUsage().
  next();
}

// ── Helper exports for route handlers ───────────────────────────────
export { TIER_LEVELS, TIER_TOKEN_LIMITS, TIER_STORAGE_LIMITS };
