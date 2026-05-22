import { and, desc, eq } from "drizzle-orm";
import {
  writingStyles,
  type InsertWritingStyle,
  type WritingStyle,
} from "@shared/schema";
import { db } from "./db";

export const writingStyleStorage = {
  async createWritingStyle(data: InsertWritingStyle): Promise<WritingStyle> {
    const [created] = await db.insert(writingStyles).values(data as any).returning();
    return created;
  },

  async getWritingStyle(id: string): Promise<WritingStyle | undefined> {
    const [style] = await db.select().from(writingStyles).where(eq(writingStyles.id, id));
    return style;
  },

  async getWritingStyleForUser(id: string, userId: string): Promise<WritingStyle | undefined> {
    const [style] = await db
      .select()
      .from(writingStyles)
      .where(and(eq(writingStyles.id, id), eq(writingStyles.userId, userId)));
    return style;
  },

  async getWritingStylesForUser(userId: string): Promise<WritingStyle[]> {
    return db
      .select()
      .from(writingStyles)
      .where(eq(writingStyles.userId, userId))
      .orderBy(desc(writingStyles.updatedAt));
  },

  async getWritingStyleByNameForUser(name: string, userId: string): Promise<WritingStyle | undefined> {
    const [style] = await db
      .select()
      .from(writingStyles)
      .where(and(eq(writingStyles.name, name), eq(writingStyles.userId, userId)));
    return style;
  },

  async updateWritingStyle(
    id: string,
    data: Partial<Omit<InsertWritingStyle, "userId">>,
  ): Promise<WritingStyle | undefined> {
    const [updated] = await db
      .update(writingStyles)
      .set({ ...data, updatedAt: new Date() } as any)
      .where(eq(writingStyles.id, id))
      .returning();
    return updated;
  },

  async deleteWritingStyle(id: string): Promise<void> {
    await db.delete(writingStyles).where(eq(writingStyles.id, id));
  },
};
