import { describe, expect, it } from "vitest";
import { getModelsForConversation, normalizeWritingModel } from "../../server/chat/promptBuilder";
import {
  parseWritingModelChoice,
  resolveEffectiveWritingModel,
  resolveRequestedWritingModel,
} from "../../server/writingModelChoice";

describe("writing model routing", () => {
  it.each([
    ["opus", "claude-opus-5-5"],
    ["sonnet", "claude-sonnet-5-5"],
    ["haiku", "claude-haiku-5-5"],
  ])("routes Premium %s to %s on Anthropic", (choice, id) => {
    const routed = getModelsForConversation({ writingModel: choice }, "max");
    expect(routed).toMatchObject({ provider: "anthropic", choice, chat: id, verify: id });
  });

  it.each(["free", "pro", null, undefined])(
    "never routes a saved Opus choice to Opus for tier %s",
    (tier) => {
      expect(getModelsForConversation({ writingModel: "opus" }, tier)).toMatchObject({
        provider: "anthropic",
        choice: "sonnet",
        chat: "claude-sonnet-5-5",
      });
    },
  );

  it.each([
    ["gpt56", "sonnet"],
    ["gpt55", "sonnet"],
    ["openai/gpt-5.6-sol", "sonnet"],
    ["deepseek", "haiku"],
    ["deepseek/deepseek-v4-pro", "haiku"],
    ["precision", "opus"],
    ["extended", "sonnet"],
    ["anthropic/claude-opus-4.8", "opus"],
    ["claude-fable-5-1", "opus"],
    ["claude-mythos-5-1", "opus"],
    ["claude-haiku-4-5-20251001", "haiku"],
    ["CLAUDE-SONNET-5-5", "sonnet"],
  ])("maps saved/legacy value %s to %s", (value, expected) => {
    expect(parseWritingModelChoice(value)).toBe(expected);
  });

  it("never routes retired GPT or DeepSeek choices to OpenRouter", () => {
    for (const writingModel of ["gpt56", "deepseek", "deepseek/deepseek-v4-pro"]) {
      for (const tier of ["free", "pro", "max"]) {
        expect(getModelsForConversation({ writingModel }, tier).provider).toBe("anthropic");
      }
    }
  });

  it("falls back to the tier default for unknown saved values", () => {
    expect(resolveEffectiveWritingModel("not-a-model", "free")).toBe("haiku");
    expect(resolveEffectiveWritingModel("not-a-model", "pro")).toBe("sonnet");
    expect(resolveEffectiveWritingModel(null, "max")).toBe("sonnet");
    expect(normalizeWritingModel("unknown")).toBe("sonnet");
  });

  it("refuses explicit Opus, Fable, and custom Opus IDs below Premium", () => {
    for (const requested of ["opus", "precision", "claude-opus-5-5", "claude-opus-9", "claude-fable-5-1"]) {
      for (const tier of ["free", "pro"]) {
        expect(resolveRequestedWritingModel(requested, tier)).toMatchObject({
          ok: false,
          status: 403,
        });
      }
      expect(resolveRequestedWritingModel(requested, "max")).toEqual({ ok: true, model: "opus" });
    }
  });

  it("rejects unrecognized explicit model IDs and accepts Sonnet/Haiku on every plan", () => {
    expect(resolveRequestedWritingModel("gemini-2.5-pro", "max")).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(resolveRequestedWritingModel(42, "max")).toMatchObject({ ok: false, status: 400 });
    for (const tier of ["free", "pro", "max"]) {
      expect(resolveRequestedWritingModel("sonnet", tier)).toEqual({ ok: true, model: "sonnet" });
      expect(resolveRequestedWritingModel("haiku", tier)).toEqual({ ok: true, model: "haiku" });
    }
  });
});
