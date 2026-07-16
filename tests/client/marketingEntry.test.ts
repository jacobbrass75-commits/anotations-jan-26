import { describe, expect, it } from "vitest";
import { isFastMarketingEntry } from "../../client/src/lib/marketingEntry";

describe("fast marketing entry", () => {
  it.each(["/", "/start", "/summer", "/summer/offer", "/invite", "/invite/code123"])(
    "loads %s without waiting for Clerk",
    (pathname) => {
      expect(isFastMarketingEntry("scholarmark.ai", pathname)).toBe(true);
    },
  );

  it("does not bypass Clerk for authentication or app routes", () => {
    expect(isFastMarketingEntry("scholarmark.ai", "/sign-up")).toBe(false);
    expect(isFastMarketingEntry("scholarmark.ai", "/dashboard")).toBe(false);
    expect(isFastMarketingEntry("accounts.scholarmark.ai", "/start")).toBe(false);
  });
});
