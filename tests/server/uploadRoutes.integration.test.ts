import express, { type NextFunction, type Request, type Response } from "express";
import { createServer, request as httpRequest } from "http";
import multer from "multer";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapTempWorkspace } from "./helpers/bootstrapTempWorkspace";
import { startHttpServer } from "./helpers/http";

const { clerkGetAuth, clerkMiddleware, clerkGetUser } = vi.hoisted(() => ({
  clerkGetAuth: vi.fn(() => ({ userId: null })),
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  clerkGetUser: vi.fn(),
}));
const { enqueuePdfOcrJob, enqueueImageOcrJob, enqueueImageBundleOcrJob, initializeOcrQueue } =
  vi.hoisted(() => ({
    enqueuePdfOcrJob: vi.fn(async () => undefined),
    enqueueImageOcrJob: vi.fn(async () => undefined),
    enqueueImageBundleOcrJob: vi.fn(async () => undefined),
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

vi.mock("../../server/ocrQueue", () => ({
  enqueuePdfOcrJob,
  enqueueImageOcrJob,
  enqueueImageBundleOcrJob,
  initializeOcrQueue,
}));

describe("upload route hardening", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();
  const originalMaxFiles = process.env.MAX_COMBINED_UPLOAD_FILES;
  const originalMaxBytes = process.env.MAX_COMBINED_UPLOAD_TOTAL_BYTES;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-upload-routes-"));
    vi.resetModules();
    vi.clearAllMocks();
    process.env.MAX_COMBINED_UPLOAD_FILES = "1";
    process.env.MAX_COMBINED_UPLOAD_TOTAL_BYTES = "1024";
    process.chdir(tempDir);
    await bootstrapTempWorkspace(tempDir);
  });

  afterEach(async () => {
    sqlite?.close();
    sqlite = null;
    if (originalMaxFiles === undefined) {
      delete process.env.MAX_COMBINED_UPLOAD_FILES;
    } else {
      process.env.MAX_COMBINED_UPLOAD_FILES = originalMaxFiles;
    }
    if (originalMaxBytes === undefined) {
      delete process.env.MAX_COMBINED_UPLOAD_TOTAL_BYTES;
    } else {
      process.env.MAX_COMBINED_UPLOAD_TOTAL_BYTES = originalMaxBytes;
    }
    process.chdir(originalCwd);
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createUploadApp(
    options: {
      tier?: "free" | "pro" | "max";
      existingDocumentCount?: number;
    } = {},
  ) {
    const { db, sqlite: importedSqlite } = await import("../../server/db");
    const { documents, users } = await import("../../shared/schema");
    const { registerRoutes } = await import("../../server/routes");
    const { generateToken } = await import("../../server/auth");

    sqlite = importedSqlite;

    const now = new Date("2026-05-05T00:00:00.000Z");
    const tier = options.tier ?? "pro";
    await db.insert(users).values({
      id: "upload-user",
      email: "upload@example.com",
      username: "upload@example.com",
      password: "",
      tier,
      tokensUsed: 0,
      tokenLimit: 50000,
      storageUsed: 0,
      storageLimit: 52428800,
      createdAt: now,
      updatedAt: now,
    } as any);
    if (options.existingDocumentCount) {
      await db.insert(documents).values(
        Array.from({ length: options.existingDocumentCount }, (_, index) => ({
          id: `existing-doc-${index + 1}`,
          userId: "upload-user",
          filename: `existing-${index + 1}.txt`,
          fullText: "already uploaded text",
          uploadDate: now,
          chunkCount: 0,
          status: "ready",
        })) as any,
      );
    }

    const app = express();
    await registerRoutes(createServer(app), app);
    app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
      if (res.headersSent) {
        next(err);
        return;
      }
      if (err instanceof multer.MulterError) {
        const status =
          err.code === "LIMIT_FILE_SIZE" || err.code === "LIMIT_FIELD_VALUE" ? 413 : 400;
        res.status(status).json({ message: err.message, code: err.code });
        return;
      }
      next(err);
    });

    return {
      server: await startHttpServer(app),
      token: generateToken({ id: "upload-user", email: "upload@example.com", tier }),
      sqlite: importedSqlite,
    };
  }

  async function postChunkedMultipart(
    baseUrl: string,
    path: string,
    headers: Record<string, string>,
    chunks: string[],
  ): Promise<{ status: number; body: Record<string, unknown> | null; text: string }> {
    const url = new URL(path, baseUrl);

    return await new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          method: "POST",
          hostname: url.hostname,
          port: url.port,
          path: `${url.pathname}${url.search}`,
          headers,
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            text += chunk;
          });
          res.on("end", () => {
            let body: Record<string, unknown> | null = null;
            if (text) {
              try {
                body = JSON.parse(text) as Record<string, unknown>;
              } catch {
                body = null;
              }
            }
            resolve({ status: res.statusCode ?? 0, body, text });
          });
        },
      );

      req.on("error", reject);
      for (const chunk of chunks) {
        req.write(chunk);
      }
      req.end();
    });
  }

  it("rejects combined uploads over the configured file-count limit at multer", async () => {
    const { server, token } = await createUploadApp();
    const form = new FormData();
    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    form.append("files", new Blob([imageBytes], { type: "image/png" }), "one.png");
    form.append("files", new Blob([imageBytes], { type: "image/png" }), "two.png");

    try {
      const response = await fetch(`${server.baseUrl}/api/upload-group`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toMatchObject({ code: "LIMIT_FILE_COUNT" });
    } finally {
      await server.close();
    }
  });

  it("rejects chunked combined uploads above the aggregate file byte limit while streaming", async () => {
    process.env.MAX_COMBINED_UPLOAD_FILES = "3";
    const { server, token } = await createUploadApp();
    const boundary = "scholarmark-test-boundary";

    try {
      const response = await postChunkedMultipart(
        server.baseUrl,
        "/api/upload-group",
        {
          authorization: `Bearer ${token}`,
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        [
          `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="one.png"\r\nContent-Type: image/png\r\n\r\n`,
          "a".repeat(700),
          `\r\n--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="two.png"\r\nContent-Type: image/png\r\n\r\n`,
          "b".repeat(700),
          `\r\n--${boundary}--\r\n`,
        ],
      );

      expect(response.status).toBe(413);
      expect(response.body).toMatchObject({ code: "LIMIT_FILE_SIZE" });
    } finally {
      await server.close();
    }
  });

  it("rejects combined upload payloads above the total byte limit before multer buffers files", async () => {
    const { server, token } = await createUploadApp();

    try {
      const response = await fetch(`${server.baseUrl}/api/upload-group`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "multipart/form-data; boundary=test",
        },
        body: "x".repeat(2048),
      });
      const body = await response.json();

      expect(response.status).toBe(413);
      expect(body).toEqual({
        message: "Upload payload is too large",
        maxBytes: 1024,
      });
    } finally {
      await server.close();
    }
  });

  it("keeps storage usage reserved when OCR enqueue fails after source persistence", async () => {
    const { server, token, sqlite } = await createUploadApp();
    enqueuePdfOcrJob.mockRejectedValueOnce(new Error("queue unavailable"));
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    const form = new FormData();
    form.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "scan.pdf");
    form.append("ocrMode", "advanced");

    try {
      const response = await fetch(`${server.baseUrl}/api/upload`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
      const userAfterUpload = sqlite
        .prepare("SELECT storage_used FROM users WHERE id = ?")
        .get("upload-user") as { storage_used: number };
      const persistedDoc = sqlite
        .prepare("SELECT id, filename FROM documents WHERE user_id = ?")
        .get("upload-user") as { id: string; filename: string } | undefined;

      expect(response.status).toBe(500);
      expect(userAfterUpload.storage_used).toBe(pdfBytes.length);
      expect(persistedDoc).toMatchObject({ filename: "scan.pdf" });
    } finally {
      await server.close();
    }
  });

  it("rejects new uploads once the account document limit is reached", async () => {
    const { server, token } = await createUploadApp({
      tier: "free",
      existingDocumentCount: 5,
    });
    const form = new FormData();
    form.append(
      "file",
      new Blob(["This is enough plain text to create a document."], { type: "text/plain" }),
      "notes.txt",
    );

    try {
      const response = await fetch(`${server.baseUrl}/api/upload`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toMatchObject({
        limit: 5,
        requiredTier: "pro",
      });
    } finally {
      await server.close();
    }
  });

  it("requires Pro for Vision OCR", async () => {
    const { server, token } = await createUploadApp({ tier: "free" });
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }),
      "scan.png",
    );

    try {
      const response = await fetch(`${server.baseUrl}/api/upload`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toMatchObject({
        currentTier: "free",
        requiredTier: "pro",
      });
    } finally {
      await server.close();
    }
  });

  it("requires Max for GPT-4o Vision OCR", async () => {
    const { server, token } = await createUploadApp({ tier: "pro" });
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }),
      "scan.png",
    );
    form.append("ocrModel", "gpt-4o");

    try {
      const response = await fetch(`${server.baseUrl}/api/upload`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toMatchObject({
        currentTier: "pro",
        requiredTier: "max",
      });
    } finally {
      await server.close();
    }
  });
});
