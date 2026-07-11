import express from "express";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapTempWorkspace } from "./helpers/bootstrapTempWorkspace";
import { startHttpServer } from "./helpers/http";

const { anthropicCreate, anthropicStream } = vi.hoisted(() => ({
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
            handlers.text?.("Budgeted chat answer.");
            handlers.message?.({ usage: { input_tokens: 12, output_tokens: 7 } });
          });
        }
        return stream;
      }),
      abort: vi.fn(),
    };
    return stream;
  }),
}));

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

describe("chat route integration", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();
  const originalOpenRouterApiKey = process.env.OPENROUTER_API_KEY;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-chat-routes-"));
    vi.resetModules();
    vi.clearAllMocks();
    process.chdir(tempDir);
    await bootstrapTempWorkspace(tempDir);
  });

  afterEach(async () => {
    sqlite?.close();
    sqlite = null;
    process.chdir(originalCwd);
    if (originalOpenRouterApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalOpenRouterApiKey;
    }
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createApp(options: { tier?: "free" | "pro" | "max"; writingModel?: string } = {}) {
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
      selectedSourceIds: null,
      createdAt: now,
      updatedAt: now,
    } as any);

    const app = express();
    app.use(express.json());
    registerChatRoutes(app);

    return {
      db,
      sqlite: importedSqlite,
      server: await startHttpServer(app),
      token: generateToken({
        id: "chat-user",
        email: "chat@example.com",
        tier: options.tier ?? "pro",
      }),
    };
  }

  function mockOpenRouterFetch() {
    const originalFetch = globalThis.fetch.bind(globalThis);
    const chatBodies: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
      const url = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
      if (url === "https://openrouter.ai/api/v1/models") {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "deepseek/deepseek-v4-pro",
                pricing: { prompt: "0.000000435", completion: "0.00000087" },
                context_length: 1_048_576,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "https://openrouter.ai/api/v1/chat/completions") {
        chatBodies.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(
          JSON.stringify({
            id: "or-chat-test",
            choices: [{ message: { content: "OpenRouter drafted this sentence." } }],
            usage: {
              prompt_tokens: 50,
              completion_tokens: 100,
              total_tokens: 150,
              cost: 0.000123,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch);

    return { chatBodies };
  }

  it("uses the selected Opus allowance for free source verification", async () => {
    const { server, token } = await createApp({ tier: "free" });

    try {
      const response = await fetch(
        `${server.baseUrl}/api/chat/conversations/conversation-1/verify`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ compiledContent: "# Draft\nA sourced argument." }),
        },
      );
      const body = await response.text();
      const verifyCall = anthropicStream.mock.calls.at(-1)?.[0] as { model?: string };

      expect(response.status).toBe(200);
      expect(body).toContain("Budgeted chat answer.");
      expect(body).toContain('"type":"done"');
      expect(verifyCall.model).toBe("claude-opus-4-8");
    } finally {
      await server.close();
    }
  });

  it("uses the truthful Opus model for free precision chat turns", async () => {
    const { server, token } = await createApp({ tier: "free" });

    try {
      const response = await fetch(
        `${server.baseUrl}/api/chat/conversations/conversation-1/messages`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ content: "Draft a sentence." }),
        },
      );
      const body = await response.text();
      const chatCall = anthropicStream.mock.calls.at(-1)?.[0] as { model?: string };

      expect(response.status).toBe(200);
      expect(body).toContain('"type":"done"');
      expect(chatCall.model).toBe("claude-opus-4-8");
    } finally {
      await server.close();
    }
  });

  it("routes OpenRouter writing model chat turns through OpenRouter", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const { chatBodies } = mockOpenRouterFetch();
    const { server, sqlite, token } = await createApp({
      tier: "max",
      writingModel: "deepseek/deepseek-v4-pro",
    });
    process.env.ENABLE_DEEPSEEK_WRITING = "true";

    try {
      const response = await fetch(
        `${server.baseUrl}/api/chat/conversations/conversation-1/messages`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ content: "Draft a sentence with the selected model." }),
        },
      );
      const body = await response.text();
      const userUsage = sqlite
        .prepare("SELECT tokens_used, ai_budget_microdollars_used FROM users WHERE id = ?")
        .get("chat-user") as {
        tokens_used: number;
        ai_budget_microdollars_used: number;
      };

      expect(response.status).toBe(200);
      expect(body).toContain("OpenRouter drafted this sentence.");
      expect(body).toContain('"type":"done"');
      expect(anthropicStream).not.toHaveBeenCalled();
      expect(chatBodies).toHaveLength(1);
      expect(chatBodies[0]).toMatchObject({
        model: "deepseek/deepseek-v4-pro",
        temperature: 0.8,
        max_tokens: 8192,
      });
      expect(userUsage.tokens_used).toBe(150);
      expect(userUsage.ai_budget_microdollars_used).toBe(123);
    } finally {
      await server.close();
    }
  });

  it("increments the user token budget after a chat response reports usage", async () => {
    const { server, sqlite, token } = await createApp();

    try {
      const response = await fetch(
        `${server.baseUrl}/api/chat/conversations/conversation-1/messages`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ content: "Draft a sentence." }),
        },
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
