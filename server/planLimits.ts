export type PlanTier = "free" | "pro" | "max";

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

export function defaultVisionModelForTier(tier: string | null | undefined): "gpt-4o" | "gpt-4o-mini" {
  return normalizePlanTier(tier) === "max" ? "gpt-4o" : "gpt-4o-mini";
}

export function requiredTierForVisionModel(model: string): PlanTier {
  return model === "gpt-4o" ? "max" : "pro";
}
