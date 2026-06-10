import type { Express, Request, Response, NextFunction } from "express";
import { clerkMiddleware, getAuth, clerkClient } from "@clerk/express";
import { createHash } from "crypto";
import jwt from "jsonwebtoken";
import type { User } from "@shared/schema";
import { getOrCreateUser, getUserByEmail, getUserById } from "./authStorage";
import { sqlite } from "./db";

// Extend Express Request to include user property (same shape as before)
declare global {
  // TODO(lint): Express augments request state through this namespace declaration.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface User {
      userId: string;
      email: string;
      tier: string;
      authType?: "clerk" | "jwt" | "api_key" | "mcp" | "local_dev";
      apiKeyId?: string;
      scopes?: string[];
    }
  }
}

// ── Tier hierarchy ──────────────────────────────────────────────────
const TIER_LEVELS: Record<string, number> = { free: 0, pro: 1, max: 2 };
const VALID_TIERS = new Set(Object.keys(TIER_LEVELS));

const TIER_TOKEN_LIMITS: Record<string, number> = {
  free: 50_000,
  pro: 500_000,
  max: 2_000_000,
};

const TIER_STORAGE_LIMITS: Record<string, number> = {
  free: 52_428_800, // 50 MB
  pro: 524_288_000, // 500 MB
  max: 5_368_709_120, // 5 GB
};

const DEFAULT_JWT_SECRET = "dev-jwt-secret-change-in-production-64chars-long-string-placeholder!!";
const JWT_SECRET = resolveJwtSecret();
const JWT_EXPIRY = "7d";
const LOCAL_DEV_AUTH = process.env.LOCAL_DEV_AUTH === "true";
const LOCAL_DEV_USER_ID = process.env.LOCAL_DEV_USER_ID?.trim() || "";
const LOCAL_DEV_USER_EMAIL = process.env.LOCAL_DEV_USER_EMAIL?.trim() || "";
const CLERK_PUBLISHABLE_KEY =
  process.env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY || "";
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY || "";
const ALLOW_TEST_CLERK_KEYS_IN_PRODUCTION =
  process.env.CLERK_ALLOW_TEST_KEYS_IN_PRODUCTION === "true";

interface ApiKeyRow {
  id: string;
  user_id: string;
  scope: string | null;
}

interface McpTokenRow {
  id: string;
  user_id: string;
  scope: string;
  expires_at: number | null;
}

interface LocalDevUserRow {
  id: string;
  email: string;
  tier: string;
}

interface ClerkEmailAddressLike {
  id?: string | null;
  emailAddress?: string | null;
  verification?: {
    status?: string | null;
  } | null;
}

interface ClerkUserEmailLike {
  emailAddresses?: ClerkEmailAddressLike[] | null;
  primaryEmailAddressId?: string | null;
}

interface ClerkEmailSelection {
  email: string;
  verified: boolean;
}

export interface JwtPayload {
  userId: string;
  email: string;
  tier: string;
  iat: number;
  exp: number;
}

type ApiKeyAuthResult =
  | { status: "none" }
  | { status: "invalid" }
  | { status: "success"; user: Express.User };

const selectApiKeyByHash = sqlite.prepare(
  `SELECT id, user_id, scope
   FROM api_keys
   WHERE key_hash = ?
     AND revoked_at IS NULL
   LIMIT 1`,
);

const touchApiKeyLastUsed = sqlite.prepare(
  `UPDATE api_keys
   SET last_used_at = ?
   WHERE id = ?`,
);

const selectMcpTokenByHash = sqlite.prepare(
  `SELECT id, user_id, scope, expires_at
   FROM mcp_tokens
   WHERE key_hash = ?
     AND revoked_at IS NULL
   LIMIT 1`,
);

const touchMcpTokenLastUsed = sqlite.prepare(
  `UPDATE mcp_tokens
   SET last_used_at = ?
   WHERE id = ?`,
);

const selectLatestLocalDevUser = sqlite.prepare(
  `SELECT id, email, tier
   FROM users
   ORDER BY updated_at DESC
   LIMIT 1`,
);

