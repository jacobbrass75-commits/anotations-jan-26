export const WRITING_MODEL_OPTIONS = [
  { value: "precision", label: "Precision (Opus)" },
  { value: "extended", label: "Extended (Sonnet)" },
  { value: "moonshotai/kimi-k2.6", label: "Kimi K2.6" },
  { value: "moonshotai/kimi-k2.5", label: "Kimi K2.5" },
  { value: "z-ai/glm-5", label: "GLM 5" },
  { value: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { value: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { value: "openai/gpt-5.5", label: "GPT-5.5" },
  { value: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
  { value: "google/gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { value: "google/gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite" },
  { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "anthropic/claude-opus-4.8", label: "Claude Opus 4.8" },
] as const;

export type WritingModelValue = (typeof WRITING_MODEL_OPTIONS)[number]["value"];

export function normalizeWritingModelValue(value: string | null | undefined): WritingModelValue {
  return WRITING_MODEL_OPTIONS.some((option) => option.value === value)
    ? (value as WritingModelValue)
    : "precision";
}
