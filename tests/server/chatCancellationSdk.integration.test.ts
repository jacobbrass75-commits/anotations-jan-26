import express from "express";
import { mkdtemp, rm } from "fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapTempWorkspace } from "./helpers/bootstrapTempWorkspace";
import { startHttpServer } from "./helpers/http";

// No SDK mock: the real @anthropic-ai/sdk MessageStream talks to a local fake Messages
// API that streams SSE. Nothing leaves 127.0.0.1 and the API key is a placeholder.

type FakeRequest = { body: any; upstreamClosedEarly: boolean };

function sse(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function startFakeAnthropic(mode: () => "complete" | "hang") {
  const requests: FakeRequest[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const record: FakeRequest = { body: JSON.parse(raw || "{}"), upstreamClosedEarly: false };
      requests.push(record);
      res.on("close", () => {
        if (!res.writableFinished) record.upstreamClosedEarly = true;
      });
      if (req.url !== "/v1/messages" || record.body.stream !== true) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error" } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      sse(res, "message_start", {
        type: "message_start",
        message: {
          id: "msg_local",
          type: "message",
          role: "assistant",
          model: record.body.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 30_000, output_tokens: 1 },
        },
      });
      sse(res, "content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      });
      sse(res, "content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Most of a draft " },
      });
      if (mode() === "hang") return; // keep generating until the caller aborts
      sse(res, "content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "and its ending." },
      });
      sse(res, "content_block_stop", { type: "content_block_stop", index: 0 });
      sse(res, "message_delta", {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 10 },
      });
      sse(res, "message_stop", { type: "message_stop" });
      res.end();
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return {
    requests,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function waitFor(condition: () => boolean, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await delay(10);
  }
}

describe("chat streaming with the real Anthropic SDK over local SSE", () => {
  let tempDir = "";
  let sqlite: any = null;
  let fake: Awaited<ReturnType<typeof startFakeAnthropic>> | null = null;
  let fakeMode: "complete" | "hang" = "complete";
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  const originalCwd = process.cwd();
  const originalEnv = {
    baseUrl: process.env.ANTHROPIC_BASE_URL,
    apiKey: process.env.ANTHROPIC_API_KEY,
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-chat-sdk-"));
    vi.resetModules();
    unhandled.length = 0;
    process.on("unhandledRejection", onUnhandled);
    fakeMode = "complete";
    fake = await startFakeAnthropic(() => fakeMode);
    process.env.ANTHROPIC_BASE_URL = fake.baseUrl;
    process.env.ANTHROPIC_API_KEY = "local-test-placeholder";
    process.chdir(tempDir);
    await bootstrapTempWorkspace(tempDir);
  });

  afterEach(async () => {
    process.off("unhandledRejection", onUnhandled);
    await fake?.close();
    fake = null;
    sqlite?.close();
    sqlite = null;
    process.chdir(originalCwd);
    for (const [key, value] of [
      ["ANTHROPIC_BASE_URL", originalEnv.baseUrl],
      ["ANTHROPIC_API_KEY", originalEnv.apiKey],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.resetModules();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createApp() {
    const { db, sqlite: importedSqlite } = await import("../../server/db");
    const { users, conversations, messages } = await import("../../shared/schema");
    const { registerChatRoutes } = await import("../../server/chatRoutes");
    const { generateToken } = await import("../../server/auth");
    sqlite = importedSqlite;
    const now = new Date("2026-05-05T00:00:00.000Z");
    await db.insert(users).values({
      id: "chat-user",
      email: "chat@example.com",
      username: "chat@example.com",
      password: "",
      tier: "max",
      tokensUsed: 0,
      tokenLimit: 1_000_000,
      storageUsed: 0,
      storageLimit: 524288000,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    } as any);
    await db.insert(conversations).values({
      id: "conversation-1",
      userId: "chat-user",
      title: "Draft",
      model: "claude-opus-5-5",
      writingModel: "opus",
      createdAt: now,
      updatedAt: now,
    } as any);
    await db.insert(messages).values({
      id: "message-0",
      conversationId: "conversation-1",
      role: "assistant",
      content: "# Draft\nA sourced argument.",
      createdAt: now,
    } as any);
    const app = express();
    app.use(express.json());
    registerChatRoutes(app);
    return {
      server: await startHttpServer(app),
      token: generateToken({ id: "chat-user", email: "chat@example.com", tier: "max" }),
    };
  }

  const reservation = () =>
    sqlite.prepare("SELECT status, actual_cost_cents FROM ai_usage_reservations").get() as
      | { status: string; actual_cost_cents: number | null }
      | undefined;

  function post(baseUrl: string, path: string, token: string, signal?: AbortSignal) {
    return fetch(`${baseUrl}/api/chat/conversations/conversation-1/${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        content: "Draft a sentence.",
        compiledContent: "# Draft\nA sourced argument.",
      }),
      signal,
    });
  }

  it("completes a chat turn and settles the run at the reported usage", async () => {
    const { server, token } = await createApp();
    try {
      const response = await post(server.baseUrl, "messages", token);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain('"type":"done"');
      expect(fake!.requests).toHaveLength(1);
      expect(fake!.requests[0].body).toMatchObject({ model: "claude-opus-5-5", stream: true });
      // Claude Opus 5.5: 30,000 input and 10 output tokens at USD 4 / 20 per million.
      expect(reservation()).toEqual({ status: "settled", actual_cost_cents: 13 });
      expect(unhandled).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it.each(["messages", "compile", "verify"])(
    "%s: a client disconnect aborts the upstream SDK stream and settles the run once",
    async (path) => {
      fakeMode = "hang";
      const { server, token } = await createApp();
      try {
        const controller = new AbortController();
        const response = await post(server.baseUrl, path, token, controller.signal);
        expect(response.status).toBe(200);
        await waitFor(() => fake!.requests.length === 1);
        await delay(50);
        controller.abort();

        // The upstream provider request is torn down, so generation stops being billed.
        await waitFor(() => fake!.requests[0].upstreamClosedEarly);
        await waitFor(() => reservation()?.status === "settled");
        await delay(100);

        // 30,000 input tokens plus 4 output tokens estimated from the streamed text.
        expect(reservation()).toEqual({ status: "settled", actual_cost_cents: 13 });
        expect(fake!.requests).toHaveLength(1);
        expect(unhandled).toEqual([]);
        if (path === "messages") {
          const saved = sqlite
            .prepare(
              "SELECT content, tokens_used FROM messages WHERE role = 'assistant' AND id != 'message-0'",
            )
            .all() as Array<{ content: string; tokens_used: number }>;
          expect(saved).toHaveLength(1);
          expect(saved[0].content).toMatch(/^\[PARTIAL DRAFT/);
          expect(saved[0].tokens_used).toBe(30_004);
        }
      } finally {
        await server.close();
      }
    },
  );
});
