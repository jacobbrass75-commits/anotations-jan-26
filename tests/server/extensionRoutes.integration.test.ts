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

describe("extension route integration", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-extension-routes-"));
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

  async function createExtensionApp(tier: "free" | "pro" | "max") {
    const express = (await import("express")).default;
    const { db, sqlite: importedSqlite } = await import("../../server/db");
    const { users, webClips } = await import("../../shared/schema");
    const { registerExtensionRoutes } = await import("../../server/extensionRoutes");
    const { generateToken } = await import("../../server/auth");

    sqlite = importedSqlite;

    const app = express();
    app.use(express.json());
    registerExtensionRoutes(app);

    const now = new Date("2026-03-01T00:00:00.000Z");
    await db.insert(users).values({
      id: "user-1",
      email: "clipper@example.com",
      username: "clipper@example.com",
      password: "",
      tier,
      tokensUsed: 0,
      tokenLimit: 50000,
      storageUsed: 0,
      storageLimit: 52428800,
      emailVerified: true,
      billingCycleStart: now,
      createdAt: now,
      updatedAt: now,
    } as any);

    return {
      db,
      webClips,
      token: generateToken({
        id: "user-1",
        email: "clipper@example.com",
        tier,
      }),
      server: await startHttpServer(app),
    };
  }

  it("rejects free-tier users before writing clip data", async () => {
    const { token, db, webClips, server } = await createExtensionApp("free");

    try {
      const response = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/extension/save", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: {
          highlightedText: "Important quote",
          pageUrl: "https://example.com/article#fragment",
          pageTitle: "Example Article",
        },
      });

      const savedClips = await db.select().from(webClips);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        message: "This feature requires the pro plan",
        requiredTier: "pro",
        currentTier: "free",
      });
      expect(savedClips).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("validates the extension payload", async () => {
    const { token, server } = await createExtensionApp("pro");

    try {
      const response = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/extension/save", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: {
          highlightedText: "",
          pageUrl: "not-a-url",
        },
      });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        message: "Invalid extension payload",
      });
    } finally {
      await server.close();
    }
  });

  it("persists a normalized web clip for pro users", async () => {
    const { token, db, webClips, server } = await createExtensionApp("pro");

    try {
      const response = await requestJson<{
        success: boolean;
        clip: Record<string, unknown>;
      }>(server.baseUrl, "/api/extension/save", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: {
          highlightedText: "Important quote",
          pageUrl: "https://example.com/article#fragment",
          pageTitle: "Example Article",
          context: "Why this quote matters",
        },
      });

      expect(response.status).toBe(201);
      expect(response.body?.success).toBe(true);
      expect(response.body?.clip).toMatchObject({
        userId: "user-1",
        highlightedText: "Important quote",
        note: "Why this quote matters",
        category: "web_clip",
        sourceUrl: "https://example.com/article",
        pageTitle: "Example Article",
        surroundingContext: "Why this quote matters",
        projectId: null,
      });
      expect(response.body?.clip.footnote).toEqual(expect.any(String));
      expect(response.body?.clip.bibliography).toEqual(expect.any(String));

      const savedClips = await db.select().from(webClips);
      expect(savedClips).toHaveLength(1);
      expect(savedClips[0]).toMatchObject({
        userId: "user-1",
        sourceUrl: "https://example.com/article",
        pageTitle: "Example Article",
      });
      expect(savedClips[0].footnote).toContain("Example Article");
      expect(savedClips[0].bibliography).toContain("Example Article");
    } finally {
      await server.close();
    }
  });
});
