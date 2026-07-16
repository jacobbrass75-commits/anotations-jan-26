import type Database from "better-sqlite3";
import {
  getAiUsagePlan,
  normalizePlanTier,
  STARTER_MODEL_USE_LIMITS,
  WRITING_CREDIT_WEIGHTS,
  type PlanTier,
  type WritingCreditModel,
} from "./planLimits";

const DAY_MS = 86_400_000;

export type ReservationResult =
  | {
      ok: true;
      requestId: string;
      credits: number;
      periodStart: Date;
      periodEnd: Date;
      idempotent: boolean;
    }
  | { ok: false; reason: "credits" | "cost" | "model_limit"; remainingCredits: number };

export interface ReserveUsageInput {
  userId: string;
  requestId: string;
  tier?: string | null;
  model: WritingCreditModel;
  estimatedCostCents?: number;
  now?: Date;
  /** Paid plans should pass the provider's current billing-period start. */
  billingPeriodStart?: Date | null;
  billingPeriodEnd?: Date | null;
}

export class UsageLedger {
  constructor(private readonly sqlite: Database.Database) {}

  initialize(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS ai_usage_reservations (
        request_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        tier TEXT NOT NULL,
        model TEXT NOT NULL,
        credits INTEGER NOT NULL,
        estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
        actual_cost_cents INTEGER,
        status TEXT NOT NULL CHECK(status IN ('reserved','settled')),
        period_start INTEGER NOT NULL,
        period_end INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        settled_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_ai_usage_user_period
      ON ai_usage_reservations(user_id, period_start, period_end);
    `);
  }

  reserve(input: ReserveUsageInput): ReservationResult {
    const tx = this.sqlite.transaction((): ReservationResult => {
      const existing = this.sqlite
        .prepare("SELECT * FROM ai_usage_reservations WHERE request_id = ?")
        .get(input.requestId) as any;
      if (existing) {
        if (existing.user_id !== input.userId)
          throw new Error("Usage request ID belongs to another user");
        return {
          ok: true,
          requestId: input.requestId,
          credits: existing.credits,
          periodStart: new Date(existing.period_start),
          periodEnd: new Date(existing.period_end),
          idempotent: true,
        };
      }

      const tier = normalizePlanTier(input.tier);
      const plan = getAiUsagePlan(tier);
      const now = input.now ?? new Date();
      const period = resolvePeriod(
        tier,
        now,
        input.billingPeriodStart,
        input.billingPeriodEnd,
        plan.periodDays,
      );
      const credits = WRITING_CREDIT_WEIGHTS[input.model];
      const estimatedCost = nonnegativeInt(input.estimatedCostCents);
      const totals = this.sqlite
        .prepare(
          `
        SELECT COALESCE(SUM(credits),0) credits,
               COALESCE(SUM(COALESCE(actual_cost_cents, estimated_cost_cents)),0) cost
        FROM ai_usage_reservations
        WHERE user_id = ? AND period_start = ? AND period_end = ?
      `,
        )
        .get(input.userId, period.start.getTime(), period.end.getTime()) as any;
      const remainingCredits = Math.max(0, plan.credits - Number(totals.credits));
      if (Number(totals.credits) + credits > plan.credits)
        return { ok: false, reason: "credits", remainingCredits };
      if (Number(totals.cost) + estimatedCost > plan.costCeilingCents)
        return { ok: false, reason: "cost", remainingCredits };

      const modelLimit = tier === "free" ? STARTER_MODEL_USE_LIMITS[input.model] : undefined;
      if (modelLimit !== undefined) {
        if (modelLimit <= 0) return { ok: false, reason: "model_limit", remainingCredits };
        const count = this.sqlite
          .prepare(
            `SELECT COUNT(*) count FROM ai_usage_reservations
          WHERE user_id = ? AND period_start = ? AND period_end = ? AND model = ?`,
          )
          .get(input.userId, period.start.getTime(), period.end.getTime(), input.model) as any;
        if (Number(count.count) >= modelLimit)
          return { ok: false, reason: "model_limit", remainingCredits };
      }

      this.sqlite
        .prepare(
          `INSERT INTO ai_usage_reservations
        (request_id,user_id,tier,model,credits,estimated_cost_cents,status,period_start,period_end,created_at)
        VALUES (?,?,?,?,?,?,'reserved',?,?,?)`,
        )
        .run(
          input.requestId,
          input.userId,
          tier,
          input.model,
          credits,
          estimatedCost,
          period.start.getTime(),
          period.end.getTime(),
          now.getTime(),
        );
      return {
        ok: true,
        requestId: input.requestId,
        credits,
        periodStart: period.start,
        periodEnd: period.end,
        idempotent: false,
      };
    });
    return tx.immediate();
  }

  settle(requestId: string, actualCostCents?: number): boolean {
    const result = this.sqlite
      .prepare(
        `UPDATE ai_usage_reservations
      SET status='settled', actual_cost_cents=?, settled_at=?
      WHERE request_id=? AND status='reserved'`,
      )
      .run(actualCostCents == null ? null : nonnegativeInt(actualCostCents), Date.now(), requestId);
    if (result.changes > 0) return true;
    return Boolean(
      this.sqlite
        .prepare("SELECT 1 FROM ai_usage_reservations WHERE request_id=? AND status='settled'")
        .get(requestId),
    );
  }

  refund(requestId: string): boolean {
    return (
      this.sqlite
        .prepare("DELETE FROM ai_usage_reservations WHERE request_id=? AND status='reserved'")
        .run(requestId).changes > 0
    );
  }

  summary(
    userId: string,
    periodStart: Date,
    periodEnd: Date,
  ): { creditsUsed: number; costCentsUsed: number } {
    const row = this.sqlite
      .prepare(
        `SELECT COALESCE(SUM(credits),0) credits,
      COALESCE(SUM(COALESCE(actual_cost_cents, estimated_cost_cents)),0) cost
      FROM ai_usage_reservations WHERE user_id=? AND period_start=? AND period_end=?`,
      )
      .get(userId, periodStart.getTime(), periodEnd.getTime()) as any;
    return { creditsUsed: Number(row.credits), costCentsUsed: Number(row.cost) };
  }
}

function nonnegativeInt(value: number | undefined): number {
  return Number.isFinite(value) && Number(value) > 0 ? Math.ceil(Number(value)) : 0;
}

export function resolvePeriod(
  tier: PlanTier,
  now: Date,
  start?: Date | null,
  end?: Date | null,
  days = 30,
) {
  if (tier !== "free" && start && end && end > start) return { start, end };
  const anchor = start && start <= now ? start : now;
  const elapsedPeriods = Math.max(
    0,
    Math.floor((now.getTime() - anchor.getTime()) / (days * DAY_MS)),
  );
  const periodStart = new Date(anchor.getTime() + elapsedPeriods * days * DAY_MS);
  return { start: periodStart, end: new Date(periodStart.getTime() + days * DAY_MS) };
}
