import { createHash, randomBytes, randomUUID } from "crypto";
import type { Express, Request, Response } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { apiKeys } from "@shared/schema";
import { requireAuth } from "./auth";
import { getUserById, sanitizeUser } from "./authStorage";
import { db } from "./db";

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

export function registerAuthRoutes(app: Express): void {
  // GET /api/auth/me - Return current user profile
  app.get("/api/auth/me", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await getUserById(req.user!.userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      return res.json(sanitizeUser(user));
    } catch (error) {
      console.error("Get profile error:", error);
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

      const tokenPercent = user.tokenLimit > 0
        ? Math.round((user.tokensUsed / user.tokenLimit) * 100)
        : 0;
      const storagePercent = user.storageLimit > 0
        ? Math.round((user.storageUsed / user.storageLimit) * 100)
        : 0;

      return res.json({
        tokensUsed: user.tokensUsed,
        tokenLimit: user.tokenLimit,
        tokenPercent,
        storageUsed: user.storageUsed,
        storageLimit: user.storageLimit,
        storagePercent,
        tier: user.tier,
        billingCycleStart: user.billingCycleStart
          ? (user.billingCycleStart as any).toISOString?.() ?? user.billingCycleStart
          : null,
      });
    } catch (error) {
      console.error("Usage error:", error);
      return res.status(500).json({ message: "Failed to fetch usage" });
    }
  });

  app.get("/api/auth/api-keys", requireAuth, async (req: Request, res: Response) => {
    try {
      const keys = await db
        .select({
          id: apiKeys.id,
          label: apiKeys.label,
          keyPrefix: apiKeys.keyPrefix,
          lastUsedAt: apiKeys.lastUsedAt,
          createdAt: apiKeys.createdAt,
        })
        .from(apiKeys)
        .where(and(eq(apiKeys.userId, req.user!.userId), isNull(apiKeys.revokedAt)))
        .orderBy(desc(apiKeys.createdAt));

      return res.json({ apiKeys: keys });
    } catch (error) {
      console.error("API key list error:", error);
      return res.status(500).json({ message: "Failed to fetch API keys" });
    }
  });

  app.post("/api/auth/api-keys", requireAuth, async (req: Request, res: Response) => {
    try {
      const rawKey = generateApiKey();
      const now = Math.floor(Date.now() / 1000);
      const label = normalizeApiKeyLabel(req.body?.label) ?? "API Key";

      const [createdKey] = await db
        .insert(apiKeys)
        .values({
          id: randomUUID(),
          userId: req.user!.userId,
          label,
          keyHash: hashApiKey(rawKey),
          keyPrefix: rawKey.slice(0, 12),
          createdAt: now,
        })
        .returning({
          id: apiKeys.id,
          label: apiKeys.label,
          keyPrefix: apiKeys.keyPrefix,
          createdAt: apiKeys.createdAt,
        });

      return res.status(201).json({
        ...createdKey,
        key: rawKey,
      });
    } catch (error) {
      console.error("API key create error:", error);
      return res.status(500).json({ message: "Failed to create API key" });
    }
  });

  app.delete("/api/auth/api-keys/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const [existingKey] = await db
        .select({
          id: apiKeys.id,
        })
        .from(apiKeys)
        .where(and(eq(apiKeys.id, req.params.id), eq(apiKeys.userId, req.user!.userId), isNull(apiKeys.revokedAt)))
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
      console.error("API key revoke error:", error);
      return res.status(500).json({ message: "Failed to revoke API key" });
    }
  });
}
