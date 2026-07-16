import { describe, expect, it } from "vitest";
import {
  getClerkErrorCode,
  getClerkErrorDetails,
  getClerkErrorMessage,
} from "../../client/src/lib/clerkErrors";

describe("Clerk error helpers", () => {
  it("extracts Clerk's stable code and user-facing long message", () => {
    const error = {
      errors: [
        {
          code: "form_identifier_exists",
          message: "That email is taken.",
          longMessage: "An account with this email already exists.",
        },
      ],
    };

    expect(getClerkErrorCode(error)).toBe("form_identifier_exists");
    expect(getClerkErrorMessage(error, "fallback")).toBe(
      "An account with this email already exists.",
    );
    expect(getClerkErrorDetails(error)).toHaveLength(1);
  });

  it("uses a safe fallback for unknown failures", () => {
    expect(getClerkErrorCode(null)).toBeNull();
    expect(getClerkErrorMessage({ unexpected: true }, "Please try again.")).toBe(
      "Please try again.",
    );
  });
});
