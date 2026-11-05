// Single source of truth for advertised ScholarMark plan prices.
// Server checkout validation, the Stripe/PayPal config endpoints, and client
// pricing copy all read from here so the displayed and charged amounts cannot drift.

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

export const MAX_PRICE_OFFERS = {
  usd50Monthly: {
    id: "max_usd50_monthly",
    amountCents: 5000,
    currency: "usd",
    interval: "month",
    lookupKey: "scholarmark_max_monthly",
  },
} as const satisfies Record<string, BillingPriceOffer>;

// The offer sold to new checkouts. Rolling back the price is a one-line change here;
// recognition of every offer above stays in place.
export const CURRENT_PRICE_OFFERS: Record<BillingTier, BillingPriceOffer> = {
  pro: PRO_PRICE_OFFERS.usd5Monthly,
  max: MAX_PRICE_OFFERS.usd50Monthly,
};

export const KNOWN_PRICE_OFFERS: Record<BillingTier, readonly BillingPriceOffer[]> = {
  pro: Object.values(PRO_PRICE_OFFERS),
  max: Object.values(MAX_PRICE_OFFERS),
};

export const BILLING_PLAN_LABELS: Record<BillingTier, string> = {
  pro: "Pro",
  max: "Max",
};

export function formatUsdAmount(amountCents: number): string {
  const dollars = amountCents / 100;
  return Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
}

export const PLAN_DISPLAY_PRICES: Record<BillingTier, string> = {
  pro: formatUsdAmount(CURRENT_PRICE_OFFERS.pro.amountCents),
  max: formatUsdAmount(CURRENT_PRICE_OFFERS.max.amountCents),
};
