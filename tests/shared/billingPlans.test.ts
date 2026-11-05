import { describe, expect, it } from "vitest";
import {
  CURRENT_PRICE_OFFERS,
  KNOWN_PRICE_OFFERS,
  PLAN_DISPLAY_PRICES,
  formatUsdAmount,
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

  it("keeps Max at USD 50 per month", () => {
    expect(CURRENT_PRICE_OFFERS.max).toMatchObject({
      amountCents: 5000,
      lookupKey: "scholarmark_max_monthly",
    });
    expect(PLAN_DISPLAY_PRICES.max).toBe("50");
  });

  it("still recognizes the legacy USD 14 Pro lookup key", () => {
    expect(KNOWN_PRICE_OFFERS.pro.map((offer) => offer.lookupKey)).toEqual(
      expect.arrayContaining(["scholarmark_pro_monthly", "scholarmark_pro_monthly_usd5"]),
    );
  });

  it("never reuses a lookup key across offers or tiers", () => {
    const lookupKeys = [...KNOWN_PRICE_OFFERS.pro, ...KNOWN_PRICE_OFFERS.max].map(
      (offer) => offer.lookupKey,
    );
    expect(new Set(lookupKeys).size).toBe(lookupKeys.length);
  });

  it("formats whole and fractional dollar amounts", () => {
    expect(formatUsdAmount(500)).toBe("5");
    expect(formatUsdAmount(1250)).toBe("12.50");
  });
});
