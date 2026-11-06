// The only in-app model choices. Plan access is enforced server-side; the client uses
// requiredTier to show which choices a plan includes.
export const WRITING_MODEL_OPTIONS = [
  {
    value: "opus",
    label: "Claude Opus 5.5",
    description: "Highest quality · Premium",
    providerModelId: "claude-opus-5-5",
    requiredTier: "max",
  },
  {
    value: "sonnet",
    label: "Claude Sonnet 5.5",
    description: "Fast + capable",
    providerModelId: "claude-sonnet-5-5",
    requiredTier: "free",
  },
  {
    value: "haiku",
    label: "Claude Haiku 5.5",
    description: "Fastest, best value",
    providerModelId: "claude-haiku-5-5",
    requiredTier: "free",
  },
] as const;

export type WritingModelValue = (typeof WRITING_MODEL_OPTIONS)[number]["value"];

export function isWritingModelAvailableForTier(
  value: WritingModelValue,
  tier: string | null | undefined,
): boolean {
  return value !== "opus" || tier === "max";
}

export function defaultWritingModelForTier(tier: string | null | undefined): WritingModelValue {
  return tier === "max" || tier === "pro" ? "sonnet" : "haiku";
}

/**
 * Maps saved and legacy values onto a current choice. Retired GPT choices map to
 * Sonnet and DeepSeek to Haiku; Opus/Fable/Mythos IDs map to Opus.
 */
export function normalizeWritingModelValue(value: string | null | undefined): WritingModelValue {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized === "opus" || normalized === "sonnet" || normalized === "haiku") {
    return normalized;
  }
  if (normalized === "precision") return "opus";
  if (normalized === "extended") return "sonnet";
  if (/^(gpt|openai\/)/.test(normalized)) return "sonnet";
  if (/^deepseek/.test(normalized)) return "haiku";
  const anthropicId = normalized.replace(/^anthropic[./]/, "");
  if (/(^|[^a-z])(opus|fable|mythos)([^a-z]|$)/.test(anthropicId)) return "opus";
  if (/(^|[^a-z])haiku([^a-z]|$)/.test(anthropicId)) return "haiku";
  return "sonnet";
}

/** The choice to show for a saved value on this plan, mirroring the server fallback. */
export function effectiveWritingModelForTier(
  value: string | null | undefined,
  tier: string | null | undefined,
): WritingModelValue {
  if (!value) return defaultWritingModelForTier(tier);
  const normalized = normalizeWritingModelValue(value);
  return isWritingModelAvailableForTier(normalized, tier) ? normalized : "sonnet";
}
