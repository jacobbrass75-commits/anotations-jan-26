import { describe, expect, it } from "vitest";
import {
  AuthOperationTimeoutError,
  withAuthOperationTimeout,
} from "../../client/src/lib/authOperation";

describe("embedded auth operation timeout", () => {
  it("returns a completed Clerk operation", async () => {
    await expect(
      withAuthOperationTimeout(Promise.resolve("complete"), "timed out", 25),
    ).resolves.toBe("complete");
  });

  it("recovers from a Clerk or CAPTCHA operation that never settles", async () => {
    await expect(
      withAuthOperationTimeout(new Promise<never>(() => undefined), "Secure signup timed out", 5),
    ).rejects.toEqual(
      expect.objectContaining<AuthOperationTimeoutError>({
        name: "AuthOperationTimeoutError",
        message: "Secure signup timed out",
      }),
    );
  });
});
