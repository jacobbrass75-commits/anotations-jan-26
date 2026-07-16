import { describe, expect, it } from "vitest";
import { isRecentlyCreatedAccount } from "../../client/src/components/SignupAnalyticsTracker";

describe("signup analytics", () => {
  const now = Date.parse("2026-07-16T18:00:00.000Z");

  it("accepts only newly created accounts as registration conversions", () => {
    expect(isRecentlyCreatedAccount("2026-07-16T17:45:00.000Z", now)).toBe(true);
    expect(isRecentlyCreatedAccount("2026-07-16T16:00:00.000Z", now)).toBe(false);
    expect(isRecentlyCreatedAccount("invalid", now)).toBe(false);
  });
});
