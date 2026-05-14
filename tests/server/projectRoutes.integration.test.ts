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
const {
  getEmbeddingWithUsage,
  processChunksWithPipelineV2,
  processChunksWithMultiplePrompts,
  clearDocumentContextCacheV2,
  extractCitationMetadata,
  searchDocument,
} = vi.hoisted(() => ({
  getEmbeddingWithUsage: vi.fn(async (_text: string, onTokenUsage?: (tokens: number) => void) => {
    onTokenUsage?.(7);
    return [1, 0, 0];
  }),
  processChunksWithPipelineV2: vi.fn(
    async (
      _chunks: unknown,
      _intent: string,
      _documentId: string,
      _fullText: string,
      _existingAnnotations: unknown,
      options?: { onTokenUsage?: (tokens: number) => void },
    ) => {
      options?.onTokenUsage?.(13);
      return [
        {
          absoluteStart: 0,
          absoluteEnd: 12,
          highlightText: "Research text",
          category: "key_quote",
          note: "Useful for the research intent.",
          confidence: 0.88,
        },
      ];
    },
  ),
  processChunksWithMultiplePrompts: vi.fn(async () => new Map()),
  clearDocumentContextCacheV2: vi.fn(),
  extractCitationMetadata: vi.fn(),
  searchDocument: vi.fn(),
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

vi.mock("../../server/openai", () => ({
  getEmbeddingWithUsage,
  getEmbedding: (text: string) => getEmbeddingWithUsage(text),
  cosineSimilarity: () => 1,
  extractCitationMetadata,
  searchDocument,
  getMaxChunksForLevel: () => 1,
  PIPELINE_CONFIG: {
    CHUNKS_QUICK: 1,
    CHUNKS_STANDARD: 1,
    CHUNKS_THOROUGH: 1,
    CHUNKS_EXHAUSTIVE: 1,
  },
}));

vi.mock("../../server/pipelineV2", () => ({
  processChunksWithPipelineV2,
  processChunksWithMultiplePrompts,
  clearDocumentContextCacheV2,
  PIPELINE_V2_CONFIG: {
    LLM_CONCURRENCY: 1,
  },
}));

describe("project route integration", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-project-routes-"));
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

  async function createApp(options: { tokensUsed?: number; tokenLimit?: number } = {}) {
    const { db, sqlite: importedSqlite } = await import("../../server/db");
    const { users } = await import("../../shared/schema");
    const { registerProjectRoutes } = await import("../../server/projectRoutes");
    const { generateToken } = await import("../../server/auth");

    sqlite = importedSqlite;

    const now = new Date("2026-05-05T00:00:00.000Z");
    await db.insert(users).values({
      id: "quota-user",
      email: "quota@example.com",
      username: "quota@example.com",
      password: "",
      tier: "pro",
      tokensUsed: options.tokensUsed ?? 100,
      tokenLimit: options.tokenLimit ?? 100,
      storageUsed: 0,
      storageLimit: 524288000,
      createdAt: now,
      updatedAt: now,
    } as any);

    const app = express();
    app.use(express.json());
    registerProjectRoutes(app);

    return {
      db,
      server: await startHttpServer(app),
      token: generateToken({ id: "quota-user", email: "quota@example.com", tier: "pro" }),
    };
  }

  it("allows token-free project creation even when the token budget is exhausted", async () => {
    const { server, token } = await createApp();

    try {
      const bareProject = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/projects", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: { name: "Bare Project" },
      });

      expect(bareProject.status).toBe(201);
      expect(bareProject.body).toMatchObject({
        userId: "quota-user",
        name: "Bare Project",
      });

      const contextProject = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/projects", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: {
          name: "Context Project",
          thesis: "AI-generated context should consume token budget",
          scope: "Budgeted context generation",
        },
      });

      expect(contextProject.status).toBe(201);
      expect(contextProject.body).toMatchObject({
        userId: "quota-user",
        name: "Context Project",
        thesis: "AI-generated context should consume token budget",
        scope: "Budgeted context generation",
      });

      const renamedProject = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        `/api/projects/${bareProject.body?.id}`,
        {
          method: "PUT",
          headers: { authorization: `Bearer ${token}` },
          body: { name: "Renamed Bare Project" },
        },
      );

      expect(renamedProject.status).toBe(200);
      expect(renamedProject.body).toMatchObject({
        id: bareProject.body?.id,
        name: "Renamed Bare Project",
      });

      const contextUpdate = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        `/api/projects/${bareProject.body?.id}`,
        {
          method: "PUT",
          headers: { authorization: `Bearer ${token}` },
          body: {
            thesis: "Updating context should consume token budget",
            scope: "Budgeted context update",
          },
        },
      );

      expect(contextUpdate.status).toBe(200);
      expect(contextUpdate.body).toMatchObject({
        id: bareProject.body?.id,
        thesis: "Updating context should consume token budget",
        scope: "Budgeted context update",
      });
    } finally {
      await server.close();
    }
  });

  it("allows existing documents to be attached when the token budget is exhausted", async () => {
    const { db, server, token } = await createApp();
    const { documents, projectDocuments } = await import("../../shared/schema");
    const { eq } = await import("drizzle-orm");

    try {
      const project = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/projects", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: { name: "Source Organization" },
      });

      expect(project.status).toBe(201);
      const projectId = String(project.body?.id);

      await db.insert(documents).values([
        {
          id: "doc-one",
          userId: "quota-user",
          filename: "one.txt",
          fullText: "first source text",
          uploadDate: new Date("2026-05-05T00:00:00.000Z"),
          summary: "first summary",
          mainArguments: ["first argument"],
          keyConcepts: ["first concept"],
          chunkCount: 0,
          status: "ready",
        },
        {
          id: "doc-two",
          userId: "quota-user",
          filename: "two.txt",
          fullText: "second source text",
          uploadDate: new Date("2026-05-05T00:00:00.000Z"),
          summary: "second summary",
          mainArguments: ["second argument"],
          keyConcepts: ["second concept"],
          chunkCount: 0,
          status: "ready",
        },
      ] as any);

      const singleAttach = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        `/api/projects/${projectId}/documents`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: { documentId: "doc-one" },
        },
      );

      expect(singleAttach.status).toBe(201);
      expect(singleAttach.body).toMatchObject({
        projectId,
        documentId: "doc-one",
      });

      const batchAttach = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        `/api/projects/${projectId}/documents/batch`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: { documentIds: ["doc-two"] },
        },
      );

      expect(batchAttach.status).toBe(201);
      expect(batchAttach.body).toMatchObject({
        added: 1,
        failed: 0,
      });

      const rows = await db
        .select()
        .from(projectDocuments)
        .where(eq(projectDocuments.projectId, projectId));
      expect(rows.map((row) => row.documentId).sort()).toEqual(["doc-one", "doc-two"]);
      expect(rows.every((row) => row.retrievalContext === null)).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("records token usage for budget-gated project document analysis", async () => {
    const { db, server, token } = await createApp({ tokensUsed: 0, tokenLimit: 10_000 });
    const { documents, projects, projectDocuments, textChunks, users } = await import("../../shared/schema");
    const { eq } = await import("drizzle-orm");

    try {
      const now = new Date("2026-05-05T00:00:00.000Z");
      await db.insert(projects).values({
        id: "analysis-project",
        userId: "quota-user",
        name: "Analysis Project",
        thesis: "Find strong evidence",
        createdAt: now,
        updatedAt: now,
      } as any);
      await db.insert(documents).values({
        id: "analysis-doc",
        userId: "quota-user",
        filename: "analysis.txt",
        fullText: "Research text with enough context for an annotation.",
        uploadDate: now,
        summary: "Research text summary",
        mainArguments: [],
        keyConcepts: [],
        chunkCount: 1,
        status: "ready",
      } as any);
      await db.insert(textChunks).values({
        id: "analysis-chunk",
        documentId: "analysis-doc",
        text: "Research text with enough context for an annotation.",
        startPosition: 0,
        endPosition: 48,
      } as any);
      await db.insert(projectDocuments).values({
        id: "analysis-project-doc",
        projectId: "analysis-project",
        documentId: "analysis-doc",
      } as any);

      const response = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/project-documents/analysis-project-doc/analyze",
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: { intent: "Find strong evidence", thoroughness: "standard" },
        },
      );

      const [user] = await db
        .select({ tokensUsed: users.tokensUsed })
        .from(users)
        .where(eq(users.id, "quota-user"));

      expect(response.status).toBe(200);
      expect(user.tokensUsed).toBeGreaterThan(0);
      expect(getEmbeddingWithUsage).toHaveBeenCalled();
      expect(processChunksWithPipelineV2).toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });
});
