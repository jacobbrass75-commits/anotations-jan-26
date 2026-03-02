import type { Express, Request, Response } from "express";
import { createHash, randomBytes, randomUUID } from "crypto";
import { requireAuth } from "./auth";
import { getUserById, sanitizeUser } from "./authStorage";
import { sqlite } from "./db";

interface ApiKeyListRow {
  id: string;
  key_prefix: string;
  label: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

const insertApiKey = sqlite.prepare(
  `INSERT INTO api_keys (
     id,
     user_id,
     key_hash,
     key_prefix,
     label,
     created_at
   ) VALUES (?, ?, ?, ?, ?, ?)`
);

const listApiKeysByUser = sqlite.prepare(
  `SELECT
      id,
      key_prefix,
      label,
      created_at,
      last_used_at,
      revoked_at
   FROM api_keys
   WHERE user_id = ?
   ORDER BY created_at DESC`
);

const revokeApiKeyById = sqlite.prepare(
  `UPDATE api_keys
   SET revoked_at = ?
   WHERE id = ?
     AND user_id = ?
     AND revoked_at IS NULL`
);

function getUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

function buildApiKey(): { rawKey: string; keyHash: string; keyPrefix: string } {
  const rawKey = `sk_sm_${randomBytes(32).toString("hex")}`;
  return {
    rawKey,
    keyHash: hashApiKey(rawKey),
    keyPrefix: rawKey.slice(0, 14), // "sk_sm_" + first 8 random chars
  };
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

  // POST /api/auth/api-keys - Create a new API key for current user
  app.post("/api/auth/api-keys", requireAuth, async (req: Request, res: Response) => {
    try {
      const labelInput = typeof req.body?.label === "string" ? req.body.label.trim() : "";
      const label = labelInput || "Chrome Extension";
      const { rawKey, keyHash, keyPrefix } = buildApiKey();
      const id = randomUUID();
      const createdAt = getUnixSeconds();

      insertApiKey.run(id, req.user!.userId, keyHash, keyPrefix, label, createdAt);

      return res.status(201).json({
        id,
        key: rawKey,
        prefix: keyPrefix,
        label,
        createdAt,
      });
    } catch (error) {
      console.error("Create API key error:", error);
      return res.status(500).json({ message: "Failed to create API key" });
    }
  });

  // GET /api/auth/api-keys - List API keys for current user (never returns raw key)
  app.get("/api/auth/api-keys", requireAuth, async (req: Request, res: Response) => {
    try {
      const rows = listApiKeysByUser.all(req.user!.userId) as ApiKeyListRow[];
      return res.json({
        keys: rows.map((row) => ({
          id: row.id,
          prefix: row.key_prefix,
          label: row.label,
          createdAt: row.created_at,
          lastUsedAt: row.last_used_at,
          revokedAt: row.revoked_at,
        })),
      });
    } catch (error) {
      console.error("List API keys error:", error);
      return res.status(500).json({ message: "Failed to fetch API keys" });
    }
  });

  // DELETE /api/auth/api-keys/:id - Revoke an API key
  app.delete("/api/auth/api-keys/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const revokedAt = getUnixSeconds();
      const result = revokeApiKeyById.run(revokedAt, req.params.id, req.user!.userId);

      if (result.changes === 0) {
        return res.status(404).json({ message: "API key not found" });
      }

      return res.json({ success: true, revokedAt });
    } catch (error) {
      console.error("Revoke API key error:", error);
      return res.status(500).json({ message: "Failed to revoke API key" });
    }
  });
}
