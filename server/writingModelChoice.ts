import { ANTHROPIC_MODELS } from "./aiModels";
import {
  defaultWritingModelForTier,
  isWritingModelAllowedForTier,
  type WritingModelChoice,
} from "./planLimits";

const MODEL_LABELS: Record<WritingModelChoice, string> = {
  opus: "Claude Opus 5.5",
  sonnet: "Claude Sonnet 5.5",
  haiku: "Claude Haiku 5.5",
};

export function writingModelLabel(choice: WritingModelChoice): string {
  return MODEL_LABELS[choice];
}

export function anthropicModelForChoice(choice: WritingModelChoice): string {
  return ANTHROPIC_MODELS[choice];
}

/**
 * Maps current, legacy, and provider-ID values onto an in-app model choice.
 * Unrecognized values return null so explicit requests can be rejected.
 *
 * Retired choices keep working for saved conversations: GPT maps to Sonnet (the
 * flagship-writing slot) and DeepSeek to Haiku (the value slot). Any Opus, Fable, or
 * Mythos provider ID, including custom or forged ones, resolves to the premium Opus
 * choice so the Premium gate applies before any spend.
 */
export function parseWritingModelChoice(value: unknown): WritingModelChoice | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized === "opus" || normalized === "sonnet" || normalized === "haiku") {
    return normalized;
  }
  if (normalized === "precision") return "opus";
  if (normalized === "extended") return "sonnet";
  if (/^(gpt|openai\/)/.test(normalized)) return "sonnet";
  if (/^deepseek/.test(normalized)) return "haiku";

  const anthropicId = normalized.replace(/^anthropic[./]/, "");
  if (/(^|[^a-z])(opus|fable|mythos)([^a-z]|$)/.test(anthropicId)) return "opus";
  if (/(^|[^a-z])sonnet([^a-z]|$)/.test(anthropicId)) return "sonnet";
  if (/(^|[^a-z])haiku([^a-z]|$)/.test(anthropicId)) return "haiku";
  return null;
}

/**
 * The model a saved conversation actually runs on for this tier. Saved choices the
 * tier no longer covers (for example Opus after a downgrade) fall back to Sonnet;
 * unknown saved values fall back to the tier default.
 */
export function resolveEffectiveWritingModel(
  saved: unknown,
  tier: string | null | undefined,
): WritingModelChoice {
  const parsed = parseWritingModelChoice(saved);
  if (!parsed) return defaultWritingModelForTier(tier);
  if (isWritingModelAllowedForTier(parsed, tier)) return parsed;
  return isWritingModelAllowedForTier("sonnet", tier) ? "sonnet" : defaultWritingModelForTier(tier);
}

export type RequestedWritingModel =
  | { ok: true; model: WritingModelChoice }
  | { ok: false; status: 400 | 403; message: string };

/** Validates an explicit model request (create, update, humanize) before any spend. */
export function resolveRequestedWritingModel(
  requested: unknown,
  tier: string | null | undefined,
): RequestedWritingModel {
  const parsed = parseWritingModelChoice(requested);
  if (!parsed) {
    return {
      ok: false,
      status: 400,
      message: "Unsupported model. Choose Claude Opus 5.5, Claude Sonnet 5.5, or Claude Haiku 5.5.",
    };
  }
  if (!isWritingModelAllowedForTier(parsed, tier)) {
    return {
      ok: false,
      status: 403,
      message: `${writingModelLabel(parsed)} requires the Premium plan. Choose Claude Sonnet 5.5 or Claude Haiku 5.5.`,
    };
  }
  return { ok: true, model: parsed };
}
