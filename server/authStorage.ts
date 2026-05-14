import { users, type User } from "@shared/schema";
import { db } from "./db";
import { eq, sql } from "drizzle-orm";

/** Strip password from user object before returning to clients */
export function sanitizeUser(user: User): Omit<User, "password"> {
  const { password, ...rest } = user;
  return rest;
}

/**
 * Get or create a local user record for a Clerk user.
 * The local record tracks usage (tokens, storage) and tier.
 *
 * If a new Clerk instance returns a different user id for an email that already
 * exists locally, keep using the local row so existing projects/documents stay
 * attached to that account.
 */
export async function getOrCreateUser(
  clerkUserId: string,
  email: string,
  tier: string | null,
): Promise<User> {
  const normalizedEmail = normalizeUserEmail(email);
  if (!normalizedEmail) {
    throw new Error("Clerk user is missing an email address");
  }

  const existing = await getUserById(clerkUserId);
  if (existing) {
    return await syncExplicitTier(existing, tier);
  }

  const existingByEmail = await getUserByEmail(normalizedEmail);
  if (existingByEmail) {
    return await syncExplicitTier(existingByEmail, tier);
  }

  // Create new local record
  const now = new Date();
  const resolvedTier = tier ?? "max";
  const [created] = await db
    .insert(users)
    .values({
      id: clerkUserId,
      email: normalizedEmail,
      username: normalizedEmail, // default username to email
      password: "", // not used with Clerk
      tier: resolvedTier,
      tokensUsed: 0,
      tokenLimit: 50000,
      storageUsed: 0,
      storageLimit: 52428800,
      emailVerified: true, // Clerk handles verification
      billingCycleStart: now,
      createdAt: now,
      updatedAt: now,
    } as any)
    .returning();
  return created;
}

function normalizeUserEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function syncExplicitTier(user: User, tier: string | null): Promise<User> {
  if (tier && user.tier !== tier) {
    return await updateUser(user.id, { tier } as Partial<User>);
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

export async function updateUser(id: string, data: Partial<User>): Promise<User> {
  const [updated] = await db
    .update(users)
    .set({ ...data, updatedAt: new Date() } as any)
    .where(eq(users.id, id))
    .returning();
  return updated;
}

export async function incrementTokenUsage(id: string, tokens: number): Promise<void> {
  const user = await getUserById(id);
  if (!user) throw new Error("User not found");
  await db
    .update(users)
    .set({ tokensUsed: user.tokensUsed + tokens, updatedAt: new Date() } as any)
    .where(eq(users.id, id));
}

export async function resetTokenUsage(id: string): Promise<void> {
  await db
    .update(users)
    .set({ tokensUsed: 0, billingCycleStart: new Date(), updatedAt: new Date() } as any)
    .where(eq(users.id, id));
}
