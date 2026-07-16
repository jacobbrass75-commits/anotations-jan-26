import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/clerk-react", () => ({
  useSignUp: () => ({ isLoaded: false, signUp: undefined, setActive: undefined }),
  useSignIn: () => ({ isLoaded: false, signIn: undefined, setActive: undefined }),
}));

import { EmbeddedSignInForm } from "../../client/src/components/auth/EmbeddedSignInForm";
import { EmbeddedSignUpForm } from "../../client/src/components/auth/EmbeddedSignUpForm";

vi.stubGlobal("React", React);

describe("embedded auth initial markup", () => {
  it("renders native signup fields and CAPTCHA before Clerk finishes loading", () => {
    const html = renderToStaticMarkup(
      React.createElement(EmbeddedSignUpForm, { redirectUrl: "/dashboard" }),
    );

    expect(html).toContain('data-testid="embedded-signup-email"');
    expect(html).toContain('data-testid="embedded-signup-password"');
    expect(html).toContain('id="clerk-captcha"');
    expect(html).toContain("Preparing secure signup");
    expect(html).toContain("Show password");
    expect(html).toContain("Use the secure hosted signup page");
  });

  it("renders native sign-in fields and recovery before Clerk finishes loading", () => {
    const html = renderToStaticMarkup(
      React.createElement(EmbeddedSignInForm, { redirectUrl: "/dashboard" }),
    );

    expect(html).toContain('data-testid="embedded-signin-email"');
    expect(html).toContain('data-testid="embedded-signin-password"');
    expect(html).toContain('id="clerk-captcha"');
    expect(html).toContain("Preparing secure sign-in");
    expect(html).toContain("Use the secure hosted sign-in page");
  });
});
