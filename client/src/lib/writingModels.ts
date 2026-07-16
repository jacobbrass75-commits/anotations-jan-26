export const CORE_WRITING_MODEL_OPTIONS = [
  {
    value: "opus",
    label: "Claude Opus 4.8",
    description: "Highest quality",
    providerModelId: "claude-opus-4-8",
  },
  {
    value: "sonnet",
    label: "Claude Sonnet 5",
    description: "Fast + capable",
    providerModelId: "claude-sonnet-5",
  },
  {
    value: "gpt56",
    label: "GPT-5.6 Sol",
    description: "Flagship writing quality",
    providerModelId: "gpt-5.6-sol",
  },
] as const;

export const DEEPSEEK_WRITING_MODEL_OPTION = {
  value: "deepseek",
  label: "DeepSeek V4 Pro",
  description: "Best value",
  providerModelId: "deepseek-v4-pro",
} as const;

// DeepSeek is the Starter value model. Deployments can explicitly disable it when needed.
export const WRITING_MODEL_OPTIONS = [
  ...CORE_WRITING_MODEL_OPTIONS,
  ...(import.meta.env.VITE_ENABLE_DEEPSEEK_WRITING !== "false"
    ? [DEEPSEEK_WRITING_MODEL_OPTION]
    : []),
] as const;

export type WritingModelValue = "opus" | "sonnet" | "gpt56" | "deepseek";

export function normalizeWritingModelValue(value: string | null | undefined): WritingModelValue {
  const legacyValue =
    value === "precision" || value === "anthropic/claude-opus-4.8"
      ? "opus"
      : value === "extended"
        ? "sonnet"
        : value === "gpt55" ||
            value === "openai/gpt-5.5" ||
            value === "openai/gpt-5.5-2026-04-23" ||
            value === "openai/gpt-5.6-sol"
          ? "gpt56"
          : value === "deepseek/deepseek-v4-pro"
            ? "deepseek"
            : value;
  return WRITING_MODEL_OPTIONS.some((option) => option.value === value)
    ? (value as WritingModelValue)
    : WRITING_MODEL_OPTIONS.some((option) => option.value === legacyValue)
      ? (legacyValue as WritingModelValue)
      : "sonnet";
}
