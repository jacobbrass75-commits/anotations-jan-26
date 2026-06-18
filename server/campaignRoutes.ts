import type { Express, NextFunction, Request, Response } from "express";
import { randomBytes } from "crypto";
import { count, eq } from "drizzle-orm";
import { db } from "./db";
import {
  campaignSignups,
  campaignSignupFormSchema,
  campaignVisits,
  campaignVisitSchema,
  users,
  type CampaignSignup,
  type User,
} from "@shared/schema";
import { requireAuth } from "./auth";
import { requireAdmin } from "./analyticsRoutes";
import { authLimiter } from "./rateLimits";
import { markCampaignActivation } from "./campaignAttribution";
import { sendCampaignSignupEmail } from "./campaignEmail";
import { createLogger } from "./logger";

const logger = createLogger("campaignRoutes");

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
 * Express middleware variant of markCampaignActivation for instrumenting
 * existing routes without touching their handlers. Fire-and-forget.
 */
export function trackCampaignActivation(action: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.once("finish", () => {
      if (res.statusCode >= 200 && res.statusCode < 400) {
        void markCampaignActivation(req.user, action);
      }
    });
    next();
  };
}

interface BreakdownRow {
  value: string;
  signups: number;
  activated: number;
  paid: number;
}

function buildBreakdown(
  signups: CampaignSignup[],
  pick: (signup: CampaignSignup) => string | null,
  isPaidSignup: (signup: CampaignSignup) => boolean = () => false,
): BreakdownRow[] {
  const groups = new Map<string, { signups: number; activated: number; paid: number }>();
  for (const signup of signups) {
    const value = pick(signup)?.trim().toLowerCase() || "(unknown)";
    const group = groups.get(value) ?? { signups: 0, activated: 0, paid: 0 };
    group.signups += 1;
    if (signup.activatedAt) group.activated += 1;
    if (isPaidSignup(signup)) group.paid += 1;
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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isActivePaidUser(user: User | undefined): boolean {
  if (!user) return false;
  if (user.tier !== "pro" && user.tier !== "max") return false;
  if (!user.stripeCustomerId || !user.stripeSubscriptionId) return false;
  return ["active", "trialing", "past_due"].includes(user.subscriptionStatus ?? "");
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
      await sendCampaignSignupEmail({ form, referralCode });

      return res.status(201).json({ alreadySignedUp: false, referralCode });
    } catch (error) {
      logger.error({ err: error }, "Campaign signup failed");
      return res.status(500).json({ message: "Signup failed. Please try again." });
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
        const appUsers = await db.select().from(users);
        const usersById = new Map(appUsers.map((user) => [user.id, user]));
        const usersByEmail = new Map(appUsers.map((user) => [normalizeEmail(user.email), user]));
        const userForSignup = (signup: CampaignSignup) =>
          (signup.userId ? usersById.get(signup.userId) : undefined) ??
          usersByEmail.get(normalizeEmail(signup.email));
        const isPaidSignup = (signup: CampaignSignup) =>
          Boolean(signup.paidAt) || isActivePaidUser(userForSignup(signup));

        const totalSignups = signups.length;
        const registered = signups.filter((s) => s.accountCreatedAt || userForSignup(s)).length;
        const activated = signups.filter((s) => s.activatedAt).length;
        const referredSignups = signups.filter((s) => s.referredBy).length;
        const paid = signups.filter(isPaidSignup).length;
        const activatedPaid = signups.filter((s) => s.activatedAt && isPaidSignup(s)).length;

        // Referrers = leads whose own code shows up in someone else's referredBy.
        const codesUsed = new Set(signups.map((s) => s.referredBy?.toLowerCase()).filter(Boolean));
        const referrers = signups.filter((s) => codesUsed.has(s.referralCode.toLowerCase())).length;

        const weeklySignups = new Map<string, number>();
        for (const signup of signups) {
          const week = isoWeekKey(signup.createdAt);
          weeklySignups.set(week, (weeklySignups.get(week) ?? 0) + 1);
        }

        res.json({
          totals: {
            visits,
            signups: totalSignups,
            registered,
            activated,
            paid,
            activatedPaid,
            referredSignups,
            referrers,
          },
          rates: {
            signupRate: visits > 0 ? totalSignups / visits : null,
            registrationRate: totalSignups > 0 ? registered / totalSignups : null,
            activationRate: totalSignups > 0 ? activated / totalSignups : null,
            paidRate: totalSignups > 0 ? paid / totalSignups : null,
            activatedPaidRate: activated > 0 ? activatedPaid / activated : null,
            referralRate: activated > 0 ? referrers / activated : null,
          },
          breakdowns: {
            channel: buildBreakdown(signups, (s) => s.channel, isPaidSignup),
            school: buildBreakdown(signups, (s) => s.school, isPaidSignup),
            major: buildBreakdown(signups, (s) => s.major, isPaidSignup),
            classYear: buildBreakdown(signups, (s) => s.classYear, isPaidSignup),
            paperType: buildBreakdown(signups, (s) => s.paperType, isPaidSignup),
          },
          weeklySignups: Array.from(weeklySignups.entries())
            .map(([week, total]) => ({ week, signups: total }))
            .sort((a, b) => a.week.localeCompare(b.week)),
          recentSignups: signups
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .slice(0, 100)
            .map((s) => {
              const matchedUser = userForSignup(s);
              return {
                name: s.name,
                email: s.email,
                school: s.school,
                major: s.major,
                classYear: s.classYear,
                paperType: s.paperType,
                campus: s.campus,
                channel: s.channel,
                inviteCode: s.inviteCode,
                referredBy: s.referredBy,
                referralCode: s.referralCode,
                activated: Boolean(s.activatedAt),
                registered: Boolean(s.accountCreatedAt || matchedUser),
                firstAction: s.firstAction,
                paid: isPaidSignup(s),
                paidEver: Boolean(s.paidAt),
                plan: s.paidPlan ?? matchedUser?.tier ?? null,
                subscriptionStatus: s.paidStatus ?? matchedUser?.subscriptionStatus ?? null,
                paidProvider: s.paidProvider,
                paidAt: s.paidAt?.getTime() ?? null,
                checkoutStartedAt: s.checkoutStartedAt?.getTime() ?? null,
                accountCreatedAt: s.accountCreatedAt?.getTime() ?? null,
                signupDate: s.createdAt.getTime(),
              };
            }),
        });
      } catch (error) {
        logger.error({ err: error }, "Campaign metrics failed");
        res.status(500).json({ message: "Failed to load campaign metrics" });
      }
    },
  );
}
