export type PlanTier = "free" | "pro" | "max";

export type WritingCreditModel = "opus" | "gpt" | "sonnet" | "deepseek";

export interface AiUsagePlan {
  credits: number;
  costCeilingCents: number;
  periodDays: number;
}

function configuredInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export const AI_USAGE_PLANS: Record<PlanTier, AiUsagePlan> = {
  free: {
    credits: configuredInt("AI_STARTER_CREDITS", 60),
    costCeilingCents: configuredInt("AI_STARTER_COST_CEILING_CENTS", 60),
    periodDays: 30,
  },
  pro: {
    credits: configuredInt("AI_PRO_CREDITS", 600),
    costCeilingCents: configuredInt("AI_PRO_COST_CEILING_CENTS", 450),
    periodDays: 30,
  },
  max: {
    credits: configuredInt("AI_MAX_CREDITS", 2400),
    costCeilingCents: configuredInt("AI_MAX_COST_CEILING_CENTS", 1800),
    periodDays: 30,
  },
};

export const WRITING_CREDIT_WEIGHTS: Record<WritingCreditModel, number> = {
  opus: 30,
  gpt: 20,
  sonnet: 10,
  deepseek: 2,
};

export const STARTER_MODEL_USE_LIMITS: Partial<Record<WritingCreditModel, number>> = {
  opus: 1,
  gpt: 1,
};

export function getAiUsagePlan(tier: string | null | undefined): AiUsagePlan {
  return AI_USAGE_PLANS[normalizePlanTier(tier)];
}

const TIER_LEVELS: Record<PlanTier, number> = {
  free: 0,
  pro: 1,
  max: 2,
};

const DOCUMENT_LIMITS: Record<PlanTier, number | null> = {
  free: 5,
  pro: 50,
  max: null,
};

const PROJECT_LIMITS: Record<PlanTier, number | null> = {
  free: 1,
  pro: 10,
  max: null,
};

const PROJECT_SOURCE_LIMITS: Record<PlanTier, number | null> = {
  free: 5,
  pro: 50,
  max: null,
};

export function normalizePlanTier(tier: string | null | undefined): PlanTier {
  if (tier === "pro" || tier === "max") {
    return tier;
  }
  return "free";
}

export function tierMeetsMinimum(tier: string | null | undefined, minimum: PlanTier): boolean {
  return TIER_LEVELS[normalizePlanTier(tier)] >= TIER_LEVELS[minimum];
}

export function getDocumentLimit(tier: string | null | undefined): number | null {
  return DOCUMENT_LIMITS[normalizePlanTier(tier)];
}

export function getProjectLimit(tier: string | null | undefined): number | null {
  return PROJECT_LIMITS[normalizePlanTier(tier)];
}

export function getProjectSourceLimit(tier: string | null | undefined): number | null {
  return PROJECT_SOURCE_LIMITS[normalizePlanTier(tier)];
}

export function defaultVisionModelForTier(
  tier: string | null | undefined,
): "gpt-4o" | "gpt-4o-mini" {
  return normalizePlanTier(tier) === "max" ? "gpt-4o" : "gpt-4o-mini";
}

export function requiredTierForVisionModel(model: string): PlanTier {
  return model === "gpt-4o" ? "max" : "pro";
}
