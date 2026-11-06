import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Anthropic model configuration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the Claude 5.5 models by default", async () => {
    const { ANTHROPIC_MODELS } = await import("../../server/aiModels");

    expect(ANTHROPIC_MODELS).toEqual({
      opus: "claude-opus-5-5",
      sonnet: "claude-sonnet-5-5",
      haiku: "claude-haiku-5-5",
    });
  });

  it("no longer configures a Fable model", async () => {
    const { ANTHROPIC_MODELS } = await import("../../server/aiModels");

    expect(Object.keys(ANTHROPIC_MODELS)).toEqual(["opus", "sonnet", "haiku"]);
  });

  it.each([
    ["ANTHROPIC_OPUS_MODEL", "claude-opus-4-1-20250805", "opus", "claude-opus-5-5"],
    ["ANTHROPIC_OPUS_MODEL", "claude-opus-4-8", "opus", "claude-opus-5-5"],
    ["ANTHROPIC_SONNET_MODEL", "claude-sonnet-4-20250514", "sonnet", "claude-sonnet-5-5"],
    ["ANTHROPIC_SONNET_MODEL", "claude-sonnet-5", "sonnet", "claude-sonnet-5-5"],
    ["ANTHROPIC_HAIKU_MODEL", "claude-3-5-haiku-20241022", "haiku", "claude-haiku-5-5"],
    ["ANTHROPIC_HAIKU_MODEL", "claude-haiku-4-5-20251001", "haiku", "claude-haiku-5-5"],
  ] as const)("maps retired %s=%s to the 5.5 model", async (envName, value, key, expected) => {
    vi.stubEnv(envName, value);

    const { ANTHROPIC_MODELS } = await import("../../server/aiModels");

    expect(ANTHROPIC_MODELS[key]).toBe(expected);
  });
});
