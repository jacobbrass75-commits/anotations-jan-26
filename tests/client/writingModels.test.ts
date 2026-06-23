import { describe, expect, it } from "vitest";
import {
  WRITING_MODEL_OPTIONS,
  normalizeWritingModelValue,
} from "../../client/src/lib/writingModels";

describe("writing model options", () => {
  it("shows DeepSeek V4 and Gemini OpenRouter writing models", () => {
    const values = WRITING_MODEL_OPTIONS.map((option) => option.value);

    expect(values).toContain("deepseek/deepseek-v4-pro");
    expect(values).toContain("deepseek/deepseek-v4-flash");
    expect(values).toContain("google/gemini-3.1-pro-preview");
    expect(values).toContain("google/gemini-3.5-flash");
    expect(values).toContain("google/gemini-3.1-flash-lite");
    expect(values).toContain("google/gemini-2.5-pro");
    expect(values).toContain("google/gemini-2.5-flash");
  });

  it("keeps valid model selections and falls back safely", () => {
    expect(normalizeWritingModelValue("deepseek/deepseek-v4-pro")).toBe(
      "deepseek/deepseek-v4-pro",
    );
    expect(normalizeWritingModelValue("not-a-real-model")).toBe("precision");
  });
});
