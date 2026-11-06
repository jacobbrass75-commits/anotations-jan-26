import express from "express";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapTempWorkspace } from "./helpers/bootstrapTempWorkspace";
import { startHttpServer } from "./helpers/http";

// Real HTTP transport with a scripted provider. Each test queues one script per
// expected provider stream; a stream with no script fails the test loudly.
type ScriptedStream = {
  emitText: (text: string) => void;
  finish: (message: { stop_reason: string; usage: Record<string, number> }) => void;
  fail: (error: Error) => void;
  abortCalls: number;
  currentMessage?: { usage: Record<string, number> };
};

const { anthropicCreate, anthropicStream, streamScripts, compactionGate } = vi.hoisted(() => {
  const streamScripts: Array<(stream: ScriptedStream) => void> = [];
  const compactionGate: { wait: (() => Promise<void>) | null } = { wait: null };

  const anthropicStream = vi.fn(() => {
    const handlers: Record<string, (value: any) => void> = {};
    const scripted: ScriptedStream = {
      emitText: (text) => handlers.text?.(text),
      finish: (message) => handlers.message?.(message),
      fail: (error) => handlers.error?.(error),
      abortCalls: 0,
    };
    const stream = {
      on: vi.fn((event: string, handler: (value: any) => void) => {
        handlers[event] = handler;
        if (event === "error") {
          const script = streamScripts.shift();
          queueMicrotask(() =>
            script ? script(scripted) : scripted.fail(new Error("unexpected provider stream")),
          );
        }
        return stream;
      }),
      abort: vi.fn(() => {
        scripted.abortCalls += 1;
        (stream as any).onAbort?.();
      }),
      get currentMessage() {
        return scripted.currentMessage;
      },
      scripted,
    };
    return stream;
  });

  return {
    streamScripts,
    compactionGate,
    anthropicStream,
    anthropicCreate: vi.fn(async () => ({
      content: [{ type: "text", text: JSON.stringify({ newEvidence: [], sectionsWorkedOn: [] }) }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })),
  };
});

vi.mock("@anthropic-ai/sdk", async () => {
  const actual = await vi.importActual<typeof import("@anthropic-ai/sdk")>("@anthropic-ai/sdk");
  const Anthropic: any = vi.fn().mockImplementation(function AnthropicMock() {
    return { messages: { create: anthropicCreate, stream: anthropicStream } };
  });
  Anthropic.APIUserAbortError = actual.APIUserAbortError;
  return { default: Anthropic, APIUserAbortError: actual.APIUserAbortError };
});

vi.mock("../../server/contextCompaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/contextCompaction")>();
  return {
    ...actual,
    compactReaderConversation: vi.fn(async (...args: any[]) => {
      if (compactionGate.wait) await compactionGate.wait();
      return (actual.compactReaderConversation as any)(...args);
    }),
  };
});

const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function waitFor(condition: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await delay(10);
  }
}

