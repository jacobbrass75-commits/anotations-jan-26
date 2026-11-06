import express from "express";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapTempWorkspace } from "./helpers/bootstrapTempWorkspace";
import { startHttpServer } from "./helpers/http";

const { anthropicCreate } = vi.hoisted(() => ({
  anthropicCreate: vi.fn(async () => ({
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: "Rewritten text." },
    ],
    usage: { input_tokens: 10, output_tokens: 20 },
  })),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: anthropicCreate };
  },
}));

describe("humanizer route model entitlements", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-humanizer-routes-"));
    vi.resetModules();
    vi.clearAllMocks();
    // Mocked SDK only; never inherit real provider keys from the shell.
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("HUMANIZER_ANTHROPIC_MODEL", "");
    process.chdir(tempDir);
    await bootstrapTempWorkspace(tempDir);
  });

  afterEach(async () => {
    sqlite?.close();
    sqlite = null;
    process.chdir(originalCwd);
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createApp(tier: "free" | "pro" | "max") {
    const { db, sqlite: importedSqlite, usageLedger } = await import("../../server/db");
    const { users } = await import("../../shared/schema");
    const { registerHumanizerRoutes } = await import("../../server/humanizerRoutes");
    const { generateToken } = await import("../../server/auth");
    sqlite = importedSqlite;

    const now = new Date("2026-11-01T00:00:00.000Z");
    await db.insert(users).values({
      id: "humanizer-user",
      email: "humanizer@example.com",
      username: "humanizer@example.com",
      password: "",
      tier,
      tokensUsed: 0,
      tokenLimit: 500_000,
      storageUsed: 0,
      storageLimit: 524_288_000,
      emailVerified: true,
      billingCycleStart: now,
      createdAt: now,
      updatedAt: now,
    } as any);

    const app = express();
    app.use(express.json());
    registerHumanizerRoutes(app);
    return {
      sqlite: importedSqlite,
      usageLedger,
      server: await startHttpServer(app),
      token: generateToken({ id: "humanizer-user", email: "humanizer@example.com", tier }),
    };
  }

  function humanize(baseUrl: string, token: string, body: Record<string, unknown>) {
    return fetch(`${baseUrl}/api/humanize`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ text: "Original academic paragraph.", ...body }),
    });
  }

  function opusRows(db: any): Array<{ status: string }> {
    return db.prepare("SELECT status FROM ai_usage_reservations WHERE model = 'opus'").all();
  }

  it.each([
    ["free", "opus", 403],
    ["pro", "opus", 403],
    ["pro", "claude-opus-5-5", 403],
    ["pro", "anthropic/claude-mythos-5-1", 403],
    ["max", "gemini-2.5-pro", 400],
    ["max", "gpt-5.6-sol-but-custom", 200],
  ] as const)("on %s, model=%s returns %s before any Opus spend", async (tier, model, status) => {
    const { server, token, sqlite } = await createApp(tier);
    try {
      const response = await humanize(server.baseUrl, token, { model });
      expect(response.status).toBe(status);
      if (status !== 200) expect(anthropicCreate).not.toHaveBeenCalled();
      expect(opusRows(sqlite)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("uses Sonnet with no sampling parameters when no model is chosen", async () => {
    const { server, token, sqlite } = await createApp("free");
    try {
      const response = await humanize(server.baseUrl, token, { temperature: 0.9 });
      const body = (await response.json()) as { model: string; humanizedText: string };
      const params = anthropicCreate.mock.calls[0][0] as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body).toMatchObject({ model: "claude-sonnet-5-5", humanizedText: "Rewritten text." });
      expect(params).not.toHaveProperty("temperature");
      expect(opusRows(sqlite)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("counts Premium Opus humanizing against the shared Opus run cap", async () => {
    const { server, token, sqlite, usageLedger } = await createApp("max");
    try {
      const first = await humanize(server.baseUrl, token, { model: "opus" });
      expect(first.status).toBe(200);
      expect(((await first.json()) as { model: string }).model).toBe("claude-opus-5-5");
      expect(opusRows(sqlite)).toEqual([{ status: "settled" }]);

      const periodStart = new Date("2026-11-01T00:00:00.000Z");
      for (let index = 0; index < 9; index += 1) {
        expect(
          usageLedger.reserve({
            userId: "humanizer-user",
            requestId: `chat-opus-${index}`,
            tier: "max",
            model: "opus",
            billingPeriodStart: periodStart,
          }),
        ).toMatchObject({ ok: true });
      }
      const callsBefore = anthropicCreate.mock.calls.length;

      const blocked = await humanize(server.baseUrl, token, { model: "opus" });
      expect(blocked.status).toBe(429);
      expect(anthropicCreate.mock.calls.length).toBe(callsBefore);
      expect(opusRows(sqlite)).toHaveLength(10);
    } finally {
      await server.close();
    }
  });

  it("refunds the Opus run when the provider call fails", async () => {
    anthropicCreate.mockRejectedValueOnce(new Error("overloaded"));
    const { server, token, sqlite } = await createApp("max");
    try {
      const response = await humanize(server.baseUrl, token, { model: "opus" });
      expect(response.status).toBe(500);
      expect(opusRows(sqlite)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });
});
