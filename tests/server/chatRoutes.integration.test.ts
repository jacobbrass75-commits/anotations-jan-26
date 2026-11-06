import express from "express";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapTempWorkspace } from "./helpers/bootstrapTempWorkspace";
import { startHttpServer } from "./helpers/http";

const { anthropicCreate, anthropicStream, streamScript } = vi.hoisted(() => {
  const streamScript = { text: "Budgeted chat answer.", stopReason: "end_turn" };
  return {
    streamScript,
    anthropicCreate: vi.fn(async () => ({
      content: [{ type: "text", text: JSON.stringify({ newEvidence: [], sectionsWorkedOn: [] }) }],
    })),
    anthropicStream: vi.fn(() => {
      const handlers: Record<string, (value: any) => void> = {};
      const stream = {
        on: vi.fn((event: string, handler: (value: any) => void) => {
          handlers[event] = handler;
          if (event === "error") {
            queueMicrotask(() => {
              handlers.text?.(streamScript.text);
              handlers.message?.({
                stop_reason: streamScript.stopReason,
                usage: { input_tokens: 12, output_tokens: 7 },
              });
            });
          }
          return stream;
        }),
        abort: vi.fn(),
      };
      return stream;
    }),
  };
});

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(function AnthropicMock() {
    return {
      messages: {
        create: anthropicCreate,
        stream: anthropicStream,
      },
    };
  }),
}));

type Tier = "free" | "pro" | "max";

