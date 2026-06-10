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

describe("extension web clip integration", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-extension-routes-"));
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

  async function createExtensionApp(tier: "free" | "pro" | "max") {
    const express = (await import("express")).default;
    const { db, sqlite: importedSqlite } = await import("../../server/db");
    const { users, projects, webClips } = await import("../../shared/schema");
    const { registerWebClipRoutes } = await import("../../server/webClipRoutes");
    const { generateToken } = await import("../../server/auth");

    sqlite = importedSqlite;

    const app = express();
    app.use(express.json());
    registerWebClipRoutes(app);

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

    await db.insert(projects).values({
      id: "project-1",
      userId: "user-1",
      name: "Extension Clips",
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

  function extensionClipPayload(overrides: Record<string, unknown> = {}) {
    return {
      highlightedText: "Important quote",
      sourceUrl: "https://example.com/article#fragment",
      pageTitle: "Example Article",
      surroundingContext: "Why this quote matters",
      projectId: "project-1",
      category: "key_quote",
      ...overrides,
    };
  }

  it("rejects free-tier extension saves before writing clip data", async () => {
    const { token, db, webClips, server } = await createExtensionApp("free");

    try {
      const response = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/web-clips",
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: extensionClipPayload(),
        },
      );

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        message: "This feature requires the pro plan",
        requiredTier: "pro",
        currentTier: "free",
      });
      expect(await db.select().from(webClips)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("validates the real extension web clip payload", async () => {
    const { token, server } = await createExtensionApp("pro");

    try {
      const response = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/web-clips",
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: extensionClipPayload({
            highlightedText: "",
            sourceUrl: "not-a-url",
            pageTitle: "",
          }),
        },
      );

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: "Invalid web clip payload" });
    } finally {
      await server.close();
    }
  });

  it("persists a normalized web clip through the endpoint used by the extension", async () => {
    const { token, db, webClips, server } = await createExtensionApp("pro");

    try {
      const response = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/web-clips",
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: extensionClipPayload(),
        },
      );

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        id: expect.any(String),
        highlightedText: "Important quote",
        sourceUrl: "https://example.com/article",
        pageTitle: "Example Article",
        surroundingContext: "Why this quote matters",
        category: "key_quote",
        projectId: "project-1",
        userId: "user-1",
        footnote: expect.any(String),
        bibliography: expect.any(String),
      });

      const savedClips = await db.select().from(webClips);
      expect(savedClips).toHaveLength(1);
      expect(savedClips[0]).toMatchObject({
        id: response.body?.id,
        sourceUrl: "https://example.com/article",
        userId: "user-1",
      });
    } finally {
      await server.close();
    }
  });
});
