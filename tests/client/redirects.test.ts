import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGNED_IN_REDIRECT,
  buildAttributedSignupUrl,
  buildClerkAccountPortalUrl,
  buildDirectSignupUrl,
  getSafeRedirectUrl,
  withRedirectUrl,
} from "../../client/src/lib/redirects";

describe("redirect utilities", () => {
  it("defaults signed-in users to the app dashboard", () => {
    expect(getSafeRedirectUrl("")).toBe(DEFAULT_SIGNED_IN_REDIRECT);
  });

  it("preserves safe in-app redirect targets", () => {
    expect(getSafeRedirectUrl("?redirect_url=%2Faccount")).toBe("/account");
    expect(getSafeRedirectUrl("?redirect_url=%2Fprojects%3Ftab%3Drecent")).toBe(
      "/projects?tab=recent",
    );
    expect(getSafeRedirectUrl("?redirect=%2Fsummer%2Fonboarding")).toBe("/summer/onboarding");
  });

  it("rejects external, protocol-relative, and auth-loop redirect targets", () => {
    expect(getSafeRedirectUrl("?redirect_url=https%3A%2F%2Fevil.example")).toBe(
      DEFAULT_SIGNED_IN_REDIRECT,
    );
    expect(getSafeRedirectUrl("?redirect_url=%2F%2Fevil.example")).toBe(DEFAULT_SIGNED_IN_REDIRECT);
    expect(getSafeRedirectUrl("?redirect_url=%2Fsign-in")).toBe(DEFAULT_SIGNED_IN_REDIRECT);
    expect(getSafeRedirectUrl("?redirect_url=%2Fsign-up")).toBe(DEFAULT_SIGNED_IN_REDIRECT);
  });

  it("rejects backslash and control-character URL parser escapes", () => {
    expect(getSafeRedirectUrl("?redirect_url=%2F%5Cevil.example%2Fsteal")).toBe(
      DEFAULT_SIGNED_IN_REDIRECT,
    );
    expect(getSafeRedirectUrl("?redirect_url=%2Fsafe%0A%2Fnext")).toBe(DEFAULT_SIGNED_IN_REDIRECT);
  });

  it("builds sign-in URLs with encoded return targets", () => {
    expect(withRedirectUrl("/sign-in", "/account?checkout=success")).toBe(
      "/sign-in?redirect_url=%2Faccount%3Fcheckout%3Dsuccess",
    );
  });

  it("builds a hosted Clerk fallback that returns to a safe ScholarMark route", () => {
    expect(
      buildClerkAccountPortalUrl(
        "sign-up",
        "/pricing?onboarding=1&source=summer",
        "https://scholarmark.ai",
      ),
    ).toBe(
      "https://accounts.scholarmark.ai/sign-up?redirect_url=https%3A%2F%2Fscholarmark.ai%2Fpricing%3Fonboarding%3D1%26source%3Dsummer",
    );
  });

  it("does not pass unsafe or recursive redirects to the hosted Clerk fallback", () => {
    expect(
      buildClerkAccountPortalUrl("sign-in", "https://evil.example/steal", "https://scholarmark.ai"),
    ).toBe(
      "https://accounts.scholarmark.ai/sign-in?redirect_url=https%3A%2F%2Fscholarmark.ai%2Fdashboard",
    );
    expect(buildClerkAccountPortalUrl("sign-up", "/sign-up", "https://scholarmark.ai")).toContain(
      "redirect_url=https%3A%2F%2Fscholarmark.ai%2Fdashboard",
    );
  });

  it("builds a short direct-ad signup URL while preserving safe attribution", () => {
    expect(
      buildDirectSignupUrl(
        "?utm_source=ig&utm_medium=paid&utm_campaign=summer&utm_content=reel-2&fbclid=abc123&ignored=secret",
      ),
    ).toBe(
      "/sign-up?redirect_url=%2Fdashboard&utm_source=ig&utm_medium=paid&utm_campaign=summer&utm_content=reel-2&fbclid=abc123",
    );
  });

  it("builds an embedded signup URL with a safe custom return target", () => {
    expect(
      buildAttributedSignupUrl(
        "?utm_source=ig&utm_medium=paid_social&utm_term=thesis&fbclid=abc123&redirect_url=https://evil.example",
        "/pricing?onboarding=1&source=summer",
        true,
      ),
    ).toBe(
      "/sign-up?redirect_url=%2Fpricing%3Fonboarding%3D1%26source%3Dsummer&utm_source=ig&utm_medium=paid_social&utm_term=thesis&fbclid=abc123&embedded_auth=1",
    );

    expect(buildAttributedSignupUrl("", "https://evil.example", true)).toBe(
      "/sign-up?redirect_url=%2Fdashboard&embedded_auth=1",
    );
  });
});
