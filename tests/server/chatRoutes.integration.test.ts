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
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createApp(options: { tier?: "free" | "pro" | "max" } = {}) {
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
      writingModel: "precision",
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

  it("allows free source verification with the Sonnet verifier model", async () => {
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
      expect(verifyCall.model).toBe("claude-sonnet-4-6");
    } finally {
      await server.close();
    }
  });

  it("uses Haiku for free precision chat turns", async () => {
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
      expect(chatCall.model).toBe("claude-haiku-4-5-20251001");
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
