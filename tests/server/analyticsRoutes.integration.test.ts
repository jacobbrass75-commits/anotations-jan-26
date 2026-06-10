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

describe("analytics admin route hardening", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();
  const originalAdminUserIds = process.env.ADMIN_USER_IDS;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-analytics-routes-"));
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.ADMIN_USER_IDS;
    process.chdir(tempDir);
    await bootstrapTempWorkspace(tempDir);
  });

  afterEach(async () => {
    sqlite?.close();
    sqlite = null;
    if (originalAdminUserIds === undefined) {
      delete process.env.ADMIN_USER_IDS;
    } else {
      process.env.ADMIN_USER_IDS = originalAdminUserIds;
    }
    process.chdir(originalCwd);
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createAnalyticsApp() {
    const { db, sqlite: importedSqlite } = await import("../../server/db");
    const { users } = await import("../../shared/schema");
    const { registerAnalyticsRoutes } = await import("../../server/analyticsRoutes");
    const { generateToken } = await import("../../server/auth");

    sqlite = importedSqlite;

    const now = new Date("2026-05-05T00:00:00.000Z");
    await db.insert(users).values({
      id: "max-user",
      email: "max@example.com",
      username: "max@example.com",
      password: "",
      tier: "max",
      createdAt: now,
      updatedAt: now,
    } as any);

    const app = express();
    app.use(express.json());
    registerAnalyticsRoutes(app);

    return {
      server: await startHttpServer(app),
      token: generateToken({ id: "max-user", email: "max@example.com", tier: "max" }),
    };
  }

  it("denies max-tier users unless ADMIN_USER_IDS explicitly includes them", async () => {
    const { server, token } = await createAnalyticsApp();

    try {
      const response = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/admin/analytics/export",
        {
          headers: { authorization: `Bearer ${token}` },
        },
      );

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        message: "Admin access requires ADMIN_USER_IDS to be configured",
      });
    } finally {
      await server.close();
    }
  });
});
