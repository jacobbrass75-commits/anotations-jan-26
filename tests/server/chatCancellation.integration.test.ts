import express from "express";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapTempWorkspace } from "./helpers/bootstrapTempWorkspace";
import { startHttpServer } from "./helpers/http";

// Real HTTP transport with a scripted provider. Each test queues one script per
// expected provider stream; a stream with no script fails the test loudly.
//
// The fake follows @anthropic-ai/sdk MessageStream semantics: abort() emits "abort"
// (never "error") with an APIUserAbortError and then ends the stream; nothing is
// emitted after the end; an "abort" or "error" with no listener becomes an unhandled
// rejection, as in the SDK.
type ScriptedStream = {
  emitText: (text: string) => void;
  finish: (message: { stop_reason: string; usage: Record<string, number> }) => void;
  fail: (error: Error) => void;
  abortCalls: number;
  currentMessage?: { usage: Record<string, number> };
  /** Models a race: the final message was already in flight when abort() landed. */
  deliverBeforeAbort?: () => void;
};

const { anthropicCreate, anthropicStream, streamScripts, compactionGate, sdkErrors } = vi.hoisted(
  () => {
    const streamScripts: Array<(stream: ScriptedStream) => void> = [];
    const compactionGate: { wait: (() => Promise<void>) | null } = { wait: null };
    const sdkErrors: { APIUserAbortError: new () => Error } = {
      APIUserAbortError: class extends Error {},
    };

    const anthropicStream = vi.fn(() => {
      const handlers: Record<string, Array<(value: any) => void>> = {};
      let ended = false;
      const emit = (event: string, value?: unknown) => {
        if (ended) return;
        const listeners = handlers[event] ?? [];
        for (const listener of listeners) listener(value);
        if ((event === "abort" || event === "error") && listeners.length === 0) {
          void Promise.reject(value);
        }
        if (event === "message" || event === "abort" || event === "error") {
          ended = true;
          for (const listener of handlers.end ?? []) listener(undefined);
        }
      };
      const scripted: ScriptedStream = {
        emitText: (text) => emit("text", text),
        finish: (message) => emit("message", message),
        fail: (error) => emit("error", error),
        abortCalls: 0,
      };
      const stream = {
        on: vi.fn((event: string, handler: (value: any) => void) => {
          (handlers[event] ??= []).push(handler);
          return stream;
        }),
        abort: vi.fn(() => {
          scripted.abortCalls += 1;
          if (ended) return;
          if (scripted.deliverBeforeAbort) {
            scripted.deliverBeforeAbort();
            return;
          }
          emit("abort", new sdkErrors.APIUserAbortError());
        }),
        get currentMessage() {
          return scripted.currentMessage;
        },
        scripted,
      };
      const script = streamScripts.shift();
      queueMicrotask(() =>
        script ? script(scripted) : scripted.fail(new Error("unexpected provider stream")),
      );
      return stream;
    });

    return {
      streamScripts,
      compactionGate,
      sdkErrors,
      anthropicStream,
      anthropicCreate: vi.fn(async () => ({
        content: [
          { type: "text", text: JSON.stringify({ newEvidence: [], sectionsWorkedOn: [] }) },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      })),
    };
  },
);

vi.mock("@anthropic-ai/sdk", async () => {
  const actual = await vi.importActual<typeof import("@anthropic-ai/sdk")>("@anthropic-ai/sdk");
  sdkErrors.APIUserAbortError = actual.APIUserAbortError as unknown as new () => Error;
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
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(async () => {
    unhandled.length = 0;
    process.on("unhandledRejection", onUnhandled);
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-chat-cancel-"));
    vi.resetModules();
    vi.clearAllMocks();
    streamScripts.length = 0;
    compactionGate.wait = null;
    process.chdir(tempDir);
    await bootstrapTempWorkspace(tempDir);
  });

  afterEach(async () => {
    await delay(20);
    process.off("unhandledRejection", onUnhandled);
    // An SDK "abort" or "error" event nobody handles surfaces here.
    expect(unhandled).toEqual([]);
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
    const { server, token } = await createApp("max", "opus");
    let release: () => void = () => {};
    streamScripts.push((stream) => {
      stream.currentMessage = { usage: { input_tokens: 30_000, output_tokens: 5_000 } };
      stream.emitText("Most of a draft");
      // The provider keeps generating until aborted; a late finish is dropped after abort.
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
    streamScripts.push((stream) => {
      stream.emitText("Need more context.");
      // A race: the turn's final events were already in flight when the abort landed,
      // so the SDK delivers the finished message instead of an abort.
      stream.deliverBeforeAbort = () => {
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
      await delay(30);
      controller.abort();
      await waitFor(() => reservations()[0]?.status === "settled");
      await delay(100);

      const stream = anthropicStream.mock.results[0].value as any;
      expect(stream.scripted.abortCalls).toBe(1);
      // The retrieval round would start a second paid stream; it must not.
      expect(anthropicStream).toHaveBeenCalledTimes(1);
      expect(reservations()).toEqual([
        expect.objectContaining({ model: "sonnet", status: "settled", actual_cost_cents: 1 }),
      ]);
    } finally {
      await server.close();
    }
  });

  it.each(["compile", "verify"] as const)(
    "aborts the %s stream on disconnect and keeps the run counted",
    async (operation) => {
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

  it.each(["messages", "compile", "verify"] as const)(
    "%s: a failed usage settlement still ends the response and keeps the run counted",
    async (operation) => {
      const { server, token } = await createApp("max", "opus");
      sqlite
        .prepare(
          "INSERT INTO messages (id, conversation_id, role, content, tokens_used, created_at) VALUES (?, ?, ?, ?, 0, ?)",
        )
        .run("message-1", "conversation-1", "assistant", "# Draft\nAn argument.", Date.now());
      const { usageLedger } = await import("../../server/db");
      const settle = vi.spyOn(usageLedger, "settle").mockImplementation(() => {
        throw new Error("SQLITE_BUSY: database is locked");
      });
      const refund = vi.spyOn(usageLedger, "refund");
      streamScripts.push((stream) => {
        stream.emitText("A complete answer.");
        stream.finish({ stop_reason: "end_turn", usage: { input_tokens: 40, output_tokens: 10 } });
      });

      try {
        const response = await fetch(
          `${server.baseUrl}/api/chat/conversations/conversation-1/${operation}`,
          {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({
              content: "Draft a sentence.",
              compiledContent: "# Draft\nAn argument.",
            }),
            signal: AbortSignal.timeout(3_000),
          },
        );
        // The stream ends (no hung heartbeat) and reports the failure.
        const body = await response.text();

        expect(response.status).toBe(200);
        expect(body).toContain('"type":"error"');
        expect(body).not.toContain('"type":"done"');
        expect(settle).toHaveBeenCalledTimes(1);
        // Billed work is never refunded: the reservation stays counted as reserved.
        expect(refund).not.toHaveBeenCalled();
        expect(reservations()).toEqual([
          expect.objectContaining({ model: "opus", status: "reserved" }),
        ]);
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
