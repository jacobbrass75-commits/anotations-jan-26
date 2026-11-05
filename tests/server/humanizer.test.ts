import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { anthropicCreate } = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: anthropicCreate,
    };
  },
}));

describe("humanizer", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    // Never inherit real provider keys from the developer shell; tests opt in explicitly.
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("HUMANIZER_ANTHROPIC_MODEL", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Unexpected network call in humanizer test");
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects empty text", async () => {
    const { humanizeText } = await import("../../server/humanizer");

    await expect(humanizeText("   ")).rejects.toThrow("Text is required");
  });

  it("rejects oversized text", async () => {
    const { MAX_HUMANIZER_TEXT_LENGTH, humanizeText } = await import("../../server/humanizer");

    await expect(humanizeText("a".repeat(MAX_HUMANIZER_TEXT_LENGTH + 1))).rejects.toThrow(
      `Text exceeds ${MAX_HUMANIZER_TEXT_LENGTH} character limit`,
    );
  });

  it("requires at least one provider key", async () => {
    const { humanizeText } = await import("../../server/humanizer");

    await expect(humanizeText("Hello world")).rejects.toThrow(
      "No humanizer provider key configured",
    );
  });

  it("falls back to Anthropic when Gemini fails", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "rate limited",
      }),
    );
    anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "Humanized output" }],
      usage: { input_tokens: 12, output_tokens: 8 },
    });

    const { humanizeText } = await import("../../server/humanizer");
    const result = await humanizeText("Original text");

    expect(result).toMatchObject({
      humanizedText: "Humanized output",
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      tokensUsed: 20,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    const params = anthropicCreate.mock.calls[0][0];
    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("top_p");
    expect(params).not.toHaveProperty("top_k");
    expect(params).not.toHaveProperty("thinking");
  });

  it("never falls back to Opus, even when an operator override names it", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");
    vi.stubEnv("HUMANIZER_ANTHROPIC_MODEL", "claude-opus-5-5");
    anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "Rewritten" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const { humanizeText } = await import("../../server/humanizer");
    const result = await humanizeText("Original text");

    expect(result.model).toBe("claude-sonnet-5-5");
    expect(anthropicCreate.mock.calls[0][0].model).toBe("claude-sonnet-5-5");
  });

  it("runs an explicit Claude choice on that model and reads text after thinking blocks", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");
    anthropicCreate.mockResolvedValue({
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: "Haiku rewrite" },
      ],
      usage: { input_tokens: 4, output_tokens: 6 },
    });

    const { humanizeText } = await import("../../server/humanizer");
    const result = await humanizeText("Original text", { model: "haiku", temperature: 0.4 });

    expect(fetch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      humanizedText: "Haiku rewrite",
      model: "claude-haiku-5-5",
      inputTokens: 4,
      outputTokens: 6,
    });
    expect(anthropicCreate.mock.calls[0][0]).not.toHaveProperty("temperature");
  });
});
