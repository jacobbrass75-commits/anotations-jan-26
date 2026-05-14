import express from "express";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapTempWorkspace } from "./helpers/bootstrapTempWorkspace";
import { startHttpServer } from "./helpers/http";

const { anthropicCreate } = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(function AnthropicMock() {
    return {
      messages: {
        create: anthropicCreate,
      },
    };
  }),
}));

describe("writing route integration", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-writing-routes-"));
    vi.resetModules();
    vi.clearAllMocks();
    process.chdir(tempDir);
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    await bootstrapTempWorkspace(tempDir);
  });

  afterEach(async () => {
    sqlite?.close();
    sqlite = null;
    process.chdir(originalCwd);
    delete process.env.ANTHROPIC_API_KEY;
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createApp() {
    const { db, sqlite: importedSqlite } = await import("../../server/db");
    const { users } = await import("../../shared/schema");
    const { registerWritingRoutes } = await import("../../server/writingRoutes");
    const { generateToken } = await import("../../server/auth");

    sqlite = importedSqlite;

    const now = new Date("2026-05-05T00:00:00.000Z");
    await db.insert(users).values({
      id: "writing-user",
      email: "writing@example.com",
      username: "writing@example.com",
      password: "",
      tier: "pro",
      tokensUsed: 90,
      tokenLimit: 1000,
      storageUsed: 0,
      storageLimit: 524_288_000,
      createdAt: now,
      updatedAt: now,
    } as any);

    const app = express();
    app.use(express.json());
    registerWritingRoutes(app);

    return {
      db,
      sqlite: importedSqlite,
      token: generateToken({ id: "writing-user", email: "writing@example.com", tier: "pro" }),
      server: await startHttpServer(app),
    };
  }

  it("records Anthropic token usage for completed writing jobs", async () => {
    const { server, sqlite, token } = await createApp();
    anthropicCreate
      .mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              thesis: "ScholarMark improves research workflows.",
              bibliography: [],
              sections: [
                {
                  title: "Introduction",
                  description: "Set up the argument.",
                  sourceIds: [],
                  targetWords: 100,
                },
              ],
            }),
          },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "## Introduction\nA focused draft section." }],
        usage: { input_tokens: 30, output_tokens: 40 },
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "# Complete Paper\nA focused draft section." }],
        usage: { input_tokens: 50, output_tokens: 60 },
      });

    try {
      const response = await fetch(`${server.baseUrl}/api/write`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          topic: "Research workflows",
          citationStyle: "chicago",
          tone: "academic",
          targetLength: "short",
        }),
      });
      const text = await response.text();
      const userAfterWrite = sqlite
        .prepare("SELECT tokens_used FROM users WHERE id = ?")
        .get("writing-user") as { tokens_used: number };

      expect(response.status).toBe(200);
      expect(text).toContain('"type":"complete"');
      expect(text).toContain('"usage":{"inputTokens":90,"outputTokens":120}');
      expect(text).toContain("data: [DONE]");
      expect(userAfterWrite.tokens_used).toBe(300);
    } finally {
      await server.close();
    }
  });
});
