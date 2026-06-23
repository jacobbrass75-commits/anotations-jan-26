import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGNED_IN_REDIRECT,
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
    expect(getSafeRedirectUrl("?redirect_url=%2F%2Fevil.example")).toBe(
      DEFAULT_SIGNED_IN_REDIRECT,
    );
    expect(getSafeRedirectUrl("?redirect_url=%2Fsign-in")).toBe(DEFAULT_SIGNED_IN_REDIRECT);
    expect(getSafeRedirectUrl("?redirect_url=%2Fsign-up")).toBe(DEFAULT_SIGNED_IN_REDIRECT);
  });

  it("builds sign-in URLs with encoded return targets", () => {
    expect(withRedirectUrl("/sign-in", "/account?checkout=success")).toBe(
      "/sign-in?redirect_url=%2Faccount%3Fcheckout%3Dsuccess",
    );
  });
});
