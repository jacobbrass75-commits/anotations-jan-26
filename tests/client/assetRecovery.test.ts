import { describe, expect, it } from "vitest";
import {
  buildStaleAssetRecoveryUrl,
  getStaleAssetRecoveryStorageKey,
  stripStaleAssetRecoveryParam,
} from "../../client/src/lib/assetRecovery";

describe("stale asset recovery", () => {
  it("adds a one-time cache-busting query while preserving attribution and hashes", () => {
    expect(
      buildStaleAssetRecoveryUrl(
        "https://scholarmark.ai/start?utm_source=instagram#offer",
        "retry1",
      ),
    ).toBe("https://scholarmark.ai/start?utm_source=instagram&sm_asset_retry=retry1#offer");
  });

  it("refuses to create a reload loop", () => {
    expect(
      buildStaleAssetRecoveryUrl("https://scholarmark.ai/start?sm_asset_retry=already"),
    ).toBeNull();
  });

  it("removes the recovery marker after a successful render", () => {
    expect(
      stripStaleAssetRecoveryParam(
        "https://scholarmark.ai/start?utm_source=instagram&sm_asset_retry=done#offer",
      ),
    ).toBe("/start?utm_source=instagram#offer");
  });

  it("scopes the session latch to the failing route", () => {
    expect(getStaleAssetRecoveryStorageKey("/sign-up")).toBe("sm_asset_recovery:/sign-up");
  });
});
