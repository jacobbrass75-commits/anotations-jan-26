import type { Express, NextFunction, Request, Response } from "express";
import { randomBytes } from "crypto";
import { count, eq, sql } from "drizzle-orm";
import { db } from "./db";
import {
  campaignSignups,
  campaignSignupFormSchema,
  campaignVisits,
  campaignVisitSchema,
  type CampaignSignup,
} from "@shared/schema";
import { requireAuth } from "./auth";
import { getUserById } from "./authStorage";
import { requireAdmin } from "./analyticsRoutes";
import { authLimiter } from "./rateLimits";
import { createLogger } from "./logger";

const logger = createLogger("campaignRoutes");

// Real cap on early-access spots. The landing page shows the live count of
// actual claims against this — never hardcode a fake "taken" number.
const CAMPAIGN_SPOTS_TOTAL = Number.isFinite(Number(process.env.CAMPAIGN_SPOTS_TOTAL))
  ? Math.max(1, Math.floor(Number(process.env.CAMPAIGN_SPOTS_TOTAL)))
  : 100;

/**
 * Builds a shareable referral code like "maya-3f2a" from the lead's name.
 * Falls back to a pure random code when the name has no usable characters.
 */
function buildReferralCode(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")[0]
    .slice(0, 16);
  const suffix = randomBytes(2).toString("hex");
  return slug ? `${slug}-${suffix}` : `student-${suffix}`;
}

async function generateUniqueReferralCode(name: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = buildReferralCode(name);
    const [existing] = await db
      .select({ id: campaignSignups.id })
      .from(campaignSignups)
      .where(eq(campaignSignups.referralCode, code));
    if (!existing) return code;
  }
  // Five collisions in a row means the slug space is crowded; go fully random.
  return `student-${randomBytes(4).toString("hex")}`;
}

/**
 * Marks the campaign lead matching this user's email as activated.
 * Activation = first real product action (upload, project creation) after
 * signing up, which is the campaign's key metric. Never throws.
 */
export async function markCampaignActivation(
  user: { userId: string; email: string } | undefined,
  action: string,
): Promise<void> {
  if (!user?.email) return;
  try {
    await db
      .update(campaignSignups)
      .set({
        userId: user.userId,
        activatedAt: new Date(),
        firstAction: action,
      })
      .where(
        sql`${campaignSignups.email} = ${user.email.toLowerCase()} AND ${campaignSignups.activatedAt} IS NULL`,
      );
  } catch (error) {
    logger.warn({ err: error, action }, "Failed to mark campaign activation (non-blocking)");
  }
}

/**
 * Express middleware variant of markCampaignActivation for instrumenting
 * existing routes without touching their handlers. Fire-and-forget.
 */
export function trackCampaignActivation(action: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    void markCampaignActivation(req.user, action);
    next();
  };
}

interface BreakdownRow {
  value: string;
  signups: number;
  activated: number;
}

function buildBreakdown(
  signups: CampaignSignup[],
  pick: (signup: CampaignSignup) => string | null,
): BreakdownRow[] {
  const groups = new Map<string, { signups: number; activated: number }>();
  for (const signup of signups) {
    const value = pick(signup)?.trim().toLowerCase() || "(unknown)";
    const group = groups.get(value) ?? { signups: 0, activated: 0 };
    group.signups += 1;
    if (signup.activatedAt) group.activated += 1;
    groups.set(value, group);
  }
  return Array.from(groups.entries())
    .map(([value, stats]) => ({ value, ...stats }))
    .sort((a, b) => b.signups - a.signups);
}

