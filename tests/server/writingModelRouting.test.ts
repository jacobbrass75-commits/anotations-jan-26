import { describe, expect, it } from "vitest";
import { WRITING_MODEL_OPTIONS } from "../../client/src/lib/writingModels";
import {
  isOpenRouterWritingModelId,
  OPENROUTER_WRITING_MODEL_IDS,
} from "../../server/openRouterWriting";
import { getModelsForConversation, normalizeWritingModel } from "../../server/chat/promptBuilder";

describe("writing model routing", () => {
  const clientModelValues = WRITING_MODEL_OPTIONS.map((option) => option.value);

  it("keeps the client model picker in sync with server-supported writing models", () => {
    expect(clientModelValues).toEqual(["precision", "extended", ...OPENROUTER_WRITING_MODEL_IDS]);
  });

  it("routes every exposed writing chat model to a usable provider/model set", () => {
    for (const modelValue of clientModelValues) {
      expect(normalizeWritingModel(modelValue)).toBe(modelValue);

      const routed = getModelsForConversation({ writingModel: modelValue }, "max");
      if (isOpenRouterWritingModelId(modelValue)) {
        expect(routed).toEqual({
          provider: "openrouter",
          chat: modelValue,
          compile: modelValue,
          verify: modelValue,
        });
      } else {
        expect(routed.provider).toBe("anthropic");
        expect(routed.chat).toMatch(/^claude-/);
        expect(routed.compile).toMatch(/^claude-/);
        expect(routed.verify).toMatch(/^claude-/);
      }
    }
  });

  it("falls back to precision for unknown writing chat model ids", () => {
    expect(normalizeWritingModel("not-a-real-model")).toBe("precision");
    expect(getModelsForConversation({ writingModel: "not-a-real-model" }, "max").provider).toBe(
      "anthropic",
    );
  });
});
