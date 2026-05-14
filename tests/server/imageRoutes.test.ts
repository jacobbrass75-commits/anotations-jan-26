import express from "express";
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

describe("image generation route", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();
  const originalKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-image-routes-"));
    vi.resetModules();
    vi.clearAllMocks();
    process.chdir(tempDir);
    await bootstrapTempWorkspace(tempDir);
  });

  afterEach(async () => {
    sqlite?.close();
    sqlite = null;
    if (originalKey === undefined) {
      delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    } else {
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY = originalKey;
    }
    process.chdir(originalCwd);
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createImageApp(tier?: "free" | "pro" | "max") {
    const { db, sqlite: importedSqlite } = await import("../../server/db");
    const { users } = await import("../../shared/schema");
    const { registerImageRoutes } = await import("../../server/replit_integrations/image/routes");
    const { generateToken } = await import("../../server/auth");

    sqlite = importedSqlite;

    const app = express();
    app.use(express.json());
    registerImageRoutes(app);

    if (!tier) {
      return { server: await startHttpServer(app), token: null };
    }

    const now = new Date("2026-05-05T00:00:00.000Z");
    await db.insert(users).values({
      id: `${tier}-user`,
      email: `${tier}@example.com`,
      username: `${tier}@example.com`,
      password: "",
      tier,
      tokensUsed: 0,
      tokenLimit: 50000,
      storageUsed: 0,
      storageLimit: 52428800,
      createdAt: now,
      updatedAt: now,
    } as any);

    return {
      server: await startHttpServer(app),
      token: generateToken({ id: `${tier}-user`, email: `${tier}@example.com`, tier }),
    };
  }

  it("requires authentication before image generation work", async () => {
    const { server } = await createImageApp();

    try {
      const response = await requestJson(server.baseUrl, "/api/generate-image", {
        method: "POST",
        body: { prompt: "A manuscript desk" },
      });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: "Authentication required" });
    } finally {
      await server.close();
    }
  });

  it("requires a paid tier before provider configuration or generation", async () => {
    const { server, token } = await createImageApp("free");

    try {
      const response = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/generate-image", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: { prompt: "A manuscript desk" },
      });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        message: "This feature requires the pro plan",
        requiredTier: "pro",
        currentTier: "free",
      });
    } finally {
      await server.close();
    }
  });
});
