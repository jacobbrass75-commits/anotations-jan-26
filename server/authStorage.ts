import { users, type User } from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;

export interface RegisterData {
  email: string;
  username: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

/** Strip password from user object before returning to clients */
export function sanitizeUser(user: User): Omit<User, "password"> {
  const { password, ...rest } = user;
  return rest;
}

export async function createUser(data: RegisterData): Promise<User> {
  const hashedPassword = await bcrypt.hash(data.password, SALT_ROUNDS);
  const now = new Date();
  const [created] = await db
    .insert(users)
    .values({
      email: data.email,
      username: data.username,
      password: hashedPassword,
      firstName: data.firstName || null,
      lastName: data.lastName || null,
      tier: "free",
      tokensUsed: 0,
      tokenLimit: 50000,
      storageUsed: 0,
      storageLimit: 52428800,
      emailVerified: false,
      billingCycleStart: now,
      createdAt: now,
      updatedAt: now,
    } as any)
    .returning();
  return created;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  return user || null;
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.username, username));
  return user || null;
}

export async function getUserById(id: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
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
