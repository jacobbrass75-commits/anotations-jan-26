import { describe, expect, it } from "vitest";
import type { SetActive, SetActiveParams } from "@clerk/shared/types";
import { activateClerkSession } from "../../client/src/lib/clerkSession";
import {
  deriveEmbeddedSignUpStep,
  findEmailCodeSecondFactor,
  getRequiredProfileFields,
} from "../../client/src/lib/embeddedAuthFlow";

function signUpSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    status: "missing_requirements" as const,
    createdSessionId: null,
    emailAddress: "student@example.edu",
    missingFields: [],
    unverifiedFields: ["email_address"],
    ...overrides,
  };
}

describe("embedded Clerk flow state", () => {
  it("only opens email verification after every required field is present", () => {
    expect(deriveEmbeddedSignUpStep(signUpSnapshot())).toBe("verification");
    expect(deriveEmbeddedSignUpStep(signUpSnapshot({ missingFields: ["first_name"] }))).toBe(
      "profile",
    );
    expect(deriveEmbeddedSignUpStep(signUpSnapshot({ missingFields: ["phone_number"] }))).toBe(
      "unsupported",
    );
  });

  it("restores details, profile, and complete signup states", () => {
    expect(deriveEmbeddedSignUpStep(null)).toBe("details");
    expect(deriveEmbeddedSignUpStep(signUpSnapshot({ missingFields: ["password"] }))).toBe(
      "details",
    );
    expect(
      getRequiredProfileFields(
        signUpSnapshot({ missingFields: ["first_name", "last_name", "legal_accepted"] }),
      ),
    ).toEqual(["first_name", "last_name", "legal_accepted"]);
    expect(
      deriveEmbeddedSignUpStep(
        signUpSnapshot({ status: "complete", createdSessionId: "sess_complete" }),
      ),
    ).toBe("complete");
    expect(deriveEmbeddedSignUpStep(signUpSnapshot({ status: "complete" }))).toBe("recovery");
  });

  it("selects an email-code second factor for client trust or MFA", () => {
    expect(
      findEmailCodeSecondFactor({
        supportedSecondFactors: [
          { strategy: "totp" },
          {
            strategy: "email_code",
            emailAddressId: "idn_email",
            safeIdentifier: "s***@example.edu",
          },
        ],
      }),
    ).toMatchObject({ strategy: "email_code", emailAddressId: "idn_email" });
    expect(
      findEmailCodeSecondFactor({ supportedSecondFactors: [{ strategy: "totp" }] }),
    ).toBeNull();
  });

  it("routes pending Clerk session tasks to the hosted recovery flow", async () => {
    let params: SetActiveParams | undefined;
    const assigned: string[] = [];
    const setActive = (async (value: SetActiveParams) => {
      params = value;
    }) as SetActive;

    await activateClerkSession({
      setActive,
      sessionId: "sess_123",
      redirectUrl: "/dashboard",
      taskFallbackUrl: "https://accounts.scholarmark.ai/sign-in",
      assign: (url) => assigned.push(url),
    });

    expect(params?.session).toBe("sess_123");
    await params?.navigate?.({
      session: { currentTask: { key: "choose-organization" } },
    } as never);
    expect(assigned).toEqual(["https://accounts.scholarmark.ai/sign-in"]);
  });

  it("opens the requested destination when Clerk has no pending session task", async () => {
    let params: SetActiveParams | undefined;
    const assigned: string[] = [];
    const setActive = (async (value: SetActiveParams) => {
      params = value;
    }) as SetActive;

    await activateClerkSession({
      setActive,
      sessionId: "sess_456",
      redirectUrl: "/dashboard",
      taskFallbackUrl: "https://accounts.scholarmark.ai/sign-in",
      assign: (url) => assigned.push(url),
    });

    await params?.navigate?.({ session: { currentTask: null } } as never);
    expect(assigned).toEqual(["/dashboard"]);
  });
});
