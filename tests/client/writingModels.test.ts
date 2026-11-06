import { describe, expect, it } from "vitest";
import {
  WRITING_MODEL_OPTIONS,
  effectiveWritingModelForTier,
  isWritingModelAvailableForTier,
  normalizeWritingModelValue,
} from "../../client/src/lib/writingModels";

describe("writing model options", () => {
  it("offers exactly Claude Opus, Sonnet, and Haiku 5.5", () => {
    expect(
      WRITING_MODEL_OPTIONS.map(({ value, label, providerModelId }) => [
        value,
        label,
        providerModelId,
      ]),
    ).toEqual([
      ["opus", "Claude Opus 5.5", "claude-opus-5-5"],
      ["sonnet", "Claude Sonnet 5.5", "claude-sonnet-5-5"],
      ["haiku", "Claude Haiku 5.5", "claude-haiku-5-5"],
    ]);
  });

  it("only makes Opus available on Premium", () => {
    expect(isWritingModelAvailableForTier("opus", "max")).toBe(true);
    expect(isWritingModelAvailableForTier("opus", "pro")).toBe(false);
    expect(isWritingModelAvailableForTier("opus", "free")).toBe(false);
    expect(isWritingModelAvailableForTier("haiku", "free")).toBe(true);
  });

  it.each([
    ["gpt56", "sonnet"],
    ["deepseek", "haiku"],
    ["deepseek/deepseek-v4-pro", "haiku"],
    ["precision", "opus"],
    ["claude-fable-5-1", "opus"],
    ["not-a-real-model", "sonnet"],
  ])("maps saved value %s to %s", (value, expected) => {
    expect(normalizeWritingModelValue(value)).toBe(expected);
  });

  it("shows the server's fallback for saved Opus below Premium", () => {
    expect(effectiveWritingModelForTier("opus", "pro")).toBe("sonnet");
    expect(effectiveWritingModelForTier("opus", "max")).toBe("opus");
    expect(effectiveWritingModelForTier(null, "free")).toBe("haiku");
    expect(effectiveWritingModelForTier(undefined, "pro")).toBe("sonnet");
  });
});
