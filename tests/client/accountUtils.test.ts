import { describe, expect, it } from "vitest";
import {
  formatAccountBytes,
  formatAccountDate,
  formatAccountTier,
  formatUsagePercent,
  hasConfirmedPaidStripeAccess,
  stripCheckoutReturnParams,
} from "../../client/src/lib/accountUtils";

describe("account utilities", () => {
  it("formats plan labels for display", () => {
    expect(formatAccountTier("free")).toBe("Free");
    expect(formatAccountTier("pro")).toBe("Pro");
    expect(formatAccountTier("max")).toBe("Max");
    expect(formatAccountTier("unknown")).toBe("Free");
  });

  it("clamps usage percentages into a safe display range", () => {
    expect(formatUsagePercent(25, 100)).toBe(25);
    expect(formatUsagePercent(200, 100)).toBe(100);
    expect(formatUsagePercent(10, 0)).toBe(0);
  });

  it("formats bytes and dates for account summaries", () => {
    expect(formatAccountBytes(0)).toBe("0 B");
    expect(formatAccountBytes(1_048_576)).toBe("1.00 MB");
    expect(formatAccountDate("2026-03-30T12:00:00.000Z")).toContain("2026");
    expect(formatAccountDate(null)).toBe("Not available");
  });

  it("recognizes active paid Stripe access", () => {
    expect(
      hasConfirmedPaidStripeAccess({
        tier: "pro",
        stripeSubscriptionId: "sub_123",
        subscriptionStatus: "active",
      }),
    ).toBe(true);
    expect(
      hasConfirmedPaidStripeAccess({
        tier: "max",
        stripeSubscriptionId: "sub_123",
        subscriptionStatus: "trialing",
      }),
    ).toBe(true);
    expect(
      hasConfirmedPaidStripeAccess({
        tier: "free",
        stripeSubscriptionId: "sub_123",
        subscriptionStatus: "active",
      }),
    ).toBe(false);
    expect(
      hasConfirmedPaidStripeAccess({
        tier: "pro",
        stripeSubscriptionId: null,
        subscriptionStatus: "active",
      }),
    ).toBe(false);
  });

  it("removes checkout return params without dropping other URL state", () => {
    expect(
      stripCheckoutReturnParams(
        "https://app.scholarmark.ai/account?checkout=success&session_id=cs_123&tab=billing#usage",
      ),
    ).toBe("/account?tab=billing#usage");
    expect(stripCheckoutReturnParams("/account?checkout=success")).toBe("/account");
  });
});
