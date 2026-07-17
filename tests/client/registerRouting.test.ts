import { describe, expect, it } from "vitest";
import { shouldRedirectSignedInUser } from "../../client/src/pages/Register";

describe("signup route auth guard", () => {
  it("redirects only after Clerk confirms an active signed-in session", () => {
    expect(shouldRedirectSignedInUser(false, true)).toBe(false);
    expect(shouldRedirectSignedInUser(true, false)).toBe(false);
    expect(shouldRedirectSignedInUser(true, undefined)).toBe(false);
    expect(shouldRedirectSignedInUser(true, true)).toBe(true);
  });
});
