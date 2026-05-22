import express from "express";
import { createServer } from "http";
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
const { initializeOcrQueue } = vi.hoisted(() => ({
  initializeOcrQueue: vi.fn(async () => undefined),
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

vi.mock("../../server/ocrQueue", async () => {
  const actual = await vi.importActual<typeof import("../../server/ocrQueue")>("../../server/ocrQueue");
  return {
    ...actual,
    initializeOcrQueue,
  };
});

interface SystemStatusResponse {
  counts: {
    projects: number;
    documents: number;
    annotations: number;
  };
  documentsByStatus: {
    ready: number;
    processing: number;
    error: number;
    other: number;
  };
}

describe("system status dashboard counts", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-system-status-"));
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

  async function createSystemStatusApp() {
    const { db, sqlite: importedSqlite } = await import("../../server/db");
    const {
      annotations,
      documents,
      projectAnnotations,
      projectDocuments,
      projects,
      users,
    } = await import("../../shared/schema");
    const { registerRoutes } = await import("../../server/routes");
    const { generateToken } = await import("../../server/auth");

    sqlite = importedSqlite;

    const now = new Date("2026-05-22T12:00:00.000Z");
    await db.insert(users).values([
      {
        id: "status-user",
        email: "status@example.com",
        username: "status@example.com",
        password: "",
        tier: "pro",
        tokensUsed: 0,
        tokenLimit: 500_000,
        storageUsed: 0,
        storageLimit: 524_288_000,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "other-user",
        email: "other@example.com",
        username: "other@example.com",
        password: "",
        tier: "pro",
        tokensUsed: 0,
        tokenLimit: 500_000,
        storageUsed: 0,
        storageLimit: 524_288_000,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "empty-user",
        email: "empty@example.com",
        username: "empty@example.com",
        password: "",
        tier: "free",
        tokensUsed: 0,
        tokenLimit: 50_000,
        storageUsed: 0,
        storageLimit: 52_428_800,
        createdAt: now,
        updatedAt: now,
      },
    ] as any);

    await db.insert(projects).values([
      { id: "status-project", userId: "status-user", name: "Status Project", createdAt: now, updatedAt: now },
      { id: "other-project", userId: "other-user", name: "Other Project", createdAt: now, updatedAt: now },
      { id: "legacy-project", userId: null, name: "Legacy Orphan Project", createdAt: now, updatedAt: now },
    ] as any);

    await db.insert(documents).values([
      {
        id: "status-document",
        userId: "status-user",
        filename: "status.txt",
        fullText: "owned by the status user",
        uploadDate: now,
        chunkCount: 0,
        status: "ready",
      },
      {
        id: "other-document",
        userId: "other-user",
        filename: "other.txt",
        fullText: "owned by another user",
        uploadDate: now,
        chunkCount: 0,
        status: "ready",
      },
      {
        id: "legacy-linked-document",
        userId: null,
        filename: "legacy-linked.txt",
        fullText: "legacy document linked to the status user project",
        uploadDate: now,
        chunkCount: 0,
        status: "processing",
      },
      {
        id: "orphan-document",
        userId: null,
        filename: "orphan.txt",
        fullText: "legacy document with no owner",
        uploadDate: now,
        chunkCount: 0,
        status: "error",
      },
    ] as any);

    await db.insert(projectDocuments).values([
      { id: "status-project-document", projectId: "status-project", documentId: "status-document", addedAt: now },
      { id: "status-legacy-project-document", projectId: "status-project", documentId: "legacy-linked-document", addedAt: now },
      { id: "other-project-document", projectId: "other-project", documentId: "other-document", addedAt: now },
    ] as any);

    await db.insert(annotations).values([
      {
        id: "status-annotation",
        documentId: "status-document",
        startPosition: 0,
        endPosition: 5,
        highlightedText: "owned",
        category: "argument",
        note: "status user legacy annotation",
        createdAt: now,
      },
      {
        id: "other-annotation",
        documentId: "other-document",
        startPosition: 0,
        endPosition: 5,
        highlightedText: "other",
        category: "argument",
        note: "other user annotation",
        createdAt: now,
      },
      {
        id: "legacy-linked-annotation",
        documentId: "legacy-linked-document",
        startPosition: 0,
        endPosition: 6,
        highlightedText: "legacy",
        category: "evidence",
        note: "legacy annotation linked through project ownership",
        createdAt: now,
      },
      {
        id: "orphan-annotation",
        documentId: "orphan-document",
        startPosition: 0,
        endPosition: 6,
        highlightedText: "orphan",
        category: "evidence",
        note: "ownerless annotation",
        createdAt: now,
      },
    ] as any);

    await db.insert(projectAnnotations).values([
      {
        id: "status-project-annotation",
        projectDocumentId: "status-project-document",
        startPosition: 0,
        endPosition: 5,
        highlightedText: "owned",
        category: "argument",
        note: "status project annotation",
        createdAt: now,
      },
      {
        id: "status-legacy-project-annotation",
        projectDocumentId: "status-legacy-project-document",
        startPosition: 0,
        endPosition: 6,
        highlightedText: "legacy",
        category: "evidence",
        note: "legacy project annotation",
        createdAt: now,
      },
      {
        id: "other-project-annotation",
        projectDocumentId: "other-project-document",
        startPosition: 0,
        endPosition: 5,
        highlightedText: "other",
        category: "argument",
        note: "other project annotation",
        createdAt: now,
      },
    ] as any);

    const app = express();
    await registerRoutes(createServer(app), app);

    return {
      server: await startHttpServer(app),
      statusToken: generateToken({ id: "status-user", email: "status@example.com", tier: "pro" }),
      otherToken: generateToken({ id: "other-user", email: "other@example.com", tier: "pro" }),
      emptyToken: generateToken({ id: "empty-user", email: "empty@example.com", tier: "free" }),
    };
  }

  it("returns dashboard counts scoped to the authenticated account", async () => {
    const { server, statusToken, otherToken, emptyToken } = await createSystemStatusApp();

    try {
      const statusUser = await requestJson<SystemStatusResponse>(server.baseUrl, "/api/system/status", {
        headers: { authorization: `Bearer ${statusToken}` },
      });
      const otherUser = await requestJson<SystemStatusResponse>(server.baseUrl, "/api/system/status", {
        headers: { authorization: `Bearer ${otherToken}` },
      });
      const emptyUser = await requestJson<SystemStatusResponse>(server.baseUrl, "/api/system/status", {
        headers: { authorization: `Bearer ${emptyToken}` },
      });

      expect(statusUser.status).toBe(200);
      expect(statusUser.body?.counts).toEqual({
        projects: 1,
        documents: 2,
        annotations: 4,
      });
      expect(statusUser.body?.documentsByStatus).toMatchObject({
        ready: 1,
        processing: 1,
        error: 0,
      });

      expect(otherUser.status).toBe(200);
      expect(otherUser.body?.counts).toEqual({
        projects: 1,
        documents: 1,
        annotations: 2,
      });

      expect(emptyUser.status).toBe(200);
      expect(emptyUser.body?.counts).toEqual({
        projects: 0,
        documents: 0,
        annotations: 0,
      });
      expect(emptyUser.body?.documentsByStatus).toEqual({
        ready: 0,
        processing: 0,
        error: 0,
        other: 0,
      });
    } finally {
      await server.close();
    }
  });
});