function isoWeekKey(date: Date): string {
  // Thursday of the same ISO week determines the ISO year/week number.
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayOfWeek = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayOfWeek);
  const yearStart = Date.UTC(utc.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((utc.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function registerCampaignRoutes(app: Express): void {
  // Public: record an invite-link click with its attribution params.
  app.post("/api/campaign/visit", authLimiter, async (req: Request, res: Response) => {
    try {
      const visit = campaignVisitSchema.parse(req.body ?? {});
      await db.insert(campaignVisits).values(visit);
      res.status(204).end();
    } catch (error) {
      logger.warn({ err: error }, "Invalid campaign visit payload");
      res.status(400).json({ message: "Invalid visit payload" });
    }
  });

  // Public: campaign lead signup. Idempotent per email — repeat submissions
  // return the existing referral code instead of erroring.
  app.post("/api/campaign/signup", authLimiter, async (req: Request, res: Response) => {
    try {
      const parsed = campaignSignupFormSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          message: "Please check the form and try again",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
      }
      const form = parsed.data;

      const [existing] = await db
        .select()
        .from(campaignSignups)
        .where(eq(campaignSignups.email, form.email));
      if (existing) {
        return res.status(200).json({
          alreadySignedUp: true,
          referralCode: existing.referralCode,
        });
      }

      const referralCode = await generateUniqueReferralCode(form.name);
      await db.insert(campaignSignups).values({ ...form, referralCode });

      return res.status(201).json({ alreadySignedUp: false, referralCode });
    } catch (error) {
      logger.error({ err: error }, "Campaign signup failed");
      return res.status(500).json({ message: "Signup failed. Please try again." });
    }
  });

  // Public: live early-access spot count for the landing page counter.
  app.get("/api/campaign/spots", async (_req: Request, res: Response) => {
    try {
      const [row] = await db.select({ taken: count() }).from(campaignSignups);
      res.json({ total: CAMPAIGN_SPOTS_TOTAL, taken: row?.taken ?? 0 });
    } catch (error) {
      logger.error({ err: error }, "Campaign spots lookup failed");
      res.status(500).json({ message: "Failed to load spots" });
    }
  });

  // Authenticated: one-tap spot claim for the simplified funnel. The lead is
  // the signed-in account itself — no form. Idempotent per email.
  app.post("/api/campaign/claim", requireAuth, authLimiter, async (req: Request, res: Response) => {
    try {
      const attribution = campaignVisitSchema.parse(req.body ?? {});
      const email = req.user!.email.toLowerCase();

      const [existing] = await db
        .select()
        .from(campaignSignups)
        .where(eq(campaignSignups.email, email));

      const [countRow] = await db.select({ taken: count() }).from(campaignSignups);
      let taken = countRow?.taken ?? 0;

      if (existing) {
        await db
          .update(campaignSignups)
          .set({
            userId: existing.userId ?? req.user!.userId,
            campus: existing.campus ?? attribution.campus ?? null,
            channel: existing.channel ?? attribution.channel ?? null,
            inviteCode: existing.inviteCode ?? attribution.inviteCode ?? null,
            referredBy: existing.referredBy ?? attribution.referredBy ?? null,
          })
          .where(eq(campaignSignups.id, existing.id));
        return res.json({
          alreadyClaimed: true,
          referralCode: existing.referralCode,
          taken,
          total: CAMPAIGN_SPOTS_TOTAL,
        });
      }

      const account = await getUserById(req.user!.userId);
      const name =
        [account?.firstName, account?.lastName].filter(Boolean).join(" ") ||
        account?.username ||
        null;

      const referralCode = await generateUniqueReferralCode(name ?? email.split("@")[0]);
      await db.insert(campaignSignups).values({
        name,
        email,
        major: attribution.major ?? null,
        campus: attribution.campus ?? null,
        channel: attribution.channel ?? null,
        inviteCode: attribution.inviteCode ?? null,
        referredBy: attribution.referredBy ?? null,
        referralCode,
        userId: req.user!.userId,
      });
      taken += 1;

      return res.status(201).json({
        alreadyClaimed: false,
        referralCode,
        taken,
        total: CAMPAIGN_SPOTS_TOTAL,
      });
    } catch (error) {
      logger.error({ err: error }, "Campaign claim failed");
      return res.status(500).json({ message: "Could not claim a spot. Please try again." });
    }
  });

  // Admin: campaign funnel metrics — clicks, signups, activation, referrals,
  // and breakdowns by channel/school/major/year/paper type.
  app.get(
    "/api/admin/campaign/metrics",
    requireAuth,
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        const [visitRow] = await db.select({ total: count() }).from(campaignVisits);
        const visits = visitRow?.total ?? 0;

        const signups = await db.select().from(campaignSignups);
        const totalSignups = signups.length;
        const activated = signups.filter((s) => s.activatedAt).length;
        const referredSignups = signups.filter((s) => s.referredBy).length;

        // Referrers = leads whose own code shows up in someone else's referredBy.
        const codesUsed = new Set(
          signups.map((s) => s.referredBy?.toLowerCase()).filter(Boolean),
        );
        const referrers = signups.filter((s) =>
          codesUsed.has(s.referralCode.toLowerCase()),
        ).length;

        const weeklySignups = new Map<string, number>();
        for (const signup of signups) {
          const week = isoWeekKey(signup.createdAt);
          weeklySignups.set(week, (weeklySignups.get(week) ?? 0) + 1);
        }

        res.json({
          totals: {
            visits,
            signups: totalSignups,
            activated,
            referredSignups,
            referrers,
          },
          rates: {
            signupRate: visits > 0 ? totalSignups / visits : null,
            activationRate: totalSignups > 0 ? activated / totalSignups : null,
            referralRate: activated > 0 ? referrers / activated : null,
          },
          breakdowns: {
            channel: buildBreakdown(signups, (s) => s.channel),
            school: buildBreakdown(signups, (s) => s.school),
            major: buildBreakdown(signups, (s) => s.major),
            classYear: buildBreakdown(signups, (s) => s.classYear),
            paperType: buildBreakdown(signups, (s) => s.paperType),
          },
          weeklySignups: Array.from(weeklySignups.entries())
            .map(([week, total]) => ({ week, signups: total }))
            .sort((a, b) => a.week.localeCompare(b.week)),
          recentSignups: signups
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .slice(0, 100)
            .map((s) => ({
              name: s.name,
              email: s.email,
              school: s.school,
              major: s.major,
              classYear: s.classYear,
              paperType: s.paperType,
              channel: s.channel,
              referredBy: s.referredBy,
              referralCode: s.referralCode,
              activated: Boolean(s.activatedAt),
              firstAction: s.firstAction,
              signupDate: s.createdAt.getTime(),
            })),
        });
      } catch (error) {
        logger.error({ err: error }, "Campaign metrics failed");
        res.status(500).json({ message: "Failed to load campaign metrics" });
      }
    },
  );
}
