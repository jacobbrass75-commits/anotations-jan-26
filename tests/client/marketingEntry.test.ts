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

  it("keeps paid Instagram traffic on the campaign landing page by default", () => {
    expect(
      getPaidInstagramSignupRedirect(
        "scholarmark.ai",
        "/",
        "?utm_source=ig&utm_medium=paid&utm_campaign=120254753679600309&utm_content=120254753681570309&fbclid=abc123&ignored=secret",
      ),
    ).toBeNull();

    expect(
      getPaidInstagramSignupRedirect(
        "www.scholarmark.ai",
        "/start",
        "?utm_source=Instagram&utm_medium=paid_social&utm_campaign=summer",
      ),
    ).toBeNull();
  });

  it("allows controlled direct-signup tests only with explicit opt-in", () => {
    const redirect = getPaidInstagramSignupRedirect(
      "scholarmark.ai",
      "/",
      `?utm_source=ig&utm_medium=paid&sm_direct_signup=1&utm_term=thesis&utm_id=meta-42&utm_content=${"x".repeat(205)}&ignored=secret`,
    );
    const params = new URL(redirect!, "https://scholarmark.ai").searchParams;

    expect(params.get("utm_term")).toBe("thesis");
    expect(params.get("utm_id")).toBe("meta-42");
    expect(params.get("utm_content")).toBe("x".repeat(200));
    expect(params.has("ignored")).toBe(false);
    expect(params.get("embedded_auth")).toBe("1");
    expect(params.get("sm_direct_signup")).toBe("1");
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
      getPaidInstagramSignupRedirect(
        "scholarmark.ai",
        "/",
        "?utm_source=ig&utm_medium=organic&sm_direct_signup=1",
      ),
    ).toBeNull();
    expect(
      getPaidInstagramSignupRedirect(
        "scholarmark.ai",
        "/",
        "?utm_source=facebook&utm_medium=paid&sm_direct_signup=1",
      ),
    ).toBeNull();
    expect(
      getPaidInstagramSignupRedirect(
        "scholarmark.ai",
        "/",
        "?utm_source=ig&utm_medium=paid&sm_direct_signup=1&sm_landing=1",
      ),
    ).toBeNull();
    expect(
      getPaidInstagramSignupRedirect(
        "scholarmark.ai",
        "/sign-up",
        "?utm_source=ig&utm_medium=paid&sm_direct_signup=1",
      ),
    ).toBeNull();
    expect(
      getPaidInstagramSignupRedirect(
        "accounts.scholarmark.ai",
        "/",
        "?utm_source=ig&utm_medium=paid&sm_direct_signup=1",
      ),
    ).toBeNull();
  });
});
