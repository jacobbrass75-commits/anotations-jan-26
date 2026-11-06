// Single source of truth for advertised ScholarMark plan prices and plan copy.
// Server checkout validation, the Stripe/PayPal config endpoints, and client
// pricing copy all read from here so the displayed and charged amounts cannot drift.
//
// The internal tier IDs never change: "pro" is Pro and "max" is the plan shown to
// customers as Premium. Stored user tiers, Stripe metadata, and PayPal rows keep using
// "max", so legacy Max subscribers are Premium subscribers without any data migration.

export type BillingTier = "pro" | "max";

export interface BillingPriceOffer {
  id: string;
  amountCents: number;
  currency: "usd";
  interval: "month";
  lookupKey: string;
}

// Every Pro price ScholarMark has sold. Entitlement checks recognize all of them so
// existing subscribers keep access when the checkout offer changes.
// The legacy USD 14 Pro price is still Pro. It shares its amount with Premium but must
// never be mapped to Premium; see server/stripeBillingRoutes.ts.
export const PRO_PRICE_OFFERS = {
  usd14Monthly: {
    id: "pro_usd14_monthly",
    amountCents: 1400,
    currency: "usd",
    interval: "month",
    lookupKey: "scholarmark_pro_monthly",
  },
  usd5Monthly: {
    id: "pro_usd5_monthly",
    amountCents: 500,
    currency: "usd",
    interval: "month",
    lookupKey: "scholarmark_pro_monthly_usd5",
  },
} as const satisfies Record<string, BillingPriceOffer>;

// Every Premium (internal "max") price ScholarMark has sold. Legacy USD 50 Max
// subscribers keep Premium entitlements and renew at USD 50 until they change plans.
export const MAX_PRICE_OFFERS = {
  usd50Monthly: {
    id: "max_usd50_monthly",
    amountCents: 5000,
    currency: "usd",
    interval: "month",
    lookupKey: "scholarmark_max_monthly",
  },
  usd14Monthly: {
    id: "max_usd14_monthly",
    amountCents: 1400,
    currency: "usd",
    interval: "month",
    lookupKey: "scholarmark_max_monthly_usd14",
  },
} as const satisfies Record<string, BillingPriceOffer>;

// The offer sold to new checkouts. Rolling back a price is a one-line change here;
// recognition of every offer above stays in place.
export const CURRENT_PRICE_OFFERS: Record<BillingTier, BillingPriceOffer> = {
  pro: PRO_PRICE_OFFERS.usd5Monthly,
  max: MAX_PRICE_OFFERS.usd14Monthly,
};

export const KNOWN_PRICE_OFFERS: Record<BillingTier, readonly BillingPriceOffer[]> = {
  pro: Object.values(PRO_PRICE_OFFERS),
  max: Object.values(MAX_PRICE_OFFERS),
};

export function tierForLookupKey(lookupKey: string | null | undefined): BillingTier | null {
  if (!lookupKey) {
    return null;
  }
  for (const tier of ["pro", "max"] as const) {
    if (KNOWN_PRICE_OFFERS[tier].some((offer) => offer.lookupKey === lookupKey)) {
      return tier;
    }
  }
  return null;
}

export const BILLING_PLAN_LABELS: Record<BillingTier, string> = {
  pro: "Pro",
  max: "Premium",
};

export function formatUsdAmount(amountCents: number): string {
  const dollars = amountCents / 100;
  return Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
}

export const PLAN_DISPLAY_PRICES: Record<BillingTier, string> = {
  pro: formatUsdAmount(CURRENT_PRICE_OFFERS.pro.amountCents),
  max: formatUsdAmount(CURRENT_PRICE_OFFERS.max.amountCents),
};

// Advertised model access. Enforcement lives in the model routing and usage policy;
// this copy must stay in step with it.
export const ADVERTISED_MODELS = {
  sonnet: "Claude Sonnet 5.5",
  haiku: "Claude Haiku 5.5",
  opus: "Claude Opus 5.5",
} as const;

// Opus runs per existing monthly usage window, Premium only.
export const PREMIUM_OPUS_RUNS_PER_MONTH = 10;

export const PLAN_MODEL_ACCESS: Record<BillingTier, readonly string[]> = {
  pro: [`${ADVERTISED_MODELS.sonnet} and ${ADVERTISED_MODELS.haiku}`],
  max: [
    `${ADVERTISED_MODELS.sonnet} and ${ADVERTISED_MODELS.haiku}`,
    `Up to ${PREMIUM_OPUS_RUNS_PER_MONTH} ${ADVERTISED_MODELS.opus} runs per month`,
  ],
};

export const MODEL_ACCESS_DISCLAIMER =
  "Model access is subject to your plan's monthly AI credits, cost ceiling, and usage limits.";

// Optional host-side AI: the user's own Claude or ChatGPT/Codex account does the AI
// work through the ScholarMark MCP connector, and ScholarMark only stores the results.
// Setup steps match docs/integrations/host-ai-mode.md.
export const SCHOLARMARK_MCP_URL = "https://mcp.scholarmark.ai/mcp";

export const HOST_AI_CONNECTOR_SETUP = [
  {
    host: "Claude",
    path: "Customize > Connectors > Add custom connector",
  },
  {
    host: "ChatGPT",
    path: "Plugins (chatgpt.com/plugins) > + > Add custom MCP server",
  },
  {
    host: "Codex",
    path: "Add the same URL as a remote MCP server",
  },
] as const;

export const HOST_AI_CONNECTOR_SUMMARY =
  "Optional: connect ScholarMark to Claude or ChatGPT/Codex and use your own AI account for the reading and annotating. ScholarMark stores the results, and connector requests do not use ScholarMark AI credits. Your Claude or ChatGPT plan's own limits and terms apply.";

export function planPriceLabel(tier: BillingTier): string {
  return `${BILLING_PLAN_LABELS[tier]} ($${PLAN_DISPLAY_PRICES[tier]}/mo)`;
}

// Plain-language billing terms shown next to checkout and in the Terms.
export function planBillingTerms(tier: BillingTier): string {
  const price = PLAN_DISPLAY_PRICES[tier];
  return `Charged $${price} USD today. Renews monthly at $${price} USD until canceled. Cancel online in the billing portal; access continues through the paid period.`;
}
