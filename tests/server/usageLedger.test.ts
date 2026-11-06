import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UsageLedger, resolvePeriod } from "../../server/usageLedger";

describe("UsageLedger", () => {
  let sqlite: Database.Database;
  let ledger: UsageLedger;
  const now = new Date("2026-07-11T12:00:00Z");
  const paidStart = new Date("2026-07-01T00:00:00Z");
  const paidEnd = new Date("2026-07-31T00:00:00Z");

  beforeEach(() => {
    sqlite = new Database(":memory:");
    ledger = new UsageLedger(sqlite);
    ledger.initialize();
  });
  afterEach(() => sqlite.close());

  function reservePremiumOpus(requestId: string, userId = "premium") {
    return ledger.reserve({
      userId,
      requestId,
      tier: "max",
      model: "opus",
      now,
      billingPeriodStart: paidStart,
      billingPeriodEnd: paidEnd,
    });
  }

  it("enforces Starter Sonnet and Haiku ceilings within the existing credit budget", () => {
    const limits = [
      ["sonnet", 5],
      ["haiku", 25],
    ] as const;

    for (const [model, limit] of limits) {
      for (let index = 0; index < limit; index += 1) {
        expect(
          ledger.reserve({
            userId: "starter",
            requestId: `${model}-${index}`,
            tier: "free",
            model,
            now,
            billingPeriodStart: now,
          }),
        ).toMatchObject({ ok: true });
      }
      expect(
        ledger.reserve({
          userId: "starter",
          requestId: `${model}-extra`,
          tier: "free",
          model,
          now,
          billingPeriodStart: now,
        }),
      ).toMatchObject({ ok: false, reason: "model_limit" });
    }
    const period = resolvePeriod("free", now, now);
    expect(ledger.summary("starter", period.start, period.end).creditsUsed).toBe(5 * 10 + 25 * 2);
  });

  it.each(["free", "pro"])("gives %s no Opus runs", (tier) => {
    expect(
      ledger.reserve({
        userId: `user-${tier}`,
        requestId: "opus",
        tier,
        model: "opus",
        now,
        billingPeriodStart: paidStart,
        billingPeriodEnd: paidEnd,
      }),
    ).toMatchObject({ ok: false, reason: "model_limit" });
  });

  it("does not cap Pro Sonnet or Haiku runs beyond credits", () => {
    for (let index = 0; index < 30; index += 1) {
      expect(
        ledger.reserve({
          userId: "pro",
          requestId: `haiku-${index}`,
          tier: "pro",
          model: "haiku",
          now,
          billingPeriodStart: paidStart,
          billingPeriodEnd: paidEnd,
        }),
      ).toMatchObject({ ok: true });
    }
  });

  it("caps Premium at 10 Opus runs per billing period", () => {
    for (let index = 0; index < 10; index += 1) {
      expect(reservePremiumOpus(`opus-${index}`)).toMatchObject({ ok: true });
    }
    expect(reservePremiumOpus("opus-11")).toMatchObject({ ok: false, reason: "model_limit" });
    expect(ledger.modelRunsUsed("premium", "opus", paidStart, paidEnd)).toBe(10);
    // Sonnet stays available after the Opus cap is reached.
    expect(
      ledger.reserve({
        userId: "premium",
        requestId: "sonnet-after-cap",
        tier: "max",
        model: "sonnet",
        now,
        billingPeriodStart: paidStart,
        billingPeriodEnd: paidEnd,
      }),
    ).toMatchObject({ ok: true });
  });

  it("serializes reservations so a second ledger connection cannot take an 11th Opus run", () => {
    const dir = mkdtempSync(join(tmpdir(), "scholarmark-ledger-race-"));
    const file = join(dir, "ledger.db");
    const first = new Database(file);
    const second = new Database(file);
    try {
      const ledgerA = new UsageLedger(first);
      const ledgerB = new UsageLedger(second);
      ledgerA.initialize();
      const results = Array.from({ length: 14 }, (_, index) =>
        (index % 2 === 0 ? ledgerA : ledgerB).reserve({
          userId: "premium",
          requestId: `race-${index}`,
          tier: "max",
          model: "opus",
          now,
          billingPeriodStart: paidStart,
          billingPeriodEnd: paidEnd,
        }),
      );
      expect(results.filter((result) => result.ok)).toHaveLength(10);
      expect(ledgerB.modelRunsUsed("premium", "opus", paidStart, paidEnd)).toBe(10);
    } finally {
      first.close();
      second.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refunds failed Opus runs so retries do not consume the cap", () => {
    for (let index = 0; index < 10; index += 1) {
      expect(reservePremiumOpus(`opus-${index}`)).toMatchObject({ ok: true });
    }
    expect(reservePremiumOpus("retry")).toMatchObject({ ok: false, reason: "model_limit" });
    expect(ledger.refund("opus-3")).toBe(true);
    expect(ledger.refund("opus-3")).toBe(false);
    expect(reservePremiumOpus("retry")).toMatchObject({ ok: true, idempotent: false });
  });

  it("resets the Opus cap in the next billing period", () => {
    for (let index = 0; index < 10; index += 1) {
      expect(reservePremiumOpus(`opus-${index}`)).toMatchObject({ ok: true });
    }
    expect(
      ledger.reserve({
        userId: "premium",
        requestId: "next-period",
        tier: "max",
        model: "opus",
        now: new Date("2026-08-02T00:00:00Z"),
        billingPeriodStart: new Date("2026-07-31T00:00:00Z"),
        billingPeriodEnd: new Date("2026-08-31T00:00:00Z"),
      }),
    ).toMatchObject({ ok: true });
  });

  it("keeps the Opus cap subject to the Premium cost ceiling", () => {
    expect(
      ledger.reserve({
        userId: "premium",
        requestId: "expensive",
        tier: "max",
        model: "opus",
        now,
        billingPeriodStart: paidStart,
        billingPeriodEnd: paidEnd,
        estimatedCostCents: 1801,
      }),
    ).toMatchObject({ ok: false, reason: "cost" });
  });

  it("makes reserve and settle idempotent for the same model", () => {
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

  it("refuses to move a reused request ID onto a different model", () => {
    expect(
      ledger.reserve({
        userId: "premium",
        requestId: "shared-id",
        tier: "max",
        model: "haiku",
        now,
        billingPeriodStart: paidStart,
        billingPeriodEnd: paidEnd,
      }),
    ).toMatchObject({ ok: true });
    expect(reservePremiumOpus("shared-id")).toMatchObject({ ok: false, reason: "conflict" });
  });

  it("rejects retired model identifiers instead of recording them", () => {
    expect(
      ledger.reserve({
        userId: "pro",
        requestId: "gpt",
        tier: "pro",
        model: "gpt" as any,
        now,
      }),
    ).toMatchObject({ ok: false, reason: "model_limit" });
  });

  it("rolls Starter allowance every 30 days", () => {
    const anchor = new Date("2026-01-01T00:00:00Z");
    const first = resolvePeriod("free", new Date("2026-01-30T23:59:59Z"), anchor);
    const next = resolvePeriod("free", new Date("2026-01-31T00:00:00Z"), anchor);
    expect(first.start).toEqual(anchor);
    expect(next.start).toEqual(new Date("2026-01-31T00:00:00Z"));
  });

  it("accumulates usage in a stable period when the account has no billing anchor", () => {
    const first = resolvePeriod("max", new Date("2026-07-11T12:00:00Z"), null, null);
    const later = resolvePeriod("max", new Date("2026-07-11T18:30:00Z"), null, null);
    expect(later).toEqual(first);

    for (let index = 0; index < 10; index += 1) {
      expect(
        ledger.reserve({
          userId: "legacy-premium",
          requestId: `opus-${index}`,
          tier: "max",
          model: "opus",
          now: new Date(now.getTime() + index * 60_000),
          billingPeriodStart: null,
          billingPeriodEnd: null,
        }),
      ).toMatchObject({ ok: true });
    }
    expect(
      ledger.reserve({
        userId: "legacy-premium",
        requestId: "opus-11",
        tier: "max",
        model: "opus",
        now: new Date(now.getTime() + 3_600_000),
        billingPeriodStart: null,
        billingPeriodEnd: null,
      }),
    ).toMatchObject({ ok: false, reason: "model_limit" });
  });

  it("uses the paid provider billing period and cost ceiling", () => {
    expect(
      ledger.reserve({
        userId: "pro",
        requestId: "cost",
        tier: "pro",
        model: "haiku",
        now,
        billingPeriodStart: paidStart,
        billingPeriodEnd: paidEnd,
        estimatedCostCents: 451,
      }),
    ).toMatchObject({ ok: false, reason: "cost" });
  });

  it("caps Starter provider cost at $1.50 per period", () => {
    expect(
      ledger.reserve({
        userId: "free-cost",
        requestId: "too-expensive",
        tier: "free",
        model: "sonnet",
        now,
        estimatedCostCents: 151,
      }),
    ).toMatchObject({ ok: false, reason: "cost" });
  });
});
