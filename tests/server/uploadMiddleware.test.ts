import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { afterEach, describe, expect, it } from "vitest";
import { createUploadMiddleware } from "../../server/uploadMiddleware";
import { startHttpServer } from "./helpers/http";

async function requestMultipart(
  baseUrl: string,
  path: string,
  file: { name: string; type: string; contents: string }
) {
  const form = new FormData();
  form.set("file", new File([file.contents], file.name, { type: file.type }));

  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    body: form,
  });

  const text = await response.text();
  let body: Record<string, unknown> | null = null;

  if (text) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = null;
    }
  }

  return { status: response.status, body, text };
}

async function requestMultipartFields(
  baseUrl: string,
  path: string,
  fields: Record<string, string>
) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    body: form,
  });

  const text = await response.text();
  let body: Record<string, unknown> | null = null;

  if (text) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = null;
    }
  }

  return { status: response.status, body, text };
}

describe("upload middleware", () => {
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop();
      if (server) {
        await server.close();
      }
    }
  });

  async function createUploadApp(maxFileSizeBytes?: number) {
    const app = express();
    const upload = createUploadMiddleware({ maxFileSizeBytes });

    app.post("/upload", upload.single("file"), (req: Request, res: Response) => {
      res.status(200).json({
        filename: req.file?.originalname,
        mimeType: req.file?.mimetype,
        size: req.file?.size,
      });
    });

    app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
      if (!err) {
        next();
        return;
      }

      if (err instanceof multer.MulterError) {
        const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        res.status(status).json({ message: err.message, code: err.code });
        return;
      }

      const message = err instanceof Error ? err.message : "Unexpected upload error";
      res.status(400).json({ message });
    });

    const server = await startHttpServer(app);
    servers.push(server);
    return server;
  }

  async function createTextUploadApp(maxFieldSizeBytes?: number) {
    const app = express();
    const upload = createUploadMiddleware({ maxFieldSizeBytes });

    app.post("/upload-text", upload.none(), (req: Request, res: Response) => {
      res.status(200).json({
        title: req.body.title,
        textLength: typeof req.body.text === "string" ? req.body.text.length : 0,
      });
    });

    app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
      if (!err) {
        next();
        return;
      }

      if (err instanceof multer.MulterError) {
        const status = err.code === "LIMIT_FIELD_VALUE" ? 413 : 400;
        res.status(status).json({ message: err.message, code: err.code });
        return;
      }

      const message = err instanceof Error ? err.message : "Unexpected upload error";
      res.status(400).json({ message });
    });

    const server = await startHttpServer(app);
    servers.push(server);
    return server;
  }

  it("accepts supported file types", async () => {
    const server = await createUploadApp();

    const response = await requestMultipart(server.baseUrl, "/upload", {
      name: "notes.txt",
      type: "text/plain",
      contents: "A short research note.",
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      filename: "notes.txt",
      mimeType: "text/plain",
      size: 22,
    });
  });

  it("rejects unsupported file types", async () => {
    const server = await createUploadApp();

    const response = await requestMultipart(server.baseUrl, "/upload", {
      name: "payload.exe",
      type: "application/octet-stream",
      contents: "not allowed",
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: "Only PDF, TXT, and image files (including HEIC/HEIF) are allowed",
    });
  });

  it("enforces the configured file size limit", async () => {
    const server = await createUploadApp(8);

    const response = await requestMultipart(server.baseUrl, "/upload", {
      name: "tiny.txt",
      type: "text/plain",
      contents: "123456789",
    });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      message: "File too large",
      code: "LIMIT_FILE_SIZE",
    });
  });

  it("accepts multipart text fields for pasted sources", async () => {
    const server = await createTextUploadApp();

    const response = await requestMultipartFields(server.baseUrl, "/upload-text", {
      title: "Pasted Source",
      text: "A pasted source body with enough material to store.",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      title: "Pasted Source",
      textLength: 51,
    });
  });

  it("enforces the configured text field size limit", async () => {
    const server = await createTextUploadApp(8);

    const response = await requestMultipartFields(server.baseUrl, "/upload-text", {
      title: "Too long",
      text: "123456789",
    });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      message: "Field value too long",
      code: "LIMIT_FIELD_VALUE",
    });
  });
});
