import {
  documents,
  textChunks,
  annotations,
  type Document,
  type InsertDocument,
  type TextChunk,
  type InsertTextChunk,
  type Annotation,
  type InsertAnnotation,
  type AnnotationCategory,
} from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";

export interface IStorage {
  // Documents
  getDocument(id: string): Promise<Document | undefined>;
  getAllDocuments(): Promise<Document[]>;
  getAllDocumentMeta(): Promise<Array<Pick<Document, "id" | "filename" | "uploadDate" | "summary" | "chunkCount" | "status" | "processingError">>>;
  createDocument(doc: InsertDocument): Promise<Document>;
  updateDocument(id: string, updates: Partial<Document>): Promise<Document | undefined>;
  deleteDocument(id: string): Promise<void>;

  // Text Chunks
  getChunksForDocument(documentId: string): Promise<TextChunk[]>;
  createChunk(chunk: InsertTextChunk): Promise<TextChunk>;
  updateChunkEmbedding(chunkId: string, embedding: number[]): Promise<void>;

  // Annotations
  getAnnotationsForDocument(documentId: string): Promise<Annotation[]>;
  getAnnotation(id: string): Promise<Annotation | undefined>;
  createAnnotation(annotation: InsertAnnotation): Promise<Annotation>;
  updateAnnotation(id: string, note: string, category: AnnotationCategory): Promise<Annotation | undefined>;
  deleteAnnotation(id: string): Promise<void>;
  deleteAnnotationsForDocument(documentId: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // Documents
  async getDocument(id: string): Promise<Document | undefined> {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id));
    return doc || undefined;
  }

  async getAllDocuments(): Promise<Document[]> {
    return db.select().from(documents);
  }

  async getAllDocumentMeta(): Promise<
    Array<
      Pick<
        Document,
        "id" | "filename" | "uploadDate" | "summary" | "chunkCount" | "status" | "processingError"
      >
    >
  > {
    return db
      .select({
        id: documents.id,
        filename: documents.filename,
        uploadDate: documents.uploadDate,
        summary: documents.summary,
        chunkCount: documents.chunkCount,
        status: documents.status,
        processingError: documents.processingError,
      })
      .from(documents);
  }

  async createDocument(doc: InsertDocument): Promise<Document> {
    const [created] = await db.insert(documents).values(doc as any).returning();
    return created;
  }

  async updateDocument(id: string, updates: Partial<Document>): Promise<Document | undefined> {
    const [updated] = await db
      .update(documents)
      .set(updates)
      .where(eq(documents.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteDocument(id: string): Promise<void> {
    await db.delete(documents).where(eq(documents.id, id));
  }

  // Text Chunks
  async getChunksForDocument(documentId: string): Promise<TextChunk[]> {
    return db.select().from(textChunks).where(eq(textChunks.documentId, documentId));
  }

  async createChunk(chunk: InsertTextChunk): Promise<TextChunk> {
    const [created] = await db.insert(textChunks).values(chunk as any).returning();
    return created;
  }

  async updateChunkEmbedding(chunkId: string, embedding: number[]): Promise<void> {
    await db.update(textChunks).set({ embedding }).where(eq(textChunks.id, chunkId));
  }

  // Annotations
  async getAnnotationsForDocument(documentId: string): Promise<Annotation[]> {
    return db.select().from(annotations).where(eq(annotations.documentId, documentId));
  }

  async getAnnotation(id: string): Promise<Annotation | undefined> {
    const [ann] = await db.select().from(annotations).where(eq(annotations.id, id));
    return ann || undefined;
  }

  async createAnnotation(annotation: InsertAnnotation): Promise<Annotation> {
    const [created] = await db.insert(annotations).values(annotation as any).returning();
    return created;
  }

  async updateAnnotation(id: string, note: string, category: AnnotationCategory): Promise<Annotation | undefined> {
    const [updated] = await db
      .update(annotations)
      .set({ note, category })
      .where(eq(annotations.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteAnnotation(id: string): Promise<void> {
    await db.delete(annotations).where(eq(annotations.id, id));
  }

  async deleteAnnotationsForDocument(documentId: string): Promise<void> {
    await db.delete(annotations).where(eq(annotations.documentId, documentId));
  }
}

export const storage = new DatabaseStorage();
