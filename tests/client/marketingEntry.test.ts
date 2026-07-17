import { describe, expect, it } from "vitest";
import {
  getPaidInstagramSignupRedirect,
  isFastMarketingEntry,
  isPaidInstagramCampaign,
  isPaidInstagramDirectSignup,
} from "../../client/src/lib/marketingEntry";

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

  it("sends paid Instagram traffic directly to embedded signup with attribution", () => {
    expect(
      getPaidInstagramSignupRedirect(
        "scholarmark.ai",
        "/",
        "?utm_source=ig&utm_medium=paid&utm_campaign=120254753679600309&utm_content=120254753681570309&fbclid=abc123&ignored=secret",
      ),
    ).toBe(
      "/sign-up?redirect_url=%2Fdashboard&utm_source=ig&utm_medium=paid&utm_campaign=120254753679600309&utm_content=120254753681570309&fbclid=abc123&embedded_auth=1&sm_direct_signup=1",
    );

    expect(
      getPaidInstagramSignupRedirect(
        "www.scholarmark.ai",
        "/start",
        "?utm_source=Instagram&utm_medium=paid_social&utm_campaign=summer",
      ),
    ).toBe(
      "/sign-up?redirect_url=%2Fdashboard&utm_source=Instagram&utm_medium=paid_social&utm_campaign=summer&embedded_auth=1&sm_direct_signup=1",
    );
  });

  it("preserves every allowlisted attribution field and caps campaign values", () => {
    const redirect = getPaidInstagramSignupRedirect(
      "scholarmark.ai",
      "/",
      `?utm_source=ig&utm_medium=paid&utm_term=thesis&utm_id=meta-42&utm_content=${"x".repeat(205)}&ignored=secret`,
    );
    const params = new URL(redirect!, "https://scholarmark.ai").searchParams;

    expect(params.get("utm_term")).toBe("thesis");
    expect(params.get("utm_id")).toBe("meta-42");
    expect(params.get("utm_content")).toBe("x".repeat(200));
    expect(params.has("ignored")).toBe(false);
  });

  it("recognizes normalized paid Instagram attribution", () => {
    expect(isPaidInstagramCampaign("?utm_source=ig&utm_medium=paid")).toBe(true);
    expect(isPaidInstagramCampaign("?utm_source=Instagram&utm_medium=paid_social")).toBe(true);
    expect(isPaidInstagramCampaign("?utm_source=instagram.com&utm_medium=CPC")).toBe(true);
    expect(isPaidInstagramCampaign("?utm_source=ig&utm_medium=organic")).toBe(false);
  });

  it("distinguishes a direct signup redirect from a landing-page CTA", () => {
    expect(isPaidInstagramDirectSignup("?utm_source=ig&utm_medium=paid&sm_direct_signup=1")).toBe(
      true,
    );
    expect(isPaidInstagramDirectSignup("?utm_source=ig&utm_medium=paid")).toBe(false);
  });

  it("keeps organic, non-Instagram, opted-out, and non-entry traffic on its page", () => {
    expect(
      getPaidInstagramSignupRedirect("scholarmark.ai", "/", "?utm_source=ig&utm_medium=organic"),
    ).toBeNull();
    expect(
      getPaidInstagramSignupRedirect("scholarmark.ai", "/", "?utm_source=facebook&utm_medium=paid"),
    ).toBeNull();
    expect(
      getPaidInstagramSignupRedirect(
        "scholarmark.ai",
        "/",
        "?utm_source=ig&utm_medium=paid&sm_landing=1",
      ),
    ).toBeNull();
    expect(
      getPaidInstagramSignupRedirect(
        "scholarmark.ai",
        "/sign-up",
        "?utm_source=ig&utm_medium=paid",
      ),
    ).toBeNull();
    expect(
      getPaidInstagramSignupRedirect(
        "accounts.scholarmark.ai",
        "/",
        "?utm_source=ig&utm_medium=paid",
      ),
    ).toBeNull();
  });
});
