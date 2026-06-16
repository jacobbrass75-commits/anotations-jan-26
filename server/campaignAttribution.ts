import { sql } from "drizzle-orm";
import { campaignSignups } from "@shared/schema";
import { db } from "./db";
import { createLogger } from "./logger";

const logger = createLogger("campaign-attribution");

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function claimCampaignSignupForUser(user: {
  id: string;
  email: string;
}): Promise<void> {
  const email = normalizeEmail(user.email);
  if (!email) return;

  try {
    await db
      .update(campaignSignups)
      .set({
        userId: user.id,
      })
      .where(
        sql`${campaignSignups.email} = ${email} AND (${campaignSignups.userId} IS NULL OR ${campaignSignups.userId} = ${user.id})`,
      );
    await db
      .update(campaignSignups)
      .set({ accountCreatedAt: new Date() })
      .where(
        sql`${campaignSignups.email} = ${email} AND ${campaignSignups.accountCreatedAt} IS NULL`,
      );
  } catch (error) {
    logger.warn({ err: error, userId: user.id }, "Failed to claim campaign signup");
  }
}

/**
 * Marks the campaign lead matching this user's email as activated.
 * Activation = first real product action after signup. Never throws.
 */
export async function markCampaignActivation(
  user: { userId: string; email: string } | undefined,
  action: string,
): Promise<void> {
  if (!user?.email) return;
  const email = normalizeEmail(user.email);
  if (!email) return;

  try {
    await db
      .update(campaignSignups)
      .set({
        userId: user.userId,
        activatedAt: new Date(),
        firstAction: action,
      })
      .where(
        sql`${campaignSignups.email} = ${email} AND ${campaignSignups.activatedAt} IS NULL`,
      );
    await db
      .update(campaignSignups)
      .set({ accountCreatedAt: new Date() })
      .where(
        sql`${campaignSignups.email} = ${email} AND ${campaignSignups.accountCreatedAt} IS NULL`,
      );
  } catch (error) {
    logger.warn({ err: error, action }, "Failed to mark campaign activation");
  }
}
