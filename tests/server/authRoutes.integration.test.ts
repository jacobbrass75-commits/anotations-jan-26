import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("creates, lists, authenticates, and revokes API keys", async () => {
    const { token, server } = await createAuthApp();

    try {
      const createResponse = await requestJson<{
        id: string;
        key: string;
        prefix: string;
        label: string;
        createdAt: number;
      }>(server.baseUrl, "/api/auth/api-keys", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: { label: "Integration Test Key" },
      });

      expect(createResponse.status).toBe(201);
      expect(createResponse.body?.key.startsWith("sk_sm_")).toBe(true);
      expect(createResponse.body?.prefix).toMatch(/^sk_sm_/);
      expect(createResponse.body?.label).toBe("Integration Test Key");

      const listResponse = await requestJson<{ keys: Array<Record<string, unknown>> }>(
        server.baseUrl,
        "/api/auth/api-keys",
        {
          headers: { authorization: `Bearer ${token}` },
        }
      );

      expect(listResponse.status).toBe(200);
      expect(listResponse.body?.keys).toHaveLength(1);
      expect(listResponse.body?.keys[0]).toMatchObject({
        id: createResponse.body?.id,
        prefix: createResponse.body?.prefix,
        label: "Integration Test Key",
      });
      expect(listResponse.text).not.toContain(createResponse.body?.key ?? "");

      const apiKeyProfile = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/auth/me", {
        headers: { authorization: `Bearer ${createResponse.body?.key}` },
      });

      expect(apiKeyProfile.status).toBe(200);
      expect(apiKeyProfile.body).toMatchObject({
        id: "user-1",
        email: "researcher@example.com",
      });

      const revokeResponse = await requestJson<{ success: boolean; revokedAt: number }>(
        server.baseUrl,
        `/api/auth/api-keys/${createResponse.body?.id}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}` },
        }
      );

      expect(revokeResponse.status).toBe(200);
      expect(revokeResponse.body?.success).toBe(true);

      const revokedKeyAttempt = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/auth/me", {
        headers: { authorization: `Bearer ${createResponse.body?.key}` },
      });

      expect(revokedKeyAttempt.status).toBe(401);
      expect(revokedKeyAttempt.body).toEqual({ message: "Invalid API key" });
    } finally {
      await server.close();
    }
  });
});
