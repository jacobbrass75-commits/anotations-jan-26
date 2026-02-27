import {
  conversations,
  messages,
  type Conversation,
  type InsertConversation,
  type Message,
  type InsertMessage,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, asc } from "drizzle-orm";

export const chatStorage = {
  async createConversation(data: InsertConversation): Promise<Conversation> {
    const [created] = await db.insert(conversations).values(data as any).returning();
    return created;
  },

  async getConversation(id: string): Promise<Conversation | null> {
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    return conv || null;
  },

  async getConversationsForUser(userId?: string): Promise<Conversation[]> {
    // Until auth is merged, return all conversations ordered by updatedAt desc
    return db.select().from(conversations).orderBy(desc(conversations.updatedAt));
  },

  async updateConversation(id: string, data: Partial<Pick<Conversation, "title" | "model">>): Promise<Conversation> {
    const [updated] = await db
      .update(conversations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(conversations.id, id))
      .returning();
    return updated;
  },

  async deleteConversation(id: string): Promise<void> {
    await db.delete(conversations).where(eq(conversations.id, id));
  },

  async getMessagesForConversation(conversationId: string): Promise<Message[]> {
    return db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt));
  },

  async createMessage(data: InsertMessage): Promise<Message> {
    const [created] = await db.insert(messages).values(data as any).returning();
    // Touch the conversation's updatedAt
    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, data.conversationId));
    return created;
  },
};
