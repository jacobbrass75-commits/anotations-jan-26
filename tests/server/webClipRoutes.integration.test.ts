import express from "express";
import { eq } from "drizzle-orm";
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

interface TestApp {
  db: Awaited<typeof import("../../server/db")>["db"];
  server: Awaited<ReturnType<typeof startHttpServer>>;
  userOneToken: string;
  userTwoToken: string;
  freeUserToken: string;
}

describe("web clip route integration", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-web-clips-"));
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

  async function createApp(): Promise<TestApp> {
    const { db, sqlite: importedSqlite } = await import("../../server/db");
    const { users, projects } = await import("../../shared/schema");
    const { registerAuthRoutes } = await import("../../server/authRoutes");
    const { registerWebClipRoutes } = await import("../../server/webClipRoutes");
    const { generateToken } = await import("../../server/auth");

    sqlite = importedSqlite;

    const app = express();
    app.use(express.json());
    registerAuthRoutes(app);
    registerWebClipRoutes(app);

    const now = new Date("2026-05-05T00:00:00.000Z");
    await db.insert(users).values([
      {
        id: "user-1",
        email: "one@example.com",
        username: "one@example.com",
        password: "",
        tier: "pro",
        createdAt: now,
        updatedAt: now,
      } as any,
      {
        id: "user-2",
        email: "two@example.com",
        username: "two@example.com",
        password: "",
        tier: "pro",
        createdAt: now,
        updatedAt: now,
      } as any,
      {
        id: "user-free",
        email: "free@example.com",
        username: "free@example.com",
        password: "",
        tier: "free",
        createdAt: now,
        updatedAt: now,
      } as any,
    ]);

    await db.insert(projects).values([
      {
        id: "project-1",
        userId: "user-1",
        name: "User One Project",
        createdAt: now,
        updatedAt: now,
      } as any,
      {
        id: "project-2",
        userId: "user-2",
        name: "User Two Project",
        createdAt: now,
        updatedAt: now,
      } as any,
      {
        id: "project-free",
        userId: "user-free",
        name: "Free User Project",
        createdAt: now,
        updatedAt: now,
      } as any,
    ]);

    return {
      db,
      server: await startHttpServer(app),
      userOneToken: generateToken({ id: "user-1", email: "one@example.com", tier: "pro" }),
      userTwoToken: generateToken({ id: "user-2", email: "two@example.com", tier: "pro" }),
      freeUserToken: generateToken({ id: "user-free", email: "free@example.com", tier: "free" }),
    };
  }

  function clipPayload(overrides: Record<string, unknown> = {}) {
    return {
      highlightedText: "A useful quote from the page.",
      sourceUrl: "https://example.com/article#section",
      pageTitle: "Example Article",
      siteName: "Example",
      authorName: "Ada Lovelace",
      publishDate: "2026-01-15T12:00:00Z",
      category: "key_quote",
      ...overrides,
    };
  }

  async function createApiKey(server: TestApp["server"], token: string) {
    const response = await requestJson<{ id: string; key: string }>(server.baseUrl, "/api/auth/api-keys", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: { label: "Chrome Extension" },
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: expect.any(String),
      key: expect.stringMatching(/^sk_sm_/),
    });
    return response.body!;
  }

  it("creates an API key, creates a web clip, and lists only the authenticated user's clips", async () => {
    const { server, userOneToken, userTwoToken } = await createApp();

    try {
      const userOneKey = await createApiKey(server, userOneToken);
      const userTwoKey = await createApiKey(server, userTwoToken);

      const created = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/web-clips", {
        method: "POST",
        headers: { authorization: `Bearer ${userOneKey.key}` },
        body: clipPayload({ projectId: "project-1", tags: ["research", "quote"] }),
      });

      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        id: expect.any(String),
        userId: "user-1",
        projectId: "project-1",
        sourceUrl: "https://example.com/article",
        pageTitle: "Example Article",
        tags: ["research", "quote"],
        category: "key_quote",
        citationData: expect.objectContaining({
          sourceType: "website",
          title: "Example Article",
          url: "https://example.com/article",
          containerTitle: "Example",
          publicationDate: "2026-01-15",
        }),
        footnote: expect.any(String),
        bibliography: expect.any(String),
      });

      const userTwoClip = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/web-clips", {
        method: "POST",
        headers: { authorization: `Bearer ${userTwoKey.key}` },
        body: clipPayload({
          highlightedText: "A second user's quote.",
          sourceUrl: "https://example.net/other",
          projectId: "project-2",
        }),
      });
      expect(userTwoClip.status).toBe(201);

      const list = await requestJson<Array<Record<string, unknown>>>(
        server.baseUrl,
        "/api/web-clips?projectId=project-1",
        {
          headers: { authorization: `Bearer ${userOneKey.key}` },
        },
      );
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);
      expect(list.body?.[0]).toMatchObject({ id: created.body?.id, userId: "user-1" });

      const byUrl = await requestJson<Array<Record<string, unknown>>>(
        server.baseUrl,
        "/api/web-clips/by-url?sourceUrl=https%3A%2F%2Fexample.com%2Farticle%23section",
        {
          headers: { authorization: `Bearer ${userOneKey.key}` },
        },
      );
      expect(byUrl.status).toBe(200);
      expect(byUrl.body).toHaveLength(1);
      expect(byUrl.body?.[0]).toMatchObject({ id: created.body?.id });
    } finally {
      await server.close();
    }
  });

  it("resolves project ownership from a project document target", async () => {
    const { db, server, userOneToken } = await createApp();

    try {
      const { documents, projectDocuments } = await import("../../shared/schema");
      const [document] = await db
        .insert(documents)
        .values({
          id: "doc-1",
          userId: "user-1",
          filename: "Project Source.txt",
          fullText: "A useful quote from the page. More source text.",
        } as any)
        .returning();
      const [projectDocument] = await db
        .insert(projectDocuments)
        .values({
          id: "project-doc-1",
          projectId: "project-1",
          documentId: document.id,
        } as any)
        .returning();

      const created = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/web-clips", {
        method: "POST",
        headers: { authorization: `Bearer ${userOneToken}` },
        body: clipPayload({ projectDocumentId: projectDocument.id }),
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        projectId: "project-1",
        projectDocumentId: projectDocument.id,
      });

      const listed = await requestJson<Array<Record<string, unknown>>>(
        server.baseUrl,
        "/api/web-clips?projectId=project-1",
        {
          headers: { authorization: `Bearer ${userOneToken}` },
        },
      );
      expect(listed.status).toBe(200);
      expect(listed.body?.map((clip) => clip.id)).toContain(created.body?.id);

      const unattached = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/web-clips", {
        method: "POST",
        headers: { authorization: `Bearer ${userOneToken}` },
        body: clipPayload({
          highlightedText: "A second useful quote.",
          sourceUrl: "https://example.com/second",
        }),
      });
      expect(unattached.status).toBe(201);

      const updated = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        `/api/web-clips/${unattached.body?.id}`,
        {
          method: "PUT",
          headers: { authorization: `Bearer ${userOneToken}` },
          body: { projectDocumentId: projectDocument.id },
        },
      );
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({
        projectId: "project-1",
        projectDocumentId: projectDocument.id,
      });

      const promoted = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        `/api/web-clips/${unattached.body?.id}/promote`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${userOneToken}` },
          body: {},
        },
      );
      expect(promoted.status).toBe(201);
      expect(promoted.body).toMatchObject({
        annotation: expect.objectContaining({
          highlightedText: "A second useful quote.",
        }),
        projectDocumentId: projectDocument.id,
      });
    } finally {
      await server.close();
    }
  });

  it("prevents cross-user get, update, delete, promote, and project assignment", async () => {
    const { server, userOneToken, userTwoToken } = await createApp();

    try {
      const crossProjectCreate = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/web-clips", {
        method: "POST",
        headers: { authorization: `Bearer ${userOneToken}` },
        body: clipPayload({ projectId: "project-2" }),
      });
      expect(crossProjectCreate.status).toBe(404);
      expect(crossProjectCreate.body).toEqual({ error: "Project not found" });

      const created = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/web-clips", {
        method: "POST",
        headers: { authorization: `Bearer ${userOneToken}` },
        body: clipPayload({ projectId: "project-1" }),
      });
      expect(created.status).toBe(201);

      const clipId = String(created.body?.id);
      const crossRead = await requestJson(server.baseUrl, `/api/web-clips/${clipId}`, {
        headers: { authorization: `Bearer ${userTwoToken}` },
      });
      const crossUpdate = await requestJson(server.baseUrl, `/api/web-clips/${clipId}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${userTwoToken}` },
        body: { note: "stolen" },
      });
      const crossDelete = await requestJson(server.baseUrl, `/api/web-clips/${clipId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${userTwoToken}` },
      });
      const crossPromote = await requestJson(server.baseUrl, `/api/web-clips/${clipId}/promote`, {
        method: "POST",
        headers: { authorization: `Bearer ${userTwoToken}` },
        body: { projectId: "project-2" },
      });

      expect(crossRead.status).toBe(404);
      expect(crossUpdate.status).toBe(404);
      expect(crossDelete.status).toBe(404);
      expect(crossPromote.status).toBe(404);

      const ownerRead = await requestJson<Record<string, unknown>>(server.baseUrl, `/api/web-clips/${clipId}`, {
        headers: { authorization: `Bearer ${userOneToken}` },
      });
      expect(ownerRead.status).toBe(200);
      expect(ownerRead.body).toMatchObject({ id: clipId, userId: "user-1", note: null });
    } finally {
      await server.close();
    }
  });

  it("promotes web clips into user-owned project documents", async () => {
    const { db, server, userOneToken } = await createApp();

    try {
      const created = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/web-clips", {
        method: "POST",
        headers: { authorization: `Bearer ${userOneToken}` },
        body: clipPayload(),
      });
      expect(created.status).toBe(201);

      const promoted = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        `/api/web-clips/${created.body?.id}/promote`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${userOneToken}` },
          body: { projectId: "project-1" },
        },
      );

      expect(promoted.status).toBe(201);
      expect(promoted.body).toMatchObject({
        annotation: expect.objectContaining({
          highlightedText: "A useful quote from the page.",
        }),
        projectDocumentId: expect.any(String),
      });

      const { documents, projectDocuments } = await import("../../shared/schema");
      const [promotedDocument] = await db
        .select({
          documentUserId: documents.userId,
          projectId: projectDocuments.projectId,
        })
        .from(projectDocuments)
        .innerJoin(documents, eq(projectDocuments.documentId, documents.id))
        .where(eq(projectDocuments.id, String(promoted.body?.projectDocumentId)));

      expect(promotedDocument).toEqual({
        documentUserId: "user-1",
        projectId: "project-1",
      });
    } finally {
      await server.close();
    }
  });

  it("rejects invalid and revoked API keys before creating clips", async () => {
    const { db, server, userOneToken } = await createApp();
    const { webClips } = await import("../../shared/schema");

    try {
      const invalidKeyResponse = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/web-clips", {
        method: "POST",
        headers: { authorization: "Bearer sk_sm_invalid_api_key" },
        body: clipPayload({ projectId: "project-1" }),
      });
      expect(invalidKeyResponse.status).toBe(401);
      expect(invalidKeyResponse.body).toEqual({ message: "Invalid API key" });

      const apiKey = await createApiKey(server, userOneToken);
      const revoke = await requestJson(server.baseUrl, `/api/auth/api-keys/${apiKey.id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${userOneToken}` },
      });
      expect(revoke.status).toBe(204);

      const revokedKeyResponse = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/web-clips", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey.key}` },
        body: clipPayload({ projectId: "project-1" }),
      });
      expect(revokedKeyResponse.status).toBe(401);
      expect(revokedKeyResponse.body).toEqual({ message: "Invalid API key" });

      expect(await db.select().from(webClips)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("requires a Pro tier or higher to create web clips", async () => {
    const { db, server, freeUserToken } = await createApp();
    const { webClips } = await import("../../shared/schema");

    try {
      const freeKey = await createApiKey(server, freeUserToken);
      const response = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/web-clips", {
        method: "POST",
        headers: { authorization: `Bearer ${freeKey.key}` },
        body: clipPayload({ projectId: "project-free" }),
      });

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
});