describe("chat route integration", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-chat-routes-"));
    vi.resetModules();
    vi.clearAllMocks();
    streamScript.text = "Budgeted chat answer.";
    streamScript.stopReason = "end_turn";
    process.chdir(tempDir);
    await bootstrapTempWorkspace(tempDir);
    // No test may reach OpenRouter: GPT and DeepSeek are not in-app model choices.
    const originalFetch = globalThis.fetch.bind(globalThis);
    vi.spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
      const url = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
      if (url.includes("openrouter.ai")) throw new Error(`Unexpected OpenRouter call: ${url}`);
      return originalFetch(input, init);
    }) as typeof fetch);
  });

  afterEach(async () => {
    sqlite?.close();
    sqlite = null;
    process.chdir(originalCwd);
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createApp(
    options: {
      tier?: Tier;
      writingModel?: string;
      withGroundedSource?: boolean;
    } = {},
  ) {
    const { db, sqlite: importedSqlite, usageLedger } = await import("../../server/db");
    const { users, conversations, webClips } = await import("../../shared/schema");
    const { registerChatRoutes } = await import("../../server/chatRoutes");
    const { generateToken } = await import("../../server/auth");

    sqlite = importedSqlite;

    const now = new Date("2026-05-05T00:00:00.000Z");
    await db.insert(users).values({
      id: "chat-user",
      email: "chat@example.com",
      username: "chat@example.com",
      password: "",
      tier: options.tier ?? "pro",
      tokensUsed: 0,
      tokenLimit: 1000,
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
      model: "claude-opus-4-6",
      writingModel: options.writingModel ?? "precision",
      selectedSourceIds: options.withGroundedSource ? ["source-legitimacy"] : null,
      createdAt: now,
      updatedAt: now,
    } as any);

    if (options.withGroundedSource) {
      await db.insert(webClips).values({
        id: "source-legitimacy",
        userId: "chat-user",
        highlightedText: "Public legitimacy strengthens compliance over time.",
        surroundingContext: "Public legitimacy strengthens compliance over time.",
        category: "key_quote",
        sourceUrl: "https://example.test/legitimacy",
        pageTitle: "Legitimacy Study",
        authorName: "Researcher",
        createdAt: now,
      } as any);
    }

    const app = express();
    app.use(express.json());
    registerChatRoutes(app);

    return {
      db,
      usageLedger,
      sqlite: importedSqlite,
      server: await startHttpServer(app),
      token: generateToken({
        id: "chat-user",
        email: "chat@example.com",
        tier: options.tier ?? "pro",
      }),
    };
  }

  function post(baseUrl: string, path: string, token: string, body: unknown, requestId?: string) {
    return fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(requestId ? { "x-request-id": requestId } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  function opusRunsUsed(db: any) {
    return (
      db.prepare("SELECT COUNT(*) count FROM ai_usage_reservations WHERE model = 'opus'").get() as {
        count: number;
      }
    ).count;
  }

  it("runs a saved Opus choice on Sonnet for Starter verification", async () => {
    const { server, token, sqlite } = await createApp({ tier: "free" });

    try {
      const response = await post(
        server.baseUrl,
        "/api/chat/conversations/conversation-1/verify",
        token,
        { compiledContent: "# Draft\nA sourced argument." },
      );
      const body = await response.text();
      const verifyCall = anthropicStream.mock.calls.at(-1)?.[0] as { model?: string };

      expect(response.status).toBe(200);
      expect(body).toContain("Budgeted chat answer.");
      expect(verifyCall.model).toBe("claude-sonnet-5-5");
      expect(opusRunsUsed(sqlite)).toBe(0);
    } finally {
      await server.close();
    }
  });

  it.each(["free", "pro"] as const)(
    "never sends a saved Opus chat turn to Opus on %s",
    async (tier) => {
      const { server, token, sqlite } = await createApp({ tier });

      try {
        const response = await post(
          server.baseUrl,
          "/api/chat/conversations/conversation-1/messages",
          token,
          { content: "Draft a sentence." },
        );
        const body = await response.text();
        const models = anthropicStream.mock.calls.map(([params]) => (params as any).model);

        expect(response.status).toBe(200);
        expect(body).toContain('"type":"done"');
        expect(models.length).toBeGreaterThan(0);
        expect(models.every((model) => model === "claude-sonnet-5-5")).toBe(true);
        expect(opusRunsUsed(sqlite)).toBe(0);
      } finally {
        await server.close();
      }
    },
  );

  it("runs Premium Opus turns on Claude Opus 5.5 and counts one run per turn", async () => {
    const { server, token, sqlite } = await createApp({ tier: "max", writingModel: "opus" });

    try {
      const response = await post(
        server.baseUrl,
        "/api/chat/conversations/conversation-1/messages",
        token,
        { content: "Draft a sentence." },
      );
      await response.text();
      const chatCall = anthropicStream.mock.calls.at(-1)?.[0] as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(chatCall.model).toBe("claude-opus-5-5");
      expect(chatCall).not.toHaveProperty("temperature");
      expect(chatCall).not.toHaveProperty("thinking");
      expect(opusRunsUsed(sqlite)).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("refuses the 11th Premium Opus run across chat, compile, and verify before spend", async () => {
    const { server, token, sqlite } = await createApp({ tier: "max", writingModel: "opus" });

    try {
      for (let index = 0; index < 10; index += 1) {
        const path =
          index % 3 === 0
            ? "/api/chat/conversations/conversation-1/messages"
            : index % 3 === 1
              ? "/api/chat/conversations/conversation-1/verify"
              : "/api/chat/conversations/conversation-1/compile";
        const response = await post(server.baseUrl, path, token, {
          content: `Draft ${index}.`,
          compiledContent: "# Draft\nA sourced argument.",
        });
        await response.text();
        expect(response.status).toBe(200);
      }
      expect(opusRunsUsed(sqlite)).toBe(10);
      const callsBefore = anthropicStream.mock.calls.length;

      const blocked = await post(
        server.baseUrl,
        "/api/chat/conversations/conversation-1/verify",
        token,
        { compiledContent: "# Draft\nOne more." },
      );
      const blockedBody = (await blocked.json()) as { message: string };

      expect(blocked.status).toBe(429);
      expect(blockedBody.message).toContain("Claude Opus 5.5 runs");
      expect(anthropicStream.mock.calls.length).toBe(callsBefore);
      expect(opusRunsUsed(sqlite)).toBe(10);
    } finally {
      await server.close();
    }
  });

  it("refuses a replayed request ID instead of running a second Opus call on one run", async () => {
    const { server, token, sqlite } = await createApp({ tier: "max", writingModel: "opus" });

    try {
      const first = await post(
        server.baseUrl,
        "/api/chat/conversations/conversation-1/verify",
        token,
        { compiledContent: "# Draft" },
        "fixed-request-id",
      );
      await first.text();
      const callsAfterFirst = anthropicStream.mock.calls.length;
      const replay = await post(
        server.baseUrl,
        "/api/chat/conversations/conversation-1/verify",
        token,
        { compiledContent: "# Draft" },
        "fixed-request-id",
      );
      await replay.text();

      expect(first.status).toBe(200);
      expect(replay.status).toBe(409);
      expect(anthropicStream.mock.calls.length).toBe(callsAfterFirst);
      expect(opusRunsUsed(sqlite)).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("refunds a failed Opus run so a retry does not consume the cap", async () => {
    const { server, token, sqlite } = await createApp({ tier: "max", writingModel: "opus" });
    anthropicStream.mockImplementationOnce(() => {
      const handlers: Record<string, (value: any) => void> = {};
      const stream = {
        on: vi.fn((event: string, handler: (value: any) => void) => {
          handlers[event] = handler;
          if (event === "error") queueMicrotask(() => handlers.error?.(new Error("overloaded")));
          return stream;
        }),
        abort: vi.fn(),
      };
      return stream as any;
    });

    try {
      const failed = await post(
        server.baseUrl,
        "/api/chat/conversations/conversation-1/verify",
        token,
        { compiledContent: "# Draft" },
      );
      expect(await failed.text()).toContain('"type":"error"');
      expect(opusRunsUsed(sqlite)).toBe(0);

      const retry = await post(
        server.baseUrl,
        "/api/chat/conversations/conversation-1/verify",
        token,
        { compiledContent: "# Draft" },
      );
      await retry.text();
      expect(retry.status).toBe(200);
      expect(opusRunsUsed(sqlite)).toBe(1);
    } finally {
      await server.close();
    }
  });

  it.each([
    ["opus", 403],
    ["precision", 403],
    ["claude-opus-5-5", 403],
    ["claude-opus-9-custom", 403],
    ["anthropic/claude-fable-5-1", 403],
    ["gemini-2.5-pro", 400],
  ])("refuses a Pro conversation created with writingModel=%s", async (writingModel, status) => {
    const { server, token, sqlite } = await createApp({ tier: "pro" });

    try {
      const response = await post(server.baseUrl, "/api/chat/conversations", token, {
        title: "Forged",
        writingModel,
        model: "claude-opus-5-5",
      });
      expect(response.status).toBe(status);
      const count = (
        sqlite.prepare("SELECT COUNT(*) count FROM conversations").get() as { count: number }
      ).count;
      expect(count).toBe(1);
      expect(anthropicStream).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("stores the resolved model, not a forged provider ID, on conversation create", async () => {
    const { server, token, sqlite } = await createApp({ tier: "pro" });

    try {
      const response = await post(server.baseUrl, "/api/chat/conversations", token, {
        title: "Legacy GPT choice",
        writingModel: "gpt56",
        model: "claude-opus-5-5",
      });
      const conv = (await response.json()) as { id: string; writingModel: string; model: string };

      expect(response.status).toBe(200);
      expect(conv.writingModel).toBe("sonnet");
      expect(conv.model).toBe("claude-sonnet-5-5");
      const stored = sqlite
        .prepare("SELECT model, writing_model FROM conversations WHERE id = ?")
        .get(conv.id) as { model: string; writing_model: string };
      expect(stored).toEqual({ model: "claude-sonnet-5-5", writing_model: "sonnet" });
    } finally {
      await server.close();
    }
  });

  it("defaults new Starter conversations to Haiku and Pro to Sonnet", async () => {
    const starter = await createApp({ tier: "free" });
    try {
      const response = await post(starter.server.baseUrl, "/api/chat/conversations", starter.token, {
        title: "Default",
      });
      expect(((await response.json()) as { writingModel: string }).writingModel).toBe("haiku");
    } finally {
      await starter.server.close();
    }
  });

  it("refuses a Pro update to Opus and leaves the saved choice unchanged", async () => {
    const { server, token, sqlite } = await createApp({ tier: "pro", writingModel: "sonnet" });

    try {
      const response = await fetch(`${server.baseUrl}/api/chat/conversations/conversation-1`, {
        method: "PUT",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ writingModel: "claude-opus-5-5", model: "claude-opus-5-5" }),
      });
      expect(response.status).toBe(403);
      const stored = sqlite
        .prepare("SELECT model, writing_model FROM conversations WHERE id = ?")
        .get("conversation-1") as { model: string; writing_model: string };
      expect(stored.writing_model).toBe("sonnet");
      expect(stored.model).not.toBe("claude-opus-5-5");
    } finally {
      await server.close();
    }
  });

  it("ignores a forged provider model string on update", async () => {
    const { server, token, sqlite } = await createApp({ tier: "pro", writingModel: "sonnet" });

    try {
      const response = await fetch(`${server.baseUrl}/api/chat/conversations/conversation-1`, {
        method: "PUT",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ title: "Renamed", model: "claude-fable-5-1" }),
      });
      expect(response.status).toBe(200);
      const stored = sqlite
        .prepare("SELECT title, model FROM conversations WHERE id = ?")
        .get("conversation-1") as { title: string; model: string };
      expect(stored).toEqual({ title: "Renamed", model: "claude-opus-4-6" });
    } finally {
      await server.close();
    }
  });

  it("routes a saved DeepSeek choice to Claude Haiku 5.5 without calling OpenRouter", async () => {
    const { server, token } = await createApp({
      tier: "max",
      writingModel: "deepseek/deepseek-v4-pro",
    });

    try {
      const response = await post(
        server.baseUrl,
        "/api/chat/conversations/conversation-1/messages",
        token,
        { content: "Draft a sentence with the selected model." },
      );
      const body = await response.text();
      const chatCall = anthropicStream.mock.calls.at(-1)?.[0] as { model?: string };

      expect(response.status).toBe(200);
      expect(body).toContain('"type":"done"');
      expect(chatCall.model).toBe("claude-haiku-5-5");
    } finally {
      await server.close();
    }
  });

  it("persists document evidence memory for Haiku reader turns", async () => {
    const quote = "Public legitimacy strengthens compliance over time.";
    anthropicCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            newEvidence: [
              {
                sourceId: "source-legitimacy",
                sourceTitle: "Legitimacy Study",
                items: [{ type: "direct_quote", text: quote, location: "highlight" }],
              },
            ],
            sectionsWorkedOn: [{ section: "Section", status: "drafted" }],
          }),
        },
      ],
    });
    streamScript.text = `<document title="Section">A grounded draft uses "${quote}"</document>`;
    const { server, sqlite, token } = await createApp({
      tier: "max",
      writingModel: "haiku",
      withGroundedSource: true,
    });

    try {
      const response = await post(
        server.baseUrl,
        "/api/chat/conversations/conversation-1/messages",
        token,
        { content: "Draft the section." },
      );
      await response.text();
      const stored = sqlite
        .prepare("SELECT evidence_clipboard FROM conversations WHERE id = ?")
        .get("conversation-1") as { evidence_clipboard: string | null };

      expect(response.status).toBe(200);
      expect(anthropicCreate).toHaveBeenCalled();
      const clipboard = JSON.parse(stored.evidence_clipboard || "{}") as {
        evidence?: Array<{ sourceId: string; items: Array<{ text: string }> }>;
      };
      expect(clipboard.evidence).toEqual([
        expect.objectContaining({
          sourceId: "source-legitimacy",
          items: [expect.objectContaining({ text: quote })],
        }),
      ]);
    } finally {
      await server.close();
    }
  });

  it("marks output-limit drafts as non-canonical continuation context", async () => {
    streamScript.text = '<document title="Methods">This section ends mid-sentence';
    streamScript.stopReason = "max_tokens";
    const { server, sqlite, token } = await createApp({ tier: "max", writingModel: "haiku" });

    try {
      const response = await post(
        server.baseUrl,
        "/api/chat/conversations/conversation-1/messages",
        token,
        { content: "Draft the methods section." },
      );
      const body = await response.text();
      const stored = sqlite
        .prepare(
          "SELECT content FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1",
        )
        .get("conversation-1") as { content: string };

      expect(response.status).toBe(200);
      expect(body).toContain("partial draft was saved");
      expect(stored.content).toMatch(/^\[PARTIAL DRAFT - MODEL OUTPUT LIMIT; NOT CANONICAL\]/);
      expect(stored.content).not.toContain("</document>");
    } finally {
      await server.close();
    }
  });

  it("increments the user token budget after a chat response reports usage", async () => {
    const { server, sqlite, token } = await createApp();

    try {
      const response = await post(
        server.baseUrl,
        "/api/chat/conversations/conversation-1/messages",
        token,
        { content: "Draft a sentence." },
      );
      const body = await response.text();
      const userUsage = sqlite
        .prepare("SELECT tokens_used FROM users WHERE id = ?")
        .get("chat-user") as { tokens_used: number };
      const assistantMessage = sqlite
        .prepare("SELECT tokens_used FROM messages WHERE conversation_id = ? AND role = ?")
        .get("conversation-1", "assistant") as { tokens_used: number };

      expect(response.status).toBe(200);
      expect(body).toContain('"type":"writing_status"');
      expect(body).toContain("Preparing selected project sources");
      expect(body).toContain('"type":"done"');
      expect(userUsage.tokens_used).toBe(19);
      expect(assistantMessage.tokens_used).toBe(19);
    } finally {
      await server.close();
    }
  });
});
