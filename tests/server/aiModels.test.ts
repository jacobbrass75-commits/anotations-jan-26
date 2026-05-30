import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Anthropic model configuration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses Opus 4.6 and Sonnet 4.6 by default", async () => {
    const { ANTHROPIC_MODELS } = await import("../../server/aiModels");

    expect(ANTHROPIC_MODELS.opus).toBe("claude-opus-4-6");
    expect(ANTHROPIC_MODELS.sonnet).toBe("claude-sonnet-4-6");
  });

  it("maps older Opus and Sonnet env values to 4.6", async () => {
    vi.stubEnv("ANTHROPIC_OPUS_MODEL", "claude-opus-4-1-20250805");
    vi.stubEnv("ANTHROPIC_SONNET_MODEL", "claude-sonnet-4-20250514");

    const { ANTHROPIC_MODELS } = await import("../../server/aiModels");

    expect(ANTHROPIC_MODELS.opus).toBe("claude-opus-4-6");
    expect(ANTHROPIC_MODELS.sonnet).toBe("claude-sonnet-4-6");
  });

  it("uses the current Haiku model by default", async () => {
    const { ANTHROPIC_MODELS } = await import("../../server/aiModels");

    expect(ANTHROPIC_MODELS.haiku).toBe("claude-haiku-4-5-20251001");
  });

  it("maps removed Claude 3 Haiku env values to Claude Haiku 4.5", async () => {
    vi.stubEnv("ANTHROPIC_HAIKU_MODEL", "claude-3-haiku-20241022");

    const { ANTHROPIC_MODELS } = await import("../../server/aiModels");

    expect(ANTHROPIC_MODELS.haiku).toBe("claude-haiku-4-5-20251001");
  });

  it("maps removed Claude 3.5 Haiku env values to Claude Haiku 4.5", async () => {
    vi.stubEnv("ANTHROPIC_HAIKU_MODEL", "claude-3-5-haiku-20241022");

    const { ANTHROPIC_MODELS } = await import("../../server/aiModels");

    expect(ANTHROPIC_MODELS.haiku).toBe("claude-haiku-4-5-20251001");
  });
});
