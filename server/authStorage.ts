import {
  conversations,
  documents,
  projectDocuments,
  projects,
  users,
  webClips,
  type User,
} from "@shared/schema";
import { db } from "./db";
import { eq, isNull, sql } from "drizzle-orm";

const EMAIL_MIGRATION_REQUIRES_VERIFICATION = "Account email must be verified before migration";

const TIER_LIMITS: Record<string, { tokenLimit: number; storageLimit: number }> = {
  free: { tokenLimit: 50_000, storageLimit: 52_428_800 },
  pro: { tokenLimit: 500_000, storageLimit: 524_288_000 },
  max: { tokenLimit: 2_000_000, storageLimit: 5_368_709_120 },
};

/** Strip password from user object before returning to clients */
export function sanitizeUser(user: User): Omit<User, "password"> {
  const { password, ...rest } = user;
  return rest;
}

/**
 * Get or create a local user record for a Clerk user.
 * The local record tracks usage (tokens, storage) and tier.
 *
 * If an existing verified local user has the same verified email but a
 * different Clerk user id, return that local user. This lets users keep their
 * projects and documents when moving between Clerk instances without merging a
 * newly verified Clerk account into an unverified legacy row.
 */
export async function getOrCreateUser(
  clerkUserId: string,
  email: string,
  tier: string | null,
  options: { emailVerified?: boolean } = {},
): Promise<User> {
  const normalizedEmail = normalizeUserEmail(email);
  if (!normalizedEmail) {
    throw new Error("Clerk user is missing an email address");
  }
  const emailVerified = options.emailVerified === true;

  const existing = await getUserById(clerkUserId);
  if (existing) {
    const synced = await syncUserFromClerk(existing, tier, emailVerified);
    await claimLegacyUserData(synced.id, emailVerified);
    return synced;
  }

  const existingByEmail = await getUserByEmail(normalizedEmail);
  if (existingByEmail) {
    if (!emailVerified || existingByEmail.emailVerified !== true) {
      throw new Error(EMAIL_MIGRATION_REQUIRES_VERIFICATION);
    }
    const synced = await syncUserFromClerk(existingByEmail, tier, emailVerified);
    await claimLegacyUserData(synced.id, emailVerified);
    return synced;
  }

  // Create new local record
  const now = new Date();
  const resolvedTier = tier ?? "free";
  const tierLimits = getTierLimits(resolvedTier);
  const [created] = await db
    .insert(users)
    .values({
      id: clerkUserId,
      email: normalizedEmail,
      username: normalizedEmail, // default username to email
      password: "", // not used with Clerk
      tier: resolvedTier,
      tokensUsed: 0,
      tokenLimit: tierLimits.tokenLimit,
      storageUsed: 0,
      storageLimit: tierLimits.storageLimit,
      emailVerified,
      billingCycleStart: now,
      createdAt: now,
      updatedAt: now,
    } as any)
    .returning();
  await claimLegacyUserData(created.id, emailVerified);
  return created;
}

function normalizeUserEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getTierLimits(tier: string): { tokenLimit: number; storageLimit: number } {
  return TIER_LIMITS[tier] ?? TIER_LIMITS.free;
}

export function isValidUserTier(tier: string): boolean {
  return tier in TIER_LIMITS;
}

async function syncUserFromClerk(
  user: User,
  tier: string | null,
  emailVerified: boolean,
): Promise<User> {
  const updates: Partial<User> = {};
  const stripeManaged = Boolean(user.stripeSubscriptionId || user.stripePriceId || user.subscriptionStatus);
  const resolvedTier = stripeManaged ? user.tier : (tier ?? user.tier);
  const tierLimits = getTierLimits(resolvedTier);

  if (!stripeManaged && tier && user.tier !== tier) {
    updates.tier = tier;
  }

  if (user.tokenLimit !== tierLimits.tokenLimit) {
    updates.tokenLimit = tierLimits.tokenLimit;
  }

  if (user.storageLimit !== tierLimits.storageLimit) {
    updates.storageLimit = tierLimits.storageLimit;
  }

  if (emailVerified && user.emailVerified !== true) {
    updates.emailVerified = true;
  }

  if (Object.keys(updates).length > 0) {
    return await updateUser(user.id, updates);
  }

  return user;
}

