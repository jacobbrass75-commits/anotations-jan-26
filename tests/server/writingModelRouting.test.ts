import { afterEach, describe, expect, it } from "vitest";
import { getModelsForConversation, normalizeWritingModel } from "../../server/chat/promptBuilder";

describe("writing model routing", () => {
  afterEach(() => delete process.env.ENABLE_DEEPSEEK_WRITING);

  it.each([
    ["opus", "anthropic", "claude-opus-4-8"],
    ["sonnet", "anthropic", "claude-sonnet-5"],
    ["gpt56", "openrouter", "openai/gpt-5.6-sol"],
  ])("routes %s without silently changing its identity", (choice, provider, id) => {
    const routed = getModelsForConversation({ writingModel: choice });
    expect(routed.provider).toBe(provider);
    expect(routed.chat).toBe(id);
  });

  it("enables the Starter value model by default and supports an explicit opt-out", () => {
    expect(normalizeWritingModel("deepseek")).toBe("deepseek");
    process.env.ENABLE_DEEPSEEK_WRITING = "false";
    expect(normalizeWritingModel("deepseek")).toBe("sonnet");
    process.env.ENABLE_DEEPSEEK_WRITING = "true";
    expect(getModelsForConversation({ writingModel: "deepseek" })).toMatchObject({
      provider: "openrouter",
      chat: "deepseek/deepseek-v4-pro",
    });
  });

  it("migrates legacy modes and defaults unknown ids to Sonnet", () => {
    expect(normalizeWritingModel("precision")).toBe("opus");
    expect(normalizeWritingModel("extended")).toBe("sonnet");
    expect(normalizeWritingModel("unknown")).toBe("sonnet");
  });
});