function assertProductionClerkConfig(): void {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  if (LOCAL_DEV_AUTH) {
    throw new Error("LOCAL_DEV_AUTH must not be enabled in production.");
  }
  if (!ALLOW_TEST_CLERK_KEYS_IN_PRODUCTION && !CLERK_PUBLISHABLE_KEY.startsWith("pk_live_")) {
    throw new Error("Production Clerk publishable key must be configured with a pk_live_ key.");
  }
  if (!ALLOW_TEST_CLERK_KEYS_IN_PRODUCTION && !CLERK_SECRET_KEY.startsWith("sk_live_")) {
    throw new Error("Production Clerk secret key must be configured with an sk_live_ key.");
  }
}

function getUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function resolveJwtSecret(): string {
  const configured = process.env.JWT_SECRET?.trim();
  if (configured) {
    return configured;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be set in production.");
  }
  return DEFAULT_JWT_SECRET;
}

function normalizeClerkTier(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "string" && VALID_TIERS.has(value)) {
    return value;
  }
  throw new Error("Invalid Clerk tier metadata");
}

function getPrimaryClerkEmail(clerkUser: ClerkUserEmailLike): ClerkEmailSelection {
  const addresses = Array.isArray(clerkUser.emailAddresses) ? clerkUser.emailAddresses : [];
  const primary =
    addresses.find((address) => address.id && address.id === clerkUser.primaryEmailAddressId) ??
    null;
  const verified =
    (primary?.verification?.status === "verified" ? primary : null) ??
    addresses.find((address) => address.verification?.status === "verified") ??
    null;
  const selected = verified ?? primary ?? addresses[0] ?? null;
  const email = selected?.emailAddress?.trim();

  if (!email) {
    throw new Error("Clerk user is missing an email address");
  }

  return {
    email,
    verified: selected?.verification?.status === "verified",
  };
}

