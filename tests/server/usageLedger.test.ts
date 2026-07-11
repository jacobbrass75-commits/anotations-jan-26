import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UsageLedger, resolvePeriod } from "../../server/usageLedger";

describe("UsageLedger", () => {
  let sqlite: Database.Database;
  let ledger: UsageLedger;
  const now = new Date("2026-07-11T12:00:00Z");

  beforeEach(() => {
    sqlite = new Database(":memory:");
    ledger = new UsageLedger(sqlite);
    ledger.initialize();
  });
  afterEach(() => sqlite.close());

  it("prevents concurrent-style reservations from overspending", () => {
    const results = ["a", "b", "c"].map((requestId) =>
      ledger.reserve({
        userId: "u1",
        requestId,
        tier: "free",
        model: "sonnet",
        now,
        billingPeriodStart: now,
      }),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(3);
    expect(
      ledger.reserve({
        userId: "u1",
        requestId: "opus",
        tier: "free",
        model: "opus",
        now,
        billingPeriodStart: now,
      }),
    ).toMatchObject({ ok: true });
    expect(
      ledger.reserve({
        userId: "u1",
        requestId: "extra",
        tier: "free",
        model: "deepseek",
        now,
        billingPeriodStart: now,
      }),
    ).toMatchObject({ ok: false, reason: "credits" });
  });

  it("makes reserve and settle idempotent", () => {
    const input = {
      userId: "u1",
      requestId: "same",
      tier: "free",
      model: "sonnet" as const,
      now,
      billingPeriodStart: now,
    };
    expect(ledger.reserve(input)).toMatchObject({ ok: true, idempotent: false });
    expect(ledger.reserve(input)).toMatchObject({ ok: true, idempotent: true });
    expect(ledger.settle("same", 3)).toBe(true);
    expect(ledger.settle("same", 9)).toBe(true);
    const period = resolvePeriod("free", now, now);
    expect(ledger.summary("u1", period.start, period.end)).toEqual({
      creditsUsed: 10,
      costCentsUsed: 3,
    });
  });

  it("refunds failures and releases model and credit limits", () => {
    expect(
      ledger.reserve({
        userId: "u1",
        requestId: "first",
        tier: "free",
        model: "opus",
        now,
        billingPeriodStart: now,
      }),
    ).toMatchObject({ ok: true });
    expect(
      ledger.reserve({
        userId: "u1",
        requestId: "second",
        tier: "free",
        model: "opus",
        now,
        billingPeriodStart: now,
      }),
    ).toMatchObject({ ok: false, reason: "model_limit" });
    expect(ledger.refund("first")).toBe(true);
    expect(ledger.refund("first")).toBe(false);
    expect(
      ledger.reserve({
        userId: "u1",
        requestId: "second",
        tier: "free",
        model: "opus",
        now,
        billingPeriodStart: now,
      }),
    ).toMatchObject({ ok: true });
  });

  it("rolls Starter allowance every 30 days", () => {
    const anchor = new Date("2026-01-01T00:00:00Z");
    const first = resolvePeriod("free", new Date("2026-01-30T23:59:59Z"), anchor);
    const next = resolvePeriod("free", new Date("2026-01-31T00:00:00Z"), anchor);
    expect(first.start).toEqual(anchor);
    expect(next.start).toEqual(new Date("2026-01-31T00:00:00Z"));
    expect(
      ledger.reserve({
        userId: "u1",
        requestId: "p1",
        tier: "free",
        model: "opus",
        now: new Date("2026-01-30T23:59:59Z"),
        billingPeriodStart: anchor,
      }),
    ).toMatchObject({ ok: true });
    expect(
      ledger.reserve({
        userId: "u1",
        requestId: "p2",
        tier: "free",
        model: "opus",
        now: new Date("2026-01-31T00:00:00Z"),
        billingPeriodStart: anchor,
      }),
    ).toMatchObject({ ok: true });
  });

  it("uses the paid provider billing period and cost ceiling", () => {
    const start = new Date("2026-07-01T00:00:00Z");
    const end = new Date("2026-08-01T00:00:00Z");
    expect(
      ledger.reserve({
        userId: "pro",
        requestId: "cost",
        tier: "pro",
        model: "deepseek",
        now,
        billingPeriodStart: start,
        billingPeriodEnd: end,
        estimatedCostCents: 451,
      }),
    ).toMatchObject({ ok: false, reason: "cost" });
  });
});