export async function getUserById(id: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user || null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const normalizedEmail = normalizeUserEmail(email);
  if (!normalizedEmail) {
    return null;
  }

  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizedEmail}`);
  return user || null;
}

export async function getUserByStripeCustomerId(stripeCustomerId: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.stripeCustomerId, stripeCustomerId));
  return user || null;
}

export async function updateUser(id: string, data: Partial<User>): Promise<User> {
  const [updated] = await db
    .update(users)
    .set({ ...data, updatedAt: new Date() } as any)
    .where(eq(users.id, id))
    .returning();
  return updated;
}

export async function updateUserBillingMetadata(id: string, data: Partial<User>): Promise<User> {
  return updateUser(id, data);
}

export async function setUserTier(
  id: string,
  tier: string,
  options: { resetUsage?: boolean; billing?: Partial<User> } = {},
): Promise<User> {
  if (!isValidUserTier(tier)) {
    throw new Error(`Invalid user tier: ${tier}`);
  }

  const tierLimits = getTierLimits(tier);
  const resetUsage = options.resetUsage ?? true;
  const updates: Partial<User> = {
    tier,
    tokenLimit: tierLimits.tokenLimit,
    storageLimit: tierLimits.storageLimit,
    ...(options.billing ?? {}),
  };

  if (resetUsage) {
    updates.tokensUsed = 0;
    updates.billingCycleStart = new Date();
  }

  return updateUser(id, updates);
}

export async function incrementTokenUsage(id: string, tokens: number): Promise<void> {
  if (!Number.isFinite(tokens) || tokens <= 0) return;
  const usedTokens = Math.floor(tokens);
  const [updated] = await db
    .update(users)
    .set({
      tokensUsed: sql`${users.tokensUsed} + ${usedTokens}`,
      updatedAt: new Date(),
    } as any)
    .where(eq(users.id, id))
    .returning({ id: users.id });
  if (!updated) throw new Error("User not found");
}

async function claimLegacyUserData(userId: string, emailVerified: boolean): Promise<void> {
  if (!emailVerified) return;

  const now = new Date();
  const isSingleUserInstall = await hasExactlyOneUser();

  if (isSingleUserInstall) {
    await db
      .update(documents)
      .set({ userId } as any)
      .where(isNull(documents.userId));
    await db
      .update(projects)
      .set({ userId, updatedAt: now } as any)
      .where(isNull(projects.userId));
    await db
      .update(conversations)
      .set({ userId, updatedAt: now } as any)
      .where(isNull(conversations.userId));
    await db
      .update(webClips)
      .set({ userId } as any)
      .where(isNull(webClips.userId));
    return;
  }

  // In multi-user installs, only claim legacy ownerless rows when an owned
  // relationship proves the target user. Otherwise the safe action is to leave
  // the orphan for explicit admin migration instead of exposing it to the next
  // verified account that signs in.
  await db.update(documents).set({ userId } as any).where(sql`
      ${documents.userId} IS NULL
      AND ${documents.id} IN (
        SELECT ${projectDocuments.documentId}
        FROM ${projectDocuments}
        INNER JOIN ${projects} ON ${projects.id} = ${projectDocuments.projectId}
        WHERE ${projects.userId} = ${userId}
      )
    `);
  await db.update(conversations).set({ userId, updatedAt: now } as any).where(sql`
      ${conversations.userId} IS NULL
      AND ${conversations.projectId} IN (
        SELECT ${projects.id}
        FROM ${projects}
        WHERE ${projects.userId} = ${userId}
      )
    `);
  await db.update(webClips).set({ userId } as any).where(sql`
      ${webClips.userId} IS NULL
      AND (
        ${webClips.projectId} IN (
          SELECT ${projects.id}
          FROM ${projects}
          WHERE ${projects.userId} = ${userId}
        )
        OR ${webClips.projectDocumentId} IN (
          SELECT ${projectDocuments.id}
          FROM ${projectDocuments}
          INNER JOIN ${projects} ON ${projects.id} = ${projectDocuments.projectId}
          WHERE ${projects.userId} = ${userId}
        )
      )
    `);
}

async function hasExactlyOneUser(): Promise<boolean> {
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(users);
  return Number(row?.count ?? 0) === 1;
}

export async function incrementStorageUsage(id: string, bytes: number): Promise<void> {
  const result = await reserveStorageUsage(id, bytes);
  if (!result.ok) {
    throw new Error(result.reason === "not_found" ? "User not found" : "Storage budget exceeded");
  }
}

export async function reserveStorageUsage(
  id: string,
  bytes: number,
): Promise<
  | { ok: true; requestedBytes: number }
  | {
      ok: false;
      reason: "not_found" | "limit";
      requestedBytes: number;
      storageLimit?: number;
      storageUsed?: number;
    }
> {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { ok: true, requestedBytes: 0 };
  }
  const requestedBytes = Math.floor(bytes);
  const [updated] = await db
    .update(users)
    .set({
      storageUsed: sql`${users.storageUsed} + ${requestedBytes}`,
      updatedAt: new Date(),
    } as any)
    .where(
      sql`
      ${users.id} = ${id}
      AND (
        ${users.storageLimit} <= 0
        OR ${users.storageUsed} + ${requestedBytes} <= ${users.storageLimit}
      )
    `,
    )
    .returning({ id: users.id });

  if (updated) {
    return { ok: true, requestedBytes };
  }

  const user = await getUserById(id);
  if (!user) {
    return { ok: false, reason: "not_found", requestedBytes };
  }

  return {
    ok: false,
    reason: "limit",
    requestedBytes,
    storageLimit: user.storageLimit,
    storageUsed: user.storageUsed,
  };
}

export async function decrementStorageUsage(id: string, bytes: number): Promise<void> {
  if (!Number.isFinite(bytes) || bytes <= 0) return;
  const releasedBytes = Math.floor(bytes);
  await db
    .update(users)
    .set({
      storageUsed: sql`max(0, ${users.storageUsed} - ${releasedBytes})`,
      updatedAt: new Date(),
    } as any)
    .where(eq(users.id, id));
}

export async function resetTokenUsage(id: string): Promise<void> {
  await db
    .update(users)
    .set({ tokensUsed: 0, billingCycleStart: new Date(), updatedAt: new Date() } as any)
    .where(eq(users.id, id));
}