function parseScopes(scope: string | null | undefined): string[] {
  return Array.from(
    new Set(
      (scope ?? "")
        .split(/\s+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

function requiredScopeForRequest(req: Request): "read" | "write" {
  if (
    req.method === "POST" &&
    (/^\/api\/documents\/[^/]+\/search$/.test(req.path) ||
      /^\/api\/project-documents\/[^/]+\/search$/.test(req.path) ||
      /^\/api\/projects\/[^/]+\/search$/.test(req.path))
  ) {
    return "read";
  }

  return req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS"
    ? "read"
    : "write";
}

function finishAuth(req: Request, res: Response, next: NextFunction, user: Express.User): void {
  if (user.authType === "mcp") {
    const requiredScope = requiredScopeForRequest(req);
    if (!user.scopes?.includes(requiredScope)) {
      res.status(403).json({
        message: "OAuth token lacks required scope",
        requiredScope,
      });
      return;
    }
  }

  if (
    user.authType === "api_key" &&
    user.scopes?.length &&
    !isScopedApiKeyRequestAllowed(req, user)
  ) {
    res.status(403).json({
      message: "API key lacks permission for this endpoint",
    });
    return;
  }

  req.user = user;
  next();
}

function userHasScope(user: Express.User, scope: string): boolean {
  return Boolean(user.scopes?.includes(scope));
}

function isScopedApiKeyRequestAllowed(req: Request, user: Express.User): boolean {
  if (req.method === "GET" && req.path === "/api/projects") {
    return userHasScope(user, "projects:read");
  }

  if (req.method === "POST" && req.path === "/api/web-clips") {
    return userHasScope(user, "web_clips:write");
  }

  if (req.method === "DELETE" && /^\/api\/auth\/api-keys\/[^/]+$/.test(req.path)) {
    return userHasScope(user, "api_keys:self_revoke");
  }

  return false;
}

function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function generateToken(user: Pick<User, "id" | "email" | "tier"> | Express.User): string {
  const userId = "id" in user ? user.id : user.userId;
  const email = user.email;
  const tier = user.tier;

  return jwt.sign({ userId, email, tier }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

function isStructuredJwt(token: string): boolean {
  return token.split(".").length === 3;
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  const [scheme, token] = authHeader.split(/\s+/);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return token;
}

function shouldBypassClerk(req: Request): boolean {
  if (req.path === "/healthz" || req.path === "/readyz") {
    return true;
  }

  if (LOCAL_DEV_AUTH) {
    return true;
  }

  const token = extractBearerToken(req);
  if (!token) {
    return false;
  }

  if (token.startsWith("sk_sm_") || token.startsWith("mcp_sm_")) {
    return true;
  }

  return isStructuredJwt(token) && verifyToken(token) !== null;
}

async function resolveLocalDevUser(): Promise<Express.User | null> {
  if (!LOCAL_DEV_AUTH) {
    return null;
  }

  let dbUser =
    (LOCAL_DEV_USER_ID && (await getUserById(LOCAL_DEV_USER_ID))) ||
    (LOCAL_DEV_USER_EMAIL && (await getUserByEmail(LOCAL_DEV_USER_EMAIL))) ||
    null;

  if (!dbUser) {
    const fallback = selectLatestLocalDevUser.get() as LocalDevUserRow | undefined;
    if (fallback) {
      dbUser = await getUserById(fallback.id);
    }
  }

  if (!dbUser) {
    return null;
  }

  return {
    userId: dbUser.id,
    email: dbUser.email,
    tier: dbUser.tier,
    authType: "local_dev",
  };
}

async function resolveApiKeyUser(req: Request): Promise<ApiKeyAuthResult> {
  const token = extractBearerToken(req);
  if (!token) {
    return { status: "none" };
  }

  const keyHash = hashApiKey(token);
  const now = getUnixSeconds();

  if (token.startsWith("sk_sm_")) {
    const keyRow = selectApiKeyByHash.get(keyHash) as ApiKeyRow | undefined;
    if (!keyRow) {
      return { status: "invalid" };
    }

    const dbUser = await getUserById(keyRow.user_id);
    if (!dbUser) {
      return { status: "invalid" };
    }

    touchApiKeyLastUsed.run(now, keyRow.id);

    return {
      status: "success",
      user: {
        userId: dbUser.id,
        email: dbUser.email,
        tier: dbUser.tier,
        authType: "api_key",
        apiKeyId: keyRow.id,
        scopes: parseScopes(keyRow.scope),
      },
    };
  }

  if (token.startsWith("mcp_sm_")) {
    const tokenRow = selectMcpTokenByHash.get(keyHash) as McpTokenRow | undefined;
    if (!tokenRow) {
      return { status: "invalid" };
    }
    if (tokenRow.expires_at !== null && tokenRow.expires_at <= now) {
      return { status: "invalid" };
    }

    const dbUser = await getUserById(tokenRow.user_id);
    if (!dbUser) {
      return { status: "invalid" };
    }

    touchMcpTokenLastUsed.run(now, tokenRow.id);

    return {
      status: "success",
      user: {
        userId: dbUser.id,
        email: dbUser.email,
        tier: dbUser.tier,
        authType: "mcp",
        scopes: parseScopes(tokenRow.scope),
      },
    };
  }

  return { status: "none" };
}

async function resolveJwtUser(req: Request): Promise<Express.User | null> {
  const token = extractBearerToken(req);
  if (
    !token ||
    token.startsWith("sk_sm_") ||
    token.startsWith("mcp_sm_") ||
    !isStructuredJwt(token)
  ) {
    return null;
  }

  const payload = verifyToken(token);
  if (!payload) {
    return null;
  }

  const dbUser = await getUserById(payload.userId);
  if (!dbUser) {
    return null;
  }

  return {
    userId: dbUser.id,
    email: dbUser.email,
    tier: dbUser.tier,
    authType: "jwt",
  };
}

// ── Install Clerk middleware globally ────────────────────────────────
export function configureClerk(app: Express): void {
  if (LOCAL_DEV_AUTH) {
    return;
  }

  assertProductionClerkConfig();

  const clerk = clerkMiddleware();
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (shouldBypassClerk(req)) {
      next();
      return;
    }
    clerk(req, res, next);
  });
}

// ── Resolve Clerk user → local DB user, set req.user ────────────────
async function resolveUser(req: Request): Promise<Express.User | null> {
  const localDevUser = await resolveLocalDevUser();
  if (localDevUser) {
    return localDevUser;
  }

  const auth = getAuth(req);
  if (!auth?.userId) return null;

  // Get Clerk user details for email + metadata
  const clerkUser = await clerkClient.users.getUser(auth.userId);
  const { email, verified: emailVerified } = getPrimaryClerkEmail(clerkUser);
  const tier = normalizeClerkTier(clerkUser.publicMetadata?.tier);

  // Ensure a local DB row exists (for usage tracking)
  const dbUser = await getOrCreateUser(auth.userId, email, tier, { emailVerified });

  return { userId: dbUser.id, email: dbUser.email, tier: dbUser.tier, authType: "clerk" };
}

// ── Middleware: requires a valid Clerk session, API key, or legacy JWT ───────
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const apiKeyResult = await resolveApiKeyUser(req);
    if (apiKeyResult.status === "success") {
      finishAuth(req, res, next, apiKeyResult.user);
      return;
    }
    if (apiKeyResult.status === "invalid") {
      res.status(401).json({ message: "Invalid API key" });
      return;
    }

    const jwtUser = await resolveJwtUser(req);
    if (jwtUser) {
      finishAuth(req, res, next, jwtUser);
      return;
    }

    const user = await resolveUser(req);
    if (!user) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }
    finishAuth(req, res, next, user);
  } catch (err) {
    console.error("Auth error:", err);
    res.status(401).json({ message: "Authentication failed" });
  }
}

// ── Middleware: attaches user if present, doesn't reject ─────────────
export async function optionalAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const apiKeyResult = await resolveApiKeyUser(req);
    if (apiKeyResult.status === "success") {
      req.user = apiKeyResult.user;
      next();
      return;
    }

    const jwtUser = await resolveJwtUser(req);
    if (jwtUser) {
      req.user = jwtUser;
      next();
      return;
    }

    const user = await resolveUser(req);
    if (user) {
      req.user = user;
    }
  } catch {
    // silently ignore
  }
  next();
}

