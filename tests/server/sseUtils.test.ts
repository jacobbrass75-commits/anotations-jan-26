import { describe, expect, it } from "vitest";
import { sanitizeSseError } from "../../server/sseUtils";

describe("sanitizeSseError", () => {
  it("replaces Anthropic model-not-found payloads with a user-safe message", () => {
    const message = sanitizeSseError(
      `404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-3-haiku-20241022"}}`,
      "Writing failed",
    );

    expect(message).toBe(
      "The configured writing model is unavailable. Please retry; the server will use the supported model fallback.",
    );
  });
});
