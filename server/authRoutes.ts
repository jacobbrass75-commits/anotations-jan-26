import { createHash, randomBytes, randomUUID } from "crypto";
import type { Express, NextFunction, Request, Response } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { apiKeys } from "@shared/schema";
import { requireAuth } from "./auth";
import { getUserById, sanitizeUser } from "./authStorage";
import { db, usageLedger } from "./db";
import { authLimiter } from "./rateLimits";
import { createLogger } from "./logger";
import { getAiUsagePlan, normalizePlanTier } from "./planLimits";
import { resolvePeriod } from "./usageLedger";

const logger = createLogger("authRoutes");

const EXTENSION_API_KEY_SCOPE = "projects:read web_clips:write api_keys:self_revoke";

function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

function generateApiKey(): string {
  return `sk_sm_${randomBytes(24).toString("hex")}`;
}

function normalizeApiKeyLabel(label: unknown): string | null {
  if (typeof label !== "string") {
    return null;
  }

  const trimmed = label.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, 100);
}

function requireFirstPartyAccountAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.authType === "mcp" || req.user?.authType === "api_key") {
    res.status(403).json({ message: "API keys and OAuth tokens cannot manage API keys" });
    return;
  }

  next();
}

function canSelfRevokeApiKey(req: Request): boolean {
  return (
    req.user?.authType === "api_key" &&
    req.user.apiKeyId === req.params.id &&
    Boolean(req.user.scopes?.includes("api_keys:self_revoke"))
  );
}

function isExtensionApiKeyRequest(body: unknown): boolean {
  return Boolean(
    body &&
    typeof body === "object" &&
    "purpose" in body &&
    (body as { purpose?: unknown }).purpose === "chrome_extension",
  );
}

export function registerAuthRoutes(app: Express): void {
  app.use("/api/auth", authLimiter);

  // GET /api/auth/me - Return current user profile
  app.get("/api/auth/me", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await getUserById(req.user!.userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      return res.json(sanitizeUser(user));
    } catch (error) {
      logger.error({ err: error }, "Get profile error:");
      return res.status(500).json({ message: "Failed to fetch profile" });
    }
  });

  // GET /api/auth/usage - Return token usage, storage usage, limits
  app.get("/api/auth/usage", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await getUserById(req.user!.userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const tokenPercent =
        user.tokenLimit > 0 ? Math.round((user.tokensUsed / user.tokenLimit) * 100) : 0;
      const storagePercent =
        user.storageLimit > 0 ? Math.round((user.storageUsed / user.storageLimit) * 100) : 0;
      const tier = normalizePlanTier(user.tier);
      const creditPlan = getAiUsagePlan(tier);
      const creditPeriod = resolvePeriod(
        tier,
        new Date(),
        user.billingCycleStart,
        user.subscriptionCurrentPeriodEnd,
        creditPlan.periodDays,
      );
      const creditUsage = usageLedger.summary(user.id, creditPeriod.start, creditPeriod.end);

      return res.json({
        tokensUsed: user.tokensUsed,
        tokenLimit: user.tokenLimit,
        tokenPercent,
        storageUsed: user.storageUsed,
        storageLimit: user.storageLimit,
        storagePercent,
        tier: user.tier,
        creditsUsed: creditUsage.creditsUsed,
        creditsLimit: creditPlan.credits,
        creditsRemaining: Math.max(0, creditPlan.credits - creditUsage.creditsUsed),
        aiCostCentsUsed: creditUsage.costCentsUsed,
        aiCostCeilingCents: creditPlan.costCeilingCents,
        creditPeriodEndsAt: creditPeriod.end.toISOString(),
        billingCycleStart: user.billingCycleStart
          ? ((user.billingCycleStart as any).toISOString?.() ?? user.billingCycleStart)
          : null,
      });
    } catch (error) {
      logger.error({ err: error }, "Usage error:");
      return res.status(500).json({ message: "Failed to fetch usage" });
    }
  });

  app.get(
    "/api/auth/api-keys",
    requireAuth,
    requireFirstPartyAccountAuth,
    async (req: Request, res: Response) => {
      try {
        const keys = await db
          .select({
            id: apiKeys.id,
            label: apiKeys.label,
            keyPrefix: apiKeys.keyPrefix,
            scope: apiKeys.scope,
            lastUsedAt: apiKeys.lastUsedAt,
            createdAt: apiKeys.createdAt,
          })
          .from(apiKeys)
          .where(and(eq(apiKeys.userId, req.user!.userId), isNull(apiKeys.revokedAt)))
          .orderBy(desc(apiKeys.createdAt));

        return res.json({ apiKeys: keys });
      } catch (error) {
        logger.error({ err: error }, "API key list error:");
        return res.status(500).json({ message: "Failed to fetch API keys" });
      }
    },
  );

  app.post(
    "/api/auth/api-keys",
    requireAuth,
    requireFirstPartyAccountAuth,
    async (req: Request, res: Response) => {
      try {
        const rawKey = generateApiKey();
        const now = Math.floor(Date.now() / 1000);
        const label = normalizeApiKeyLabel(req.body?.label) ?? "API Key";
        const scope = isExtensionApiKeyRequest(req.body) ? EXTENSION_API_KEY_SCOPE : null;

        const [createdKey] = await db
          .insert(apiKeys)
          .values({
            id: randomUUID(),
            userId: req.user!.userId,
            label,
            keyHash: hashApiKey(rawKey),
            keyPrefix: rawKey.slice(0, 12),
            scope,
            createdAt: now,
          })
          .returning({
            id: apiKeys.id,
            label: apiKeys.label,
            keyPrefix: apiKeys.keyPrefix,
            scope: apiKeys.scope,
            createdAt: apiKeys.createdAt,
          });

        return res.status(201).json({
          ...createdKey,
          key: rawKey,
        });
      } catch (error) {
        logger.error({ err: error }, "API key create error:");
        return res.status(500).json({ message: "Failed to create API key" });
      }
    },
  );

  app.delete("/api/auth/api-keys/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      if (req.user?.authType === "mcp") {
        return res.status(403).json({ message: "OAuth tokens cannot manage API keys" });
      }
      if (req.user?.authType === "api_key" && !canSelfRevokeApiKey(req)) {
        return res.status(403).json({ message: "API key can only revoke itself" });
      }

      const [existingKey] = await db
        .select({
          id: apiKeys.id,
        })
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.id, req.params.id),
            eq(apiKeys.userId, req.user!.userId),
            isNull(apiKeys.revokedAt),
          ),
        )
        .limit(1);

      if (!existingKey) {
        return res.status(404).json({ message: "API key not found" });
      }

      await db
        .update(apiKeys)
        .set({ revokedAt: Math.floor(Date.now() / 1000) })
        .where(eq(apiKeys.id, existingKey.id));

      return res.status(204).send();
    } catch (error) {
      logger.error({ err: error }, "API key revoke error:");
      return res.status(500).json({ message: "Failed to revoke API key" });
    }
  });
}
