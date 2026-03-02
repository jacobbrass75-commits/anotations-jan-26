import { db } from "./db";
import { eq } from "drizzle-orm";
import { documents, projectDocuments, textChunks } from "@shared/schema";

/**
 * Find the chunk index nearest to a character position in a document.
 */
export function findNearestChunkIndex(
  chunks: Array<{ startPosition: number; endPosition: number }>,
  position: number
): number {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < chunks.length; i++) {
    const mid = (chunks[i].startPosition + chunks[i].endPosition) / 2;
    const dist = Math.abs(mid - position);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Load surrounding text around a position in a document.
 * Returns the chunk containing the position plus adjacent chunks for context.
 */
export async function loadSurroundingChunks(
  documentId: string,
  position: number,
  contextChars: number = 500
): Promise<{ before: string; target: string; after: string } | null> {
  // Get the underlying document via projectDocuments if this is a project doc ID
  let docId = documentId;

  const [projDoc] = await db
    .select()
    .from(projectDocuments)
    .where(eq(projectDocuments.id, documentId));
  if (projDoc) {
    docId = projDoc.documentId;
  }

  const [doc] = await db.select().from(documents).where(eq(documents.id, docId));
  if (!doc) return null;

  const fullText = doc.fullText;
  const clampedPos = Math.max(0, Math.min(position, fullText.length));

  const beforeStart = Math.max(0, clampedPos - contextChars);
  const afterEnd = Math.min(fullText.length, clampedPos + contextChars);

  // Find a reasonable target snippet around the position
  const targetStart = Math.max(0, clampedPos - 100);
  const targetEnd = Math.min(fullText.length, clampedPos + 100);

  return {
    before: fullText.slice(beforeStart, targetStart),
    target: fullText.slice(targetStart, targetEnd),
    after: fullText.slice(targetEnd, afterEnd),
  };
}

/**
 * Load the full text of a project document.
 */
export async function loadDocumentText(
  projectDocId: string
): Promise<{ text: string; filename: string } | null> {
  const [projDoc] = await db
    .select()
    .from(projectDocuments)
    .where(eq(projectDocuments.id, projectDocId));
  if (!projDoc) return null;

  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, projDoc.documentId));
  if (!doc) return null;

  return { text: doc.fullText, filename: doc.filename };
}