describe("chat streaming cancellation over HTTP", () => {
  let tempDir = "";
  let sqlite: any = null;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-chat-cancel-"));
    vi.resetModules();
    vi.clearAllMocks();
    streamScripts.length = 0;
    compactionGate.wait = null;
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

  async function createApp(tier: "pro" | "max", writingModel: string) {
    const { db, sqlite: importedSqlite } = await import("../../server/db");
    const { users, conversations } = await import("../../shared/schema");
    const { registerChatRoutes } = await import("../../server/chatRoutes");
    const { generateToken } = await import("../../server/auth");
    sqlite = importedSqlite;

    const now = new Date("2026-05-05T00:00:00.000Z");
    await db.insert(users).values({
      id: "chat-user",
      email: "chat@example.com",
      username: "chat@example.com",
      password: "",
      tier,
      tokensUsed: 0,
      tokenLimit: 100_000,
      storageUsed: 0,
      storageLimit: 524288000,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    } as any);
    await db.insert(conversations).values({
      id: "conversation-1",
      userId: "chat-user",
      title: "New Chat",
      model: "claude-sonnet-5-5",
      writingModel,
      createdAt: now,
      updatedAt: now,
    } as any);

    const app = express();
    app.use(express.json());
    registerChatRoutes(app);
    return {
      server: await startHttpServer(app),
      token: generateToken({ id: "chat-user", email: "chat@example.com", tier }),
    };
  }

  function sendMessage(baseUrl: string, token: string, signal?: AbortSignal) {
    return fetch(`${baseUrl}/api/chat/conversations/conversation-1/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ content: "Draft a sentence." }),
      signal,
    });
  }

  const reservations = () =>
    sqlite
      .prepare(
        "SELECT model, status, actual_cost_cents, estimated_cost_cents FROM ai_usage_reservations",
      )
      .all() as Array<{
      model: string;
      status: string;
      actual_cost_cents: number | null;
      estimated_cost_cents: number;
    }>;
  const assistantMessages = () =>
    sqlite
      .prepare("SELECT content, tokens_used FROM messages WHERE role = 'assistant'")
      .all() as Array<{ content: string; tokens_used: number }>;

  it("streams a normal response to completion without cancelling the provider", async () => {
    const { server, token } = await createApp("pro", "sonnet");
    streamScripts.push((stream) => {
      stream.emitText("A complete answer.");
      stream.finish({ stop_reason: "end_turn", usage: { input_tokens: 40, output_tokens: 10 } });
    });

    try {
      const response = await sendMessage(server.baseUrl, token);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain('"type":"done"');
      expect(anthropicStream).toHaveBeenCalledTimes(1);
      const stream = anthropicStream.mock.results[0].value as any;
      // A normal finish closes the response too; that close must not count as a cancel.
      await delay(50);
      expect(stream.scripted.abortCalls).toBe(0);
      expect(reservations()).toEqual([
        expect.objectContaining({ model: "sonnet", status: "settled", actual_cost_cents: 1 }),
      ]);
      expect(assistantMessages()).toEqual([
        expect.objectContaining({ content: "A complete answer.", tokens_used: 50 }),
      ]);
    } finally {
      await server.close();
    }
  });

  it("aborts the provider stream when the client disconnects mid-stream", async () => {
    const { APIUserAbortError } =
      await vi.importActual<typeof import("@anthropic-ai/sdk")>("@anthropic-ai/sdk");
    const { server, token } = await createApp("max", "opus");
    let release: () => void = () => {};
    streamScripts.push((stream) => {
      stream.currentMessage = { usage: { input_tokens: 30_000, output_tokens: 5_000 } };
      stream.emitText("Most of a draft");
      // The provider would keep generating until aborted.
      const parent = anthropicStream.mock.results.at(-1)!.value as any;
      parent.onAbort = () => stream.fail(new APIUserAbortError());
      release = () => stream.finish({ stop_reason: "end_turn", usage: {} });
    });

    try {
      const controller = new AbortController();
      const response = await sendMessage(server.baseUrl, token, controller.signal);
      expect(response.status).toBe(200);
      await waitFor(() => anthropicStream.mock.calls.length === 1);
      await delay(30);
      controller.abort();

      const stream = anthropicStream.mock.results[0].value as any;
      await waitFor(() => stream.scripted.abortCalls > 0);
      await waitFor(() => reservations()[0]?.status === "settled");

      expect(anthropicStream).toHaveBeenCalledTimes(1);
      // The Opus run stays counted, at the partial usage the provider reported.
      expect(reservations()).toEqual([
        expect.objectContaining({ model: "opus", status: "settled", actual_cost_cents: 22 }),
      ]);
      // The partial draft is kept, marked as non-canonical.
      await waitFor(() => assistantMessages().length === 1);
      expect(assistantMessages()[0].content).toMatch(/^\[PARTIAL DRAFT/);
      expect(assistantMessages()[0].content).toContain("Most of a draft");
      expect(assistantMessages()[0].tokens_used).toBe(35_000);
      // No follow-up model work (evidence extraction) starts after the client left.
      expect(anthropicCreate).not.toHaveBeenCalled();
    } finally {
      release();
      await server.close();
    }
  });

  it("does not start a provider call when the client leaves during preparation", async () => {
    const { server, token } = await createApp("max", "opus");
    let releaseCompaction: () => void = () => {};
    let compactionStarted = false;
    compactionGate.wait = () =>
      new Promise<void>((done) => {
        compactionStarted = true;
        releaseCompaction = done;
      });

    try {
      const controller = new AbortController();
      const responsePromise = sendMessage(server.baseUrl, token, controller.signal).catch(
        () => null,
      );
      await waitFor(() => compactionStarted);
      controller.abort();
      await responsePromise;
      await delay(50);
      releaseCompaction();
      await delay(100);

      expect(anthropicStream).not.toHaveBeenCalled();
      // Nothing ran, so the reservation is released and no Opus run is spent.
      expect(reservations()).toEqual([]);
      expect(assistantMessages()).toEqual([]);
    } finally {
      releaseCompaction();
      await server.close();
    }
  });

  it("does not start another tool iteration after the client disconnects", async () => {
    const { server, token } = await createApp("pro", "sonnet");
    let finishFirst: () => void = () => {};
    streamScripts.push((stream) => {
      stream.emitText("Need more context.");
      // The provider finishes the turn even though an abort was requested (a race).
      finishFirst = () => {
        stream.emitText(
          '<chunk_request document_id="doc-1" annotation_id="missing">nearby text</chunk_request>',
        );
        stream.finish({ stop_reason: "end_turn", usage: { input_tokens: 40, output_tokens: 10 } });
      };
    });

    try {
      const controller = new AbortController();
      const response = await sendMessage(server.baseUrl, token, controller.signal);
      expect(response.status).toBe(200);
      await waitFor(() => anthropicStream.mock.calls.length === 1);
      controller.abort();
      await delay(30);
      finishFirst();
      await waitFor(() => reservations()[0]?.status === "settled");
      await delay(100);

      expect(anthropicStream).toHaveBeenCalledTimes(1);
      expect(reservations()).toEqual([
        expect.objectContaining({ model: "sonnet", status: "settled", actual_cost_cents: 1 }),
      ]);
    } finally {
      finishFirst();
      await server.close();
    }
  });

  it.each(["compile", "verify"] as const)(
    "aborts the %s stream on disconnect and keeps the run counted",
    async (operation) => {
      const { APIUserAbortError } =
        await vi.importActual<typeof import("@anthropic-ai/sdk")>("@anthropic-ai/sdk");
      const { server, token } = await createApp("max", "opus");
      sqlite
        .prepare(
          "INSERT INTO messages (id, conversation_id, role, content, tokens_used, created_at) VALUES (?, ?, ?, ?, 0, ?)",
        )
        .run(
          "message-1",
          "conversation-1",
          "assistant",
          "# Draft\nA sourced argument.",
          Date.now(),
        );
      streamScripts.push((stream) => {
        stream.currentMessage = { usage: { input_tokens: 30_000, output_tokens: 1 } };
        stream.emitText("x".repeat(20_000));
        const parent = anthropicStream.mock.results.at(-1)!.value as any;
        parent.onAbort = () => stream.fail(new APIUserAbortError());
      });

      try {
        const controller = new AbortController();
        const response = await fetch(
          `${server.baseUrl}/api/chat/conversations/conversation-1/${operation}`,
          {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({ compiledContent: "# Draft\nA sourced argument." }),
            signal: controller.signal,
          },
        );
        expect(response.status).toBe(200);
        await waitFor(() => anthropicStream.mock.calls.length === 1);
        await delay(30);
        controller.abort();

        const stream = anthropicStream.mock.results[0].value as any;
        await waitFor(() => stream.scripted.abortCalls > 0);
        await waitFor(() => reservations()[0]?.status === "settled");

        // 30,000 input tokens plus ~5,000 output tokens estimated from the streamed text.
        expect(reservations()).toEqual([
          expect.objectContaining({ model: "opus", status: "settled", actual_cost_cents: 22 }),
        ]);
        expect(anthropicStream).toHaveBeenCalledTimes(1);
      } finally {
        await server.close();
      }
    },
  );

  it("still reports a provider failure to a connected client and refunds the run", async () => {
    const { server, token } = await createApp("max", "opus");
    streamScripts.push((stream) => stream.fail(new Error("overloaded_error")));

    try {
      const response = await sendMessage(server.baseUrl, token);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain('"type":"error"');
      expect(body).toContain("overloaded_error");
      expect(reservations()).toEqual([]);
    } finally {
      await server.close();
    }
  });
});
