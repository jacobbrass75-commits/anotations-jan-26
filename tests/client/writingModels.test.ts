import { describe, expect, it } from "vitest";
import {
  CORE_WRITING_MODEL_OPTIONS,
  normalizeWritingModelValue,
} from "../../client/src/lib/writingModels";

describe("writing model options", () => {
  it("exposes the three default privacy-approved models with stable keys", () => {
    expect(
      CORE_WRITING_MODEL_OPTIONS.map(({ value, providerModelId }) => [value, providerModelId]),
    ).toEqual([
      ["opus", "claude-opus-4-8"],
      ["sonnet", "claude-sonnet-5"],
      ["gpt56", "gpt-5.6-sol"],
    ]);
  });

  it("falls back to the safe Sonnet default", () => {
    expect(normalizeWritingModelValue("not-a-real-model")).toBe("sonnet");
  });
});
