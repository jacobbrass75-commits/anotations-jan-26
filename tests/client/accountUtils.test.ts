import { describe, expect, it } from "vitest";
import {
  formatAccountBytes,
  formatAccountDate,
  formatAccountTier,
  formatUsagePercent,
} from "../../client/src/lib/accountUtils";

describe("account utilities", () => {
  it("formats plan labels for display", () => {
    expect(formatAccountTier("free")).toBe("Free");
    expect(formatAccountTier("pro")).toBe("Pro");
    expect(formatAccountTier("max")).toBe("Max");
    expect(formatAccountTier("unknown")).toBe("Free");
  });

  it("clamps usage percentages into a safe display range", () => {
    expect(formatUsagePercent(25, 100)).toBe(25);
    expect(formatUsagePercent(200, 100)).toBe(100);
    expect(formatUsagePercent(10, 0)).toBe(0);
  });

  it("formats bytes and dates for account summaries", () => {
    expect(formatAccountBytes(0)).toBe("0 B");
    expect(formatAccountBytes(1_048_576)).toBe("1.00 MB");
    expect(formatAccountDate("2026-03-30T12:00:00.000Z")).toContain("2026");
    expect(formatAccountDate(null)).toBe("Not available");
  });
});