// ── Middleware: require minimum tier ─────────────────────────────────
export function requireTier(minTier: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userTier = req.user?.tier ?? "free";
    if (!VALID_TIERS.has(userTier)) {
      res.status(403).json({ message: "Invalid account tier" });
      return;
    }
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
export async function hasTokenBudget(req: Request, res: Response): Promise<boolean> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ message: "Authentication required" });
      return false;
    }

    const user = await getUserById(userId);
    if (!user) {
      res.status(401).json({ message: "Authentication required" });
      return false;
    }

    if (user.tokenLimit > 0 && user.tokensUsed >= user.tokenLimit) {
      res.status(403).json({
        message: "Monthly token budget exceeded",
        tokenLimit: user.tokenLimit,
        tokensUsed: user.tokensUsed,
      });
      return false;
    }

    return true;
  } catch (error) {
    console.error("Token budget check failed:", error);
    res.status(500).json({ message: "Failed to check token budget" });
    return false;
  }
}

export async function hasTokenBudgetAvailable(req: Request): Promise<boolean> {
  try {
    const userId = req.user?.userId;
    if (!userId) return false;

    const user = await getUserById(userId);
    if (!user) return false;

    return !(user.tokenLimit > 0 && user.tokensUsed >= user.tokenLimit);
  } catch (error) {
    console.error("Token budget availability check failed:", error);
    return false;
  }
}

export async function checkTokenBudget(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (await hasTokenBudget(req, res)) {
    next();
  }
}

// ── Helper exports for route handlers ───────────────────────────────
export { TIER_LEVELS, TIER_TOKEN_LIMITS, TIER_STORAGE_LIMITS };
