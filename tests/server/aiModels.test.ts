import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Anthropic model configuration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
