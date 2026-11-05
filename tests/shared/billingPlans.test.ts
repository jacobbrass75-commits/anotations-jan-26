import { describe, expect, it } from "vitest";
import {
  BILLING_PLAN_LABELS,
  CURRENT_PRICE_OFFERS,
  KNOWN_PRICE_OFFERS,
  PLAN_DISPLAY_PRICES,
  PLAN_MODEL_ACCESS,
  PREMIUM_OPUS_RUNS_PER_MONTH,
  formatUsdAmount,
  planBillingTerms,
  planPriceLabel,
  tierForLookupKey,
} from "../../shared/billingPlans";

describe("billing plans", () => {
  it("sells Pro at exactly USD 5 per month", () => {
    expect(CURRENT_PRICE_OFFERS.pro).toMatchObject({
      amountCents: 500,
      currency: "usd",
      interval: "month",
      lookupKey: "scholarmark_pro_monthly_usd5",
    });
    expect(PLAN_DISPLAY_PRICES.pro).toBe("5");
  });

  it("sells the internal max tier as Premium at exactly USD 14 per month", () => {
    expect(CURRENT_PRICE_OFFERS.max).toMatchObject({
      id: "max_usd14_monthly",
      amountCents: 1400,
      currency: "usd",
      interval: "month",
      lookupKey: "scholarmark_max_monthly_usd14",
    });
    expect(PLAN_DISPLAY_PRICES.max).toBe("14");
    expect(BILLING_PLAN_LABELS).toEqual({ pro: "Pro", max: "Premium" });
    expect(planPriceLabel("max")).toBe("Premium ($14/mo)");
  });

  it("still recognizes the legacy USD 14 Pro and USD 50 Max lookup keys", () => {
    expect(KNOWN_PRICE_OFFERS.pro.map((offer) => offer.lookupKey)).toEqual(
      expect.arrayContaining(["scholarmark_pro_monthly", "scholarmark_pro_monthly_usd5"]),
    );
    expect(KNOWN_PRICE_OFFERS.max.map((offer) => offer.lookupKey)).toEqual(
      expect.arrayContaining(["scholarmark_max_monthly", "scholarmark_max_monthly_usd14"]),
    );
  });

  it("maps the legacy USD 14 Pro lookup key to Pro, never Premium", () => {
    expect(tierForLookupKey("scholarmark_pro_monthly")).toBe("pro");
    expect(tierForLookupKey("scholarmark_pro_monthly_usd5")).toBe("pro");
    expect(tierForLookupKey("scholarmark_max_monthly")).toBe("max");
    expect(tierForLookupKey("scholarmark_max_monthly_usd14")).toBe("max");
    expect(tierForLookupKey("something_else")).toBeNull();
    expect(tierForLookupKey(null)).toBeNull();
  });

  it("never reuses a lookup key across offers or tiers", () => {
    const lookupKeys = [...KNOWN_PRICE_OFFERS.pro, ...KNOWN_PRICE_OFFERS.max].map(
      (offer) => offer.lookupKey,
    );
    expect(new Set(lookupKeys).size).toBe(lookupKeys.length);
  });

  it("advertises Sonnet and Haiku on Pro and adds capped Opus on Premium", () => {
    expect(PLAN_MODEL_ACCESS.pro).toEqual(["Claude Sonnet 5.5 and Claude Haiku 5.5"]);
    expect(PLAN_MODEL_ACCESS.max).toEqual([
      "Claude Sonnet 5.5 and Claude Haiku 5.5",
      "Up to 10 Claude Opus 5.5 runs per month",
    ]);
    expect(PREMIUM_OPUS_RUNS_PER_MONTH).toBe(10);
    expect(PLAN_MODEL_ACCESS.pro.join(" ")).not.toContain("Opus");
  });

  it("states USD billing terms for both paid plans", () => {
    expect(planBillingTerms("pro")).toContain("$5 USD today");
    expect(planBillingTerms("max")).toContain("Renews monthly at $14 USD");
  });

  it("formats whole and fractional dollar amounts", () => {
    expect(formatUsdAmount(500)).toBe("5");
    expect(formatUsdAmount(1250)).toBe("12.50");
  });
});
