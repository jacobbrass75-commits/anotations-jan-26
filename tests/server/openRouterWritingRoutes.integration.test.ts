import express from "express";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapTempWorkspace } from "./helpers/bootstrapTempWorkspace";
import { requestJson, startHttpServer } from "./helpers/http";

describe("OpenRouter writing model test routes", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();
  const originalOpenRouterApiKey = process.env.OPENROUTER_API_KEY;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-openrouter-writing-"));
    vi.resetModules();
    vi.clearAllMocks();
    process.chdir(tempDir);
    process.env.OPENROUTER_API_KEY = "sk-or-test";
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

  async function createApp(options: { tier?: "free" | "pro" | "max"; budgetUsed?: number } = {}) {
    const { db, sqlite: importedSqlite } = await import("../../server/db");
    const { users } = await import("../../shared/schema");
    const { generateToken } = await import("../../server/auth");
    const { registerOpenRouterWritingRoutes } = await import("../../server/openRouterWritingRoutes");

    sqlite = importedSqlite;

    const now = new Date("2026-06-22T00:00:00.000Z");
    await db.insert(users).values({
      id: "openrouter-user",
      email: "openrouter@example.com",
      username: "openrouter@example.com",
      password: "",
      tier: options.tier ?? "pro",
      tokensUsed: 0,
      tokenLimit: 500_000,
      aiBudgetMicrodollarsUsed: options.budgetUsed ?? 0,
      storageUsed: 0,
      storageLimit: 524_288_000,
      createdAt: now,
      updatedAt: now,
    } as any);

    const app = express();
    app.use(express.json());
    registerOpenRouterWritingRoutes(app);

    return {
      server: await startHttpServer(app),
      token: generateToken({
        id: "openrouter-user",
        email: "openrouter@example.com",
        tier: options.tier ?? "pro",
      }),
      sqlite: importedSqlite,
    };
  }

  function mockOpenRouterFetch() {
    const originalFetch = globalThis.fetch.bind(globalThis);
    const chatBodies: unknown[] = [];
    const models = [
      catalogModel("moonshotai/kimi-k2.6", "0.00000066", "0.00000341", 262_144),
      catalogModel("moonshotai/kimi-k2.5", "0.000000375", "0.000002025", 262_144),
      catalogModel("z-ai/glm-5", "0.0000006", "0.00000192", 202_752),
      catalogModel("deepseek/deepseek-v4-pro", "0.000000435", "0.00000087", 1_048_576),
      catalogModel("deepseek/deepseek-v4-flash", "0.00000009", "0.00000018", 1_048_576),
      catalogModel("openai/gpt-5.5", "0.000005", "0.00003", 1_050_000),
      catalogModel("google/gemini-3.1-pro-preview", "0.000002", "0.000012", 1_048_576),
      catalogModel("google/gemini-3.5-flash", "0.0000015", "0.000009", 1_048_576),
      catalogModel("google/gemini-3.1-flash-lite", "0.00000025", "0.0000015", 1_048_576),
      catalogModel("google/gemini-2.5-pro", "0.00000125", "0.00001", 1_048_576),
      catalogModel("google/gemini-2.5-flash", "0.0000003", "0.0000025", 1_048_576),
      catalogModel("anthropic/claude-opus-4.8", "0.000005", "0.000025", 1_000_000),
    ];

    vi.spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
      const url =
        typeof input === "string" || input instanceof URL ? input.toString() : input.url;
      if (url === "https://openrouter.ai/api/v1/models") {
        return new Response(JSON.stringify({ data: models }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "https://openrouter.ai/api/v1/chat/completions") {
        chatBodies.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(
          JSON.stringify({
            id: "or-test-generation",
            model: "openai/gpt-5.5",
            choices: [{ message: { content: "A precise, vivid paragraph for the writing test." } }],
            usage: { prompt_tokens: 50, completion_tokens: 100, total_tokens: 150 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch);

    return { chatBodies };
  }

  function catalogModel(id: string, prompt: string, completion: string, contextLength: number) {
    return {
      id,
      pricing: { prompt, completion },
      context_length: contextLength,
    };
  }

  it("lists every requested model with the real DeepSeek and Gemini catalog IDs", async () => {
    mockOpenRouterFetch();
    const { server, token } = await createApp({ tier: "pro" });

    try {
      const response = await requestJson<{
        generationSettings: { temperature: number; maxTokens: number; systemPrompt: string };
        budget: { limitUsd: number; remainingUsd: number };
        models: Array<{ id: string; available: boolean }>;
      }>(server.baseUrl, "/api/write/test-models", {
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.status).toBe(200);
      expect(response.body?.generationSettings).toEqual({
        temperature: 0.8,
        maxTokens: 800,
        systemPrompt: "You are a skilled prose writer.",
      });
      expect(response.body?.budget).toMatchObject({ limitUsd: 7, remainingUsd: 7 });
      expect(response.body?.models.map((model) => model.id)).toEqual([
        "moonshotai/kimi-k2.6",
        "moonshotai/kimi-k2.5",
        "z-ai/glm-5",
        "deepseek/deepseek-v4-pro",
        "deepseek/deepseek-v4-flash",
        "openai/gpt-5.5",
        "google/gemini-3.1-pro-preview",
        "google/gemini-3.5-flash",
        "google/gemini-3.1-flash-lite",
        "google/gemini-2.5-pro",
        "google/gemini-2.5-flash",
        "anthropic/claude-opus-4.8",
      ]);
      expect(response.body?.models.every((model) => model.available)).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("runs a writing test with fixed generation settings and charges actual OpenRouter cost", async () => {
    const { chatBodies } = mockOpenRouterFetch();
    const { server, sqlite, token } = await createApp({ tier: "pro" });

    try {
      const response = await requestJson<{
        output: string;
        usage: { totalTokens: number };
        costUsd: number;
        budget: { usedUsd: number; remainingUsd: number };
      }>(server.baseUrl, "/api/write/test-models/run", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: {
          model: "openai/gpt-5.5",
          prompt: "Write one polished paragraph about annotation-backed research confidence.",
        },
      });
      const user = sqlite
        .prepare("SELECT ai_budget_microdollars_used FROM users WHERE id = ?")
        .get("openrouter-user") as { ai_budget_microdollars_used: number };

      expect(response.status).toBe(200);
      expect(response.body?.output).toContain("precise, vivid paragraph");
      expect(response.body?.usage.totalTokens).toBe(150);
      expect(response.body?.costUsd).toBe(0.00325);
      expect(user.ai_budget_microdollars_used).toBe(3250);
      expect(response.body?.budget).toMatchObject({ usedUsd: 0.00325 });
      expect(chatBodies).toHaveLength(1);
      expect(chatBodies[0]).toMatchObject({
        model: "openai/gpt-5.5",
        temperature: 0.8,
        max_tokens: 800,
        messages: [
          { role: "system", content: "You are a skilled prose writer." },
          {
            role: "user",
            content: "Write one polished paragraph about annotation-backed research confidence.",
          },
        ],
      });
    } finally {
      await server.close();
    }
  });

  it("blocks writing tests that would exceed the plan dollar budget before calling chat", async () => {
    const { chatBodies } = mockOpenRouterFetch();
    const { server, token } = await createApp({
      tier: "pro",
      budgetUsed: 6_999_000,
    });

    try {
      const response = await requestJson(server.baseUrl, "/api/write/test-models/run", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: {
          model: "openai/gpt-5.5",
          prompt: "Write one polished paragraph about budget enforcement for expensive models.",
        },
      });

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        message: "OpenRouter writing model test budget exceeded",
      });
      expect(chatBodies).toHaveLength(0);
    } finally {
      await server.close();
    }
  });
});
