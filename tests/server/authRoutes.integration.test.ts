import { createHash } from "crypto";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapTempWorkspace } from "./helpers/bootstrapTempWorkspace";
import { requestJson, startHttpServer } from "./helpers/http";

const { clerkGetAuth, clerkMiddleware, clerkGetUser } = vi.hoisted(() => ({
  clerkGetAuth: vi.fn(() => ({ userId: null })),
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  clerkGetUser: vi.fn(),
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware,
  getAuth: clerkGetAuth,
  clerkClient: {
    users: {
      getUser: clerkGetUser,
    },
  },
}));

describe("auth route integration", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-auth-routes-"));
    vi.resetModules();
    vi.clearAllMocks();
    process.chdir(tempDir);
    await bootstrapTempWorkspace(tempDir);
  });

  afterEach(async () => {
    sqlite?.close();
    sqlite = null;
    process.chdir(originalCwd);
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createAuthApp() {
    const express = (await import("express")).default;
    const { db, sqlite: importedSqlite } = await import("../../server/db");
    const { users } = await import("../../shared/schema");
    const { registerAuthRoutes } = await import("../../server/authRoutes");
    const { generateToken } = await import("../../server/auth");

    sqlite = importedSqlite;

    const app = express();
    app.use(express.json());
    registerAuthRoutes(app);

    const now = new Date("2026-03-01T00:00:00.000Z");
    await db.insert(users).values({
      id: "user-1",
      email: "researcher@example.com",
      username: "researcher@example.com",
      password: "",
      tier: "pro",
      tokensUsed: 1250,
      tokenLimit: 5000,
      storageUsed: 2048,
      storageLimit: 8192,
      emailVerified: true,
      billingCycleStart: now,
      createdAt: now,
      updatedAt: now,
    } as any);

    return {
      db,
      token: generateToken({
        id: "user-1",
        email: "researcher@example.com",
        tier: "pro",
      }),
      server: await startHttpServer(app),
    };
  }

  it("rejects unauthenticated requests", async () => {
    const { server } = await createAuthApp();

    try {
      const response = await requestJson(server.baseUrl, "/api/auth/me");

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: "Authentication required" });
    } finally {
      await server.close();
    }
  });

  it("returns profile and usage for a valid JWT", async () => {
    const { token, server } = await createAuthApp();

    try {
      const profile = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/auth/me", {
        headers: { authorization: `Bearer ${token}` },
      });
      const usage = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/auth/usage", {
        headers: { authorization: `Bearer ${token}` },
      });

      expect(profile.status).toBe(200);
      expect(profile.body).toMatchObject({
        id: "user-1",
        email: "researcher@example.com",
        tier: "pro",
        tokensUsed: 1250,
        tokenLimit: 5000,
      });
      expect(profile.body).not.toHaveProperty("password");

      expect(usage.status).toBe(200);
      expect(usage.body).toMatchObject({
        tokensUsed: 1250,
        tokenLimit: 5000,
        tokenPercent: 25,
        storageUsed: 2048,
        storageLimit: 8192,
        storagePercent: 25,
        tier: "pro",
      });
      expect(typeof usage.body?.billingCycleStart).toBe("string");
    } finally {
      await server.close();
    }
  });

  it("accepts valid API keys and rejects invalid ones", async () => {
    const { db, server } = await createAuthApp();
    const { apiKeys } = await import("../../shared/schema");
    const rawApiKey = "sk_sm_test_valid_api_key";
    const now = Math.floor(Date.now() / 1000);

    await db.insert(apiKeys).values({
      id: "key-1",
      userId: "user-1",
      label: "Integration key",
      keyHash: createHash("sha256").update(rawApiKey).digest("hex"),
      keyPrefix: rawApiKey.slice(0, 12),
      createdAt: now,
    } as any);

    try {
      const validApiKeyProfile = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/auth/me", {
        headers: { authorization: `Bearer ${rawApiKey}` },
      });

      expect(validApiKeyProfile.status).toBe(200);
      expect(validApiKeyProfile.body).toMatchObject({
        id: "user-1",
        email: "researcher@example.com",
      });

      const invalidApiKeyProfile = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/auth/me", {
        headers: { authorization: "Bearer sk_sm_invalid_api_key" },
      });

      expect(invalidApiKeyProfile.status).toBe(401);
      expect(invalidApiKeyProfile.body).toEqual({ message: "Invalid API key" });
    } finally {
      await server.close();
    }
  });
});
