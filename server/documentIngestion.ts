import { storage } from "./storage";
import { chunkTextV2 } from "./pipelineV2";
import { generateDocumentSummary } from "./openai";
import { saveDocumentSource } from "./sourceFiles";
import type { Document } from "@shared/schema";

export interface CreateTextBackedDocumentInput {
  filename: string;
  fullText: string;
  sourceBuffer: Buffer;
  userId: string;
}

const DEFAULT_PASTED_SOURCE_NAME = "Pasted Source";

function sanitizeSourceTitle(title: string): string {
  const cleaned = title
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return DEFAULT_PASTED_SOURCE_NAME;
  }

  return cleaned.slice(0, 120).trim() || DEFAULT_PASTED_SOURCE_NAME;
}

export function normalizePastedSourceFilename(title?: string): string {
  const baseName = sanitizeSourceTitle(title ?? "");
  return baseName.toLowerCase().endsWith(".txt") ? baseName : `${baseName}.txt`;
}

export async function createTextBackedDocument({
  filename,
  fullText,
  sourceBuffer,
  userId,
}: CreateTextBackedDocumentInput): Promise<Document> {
  const normalizedText = fullText.trim();
  if (normalizedText.length < 10) {
    throw new Error("Could not extract text from file");
  }

  const doc = await storage.createDocument({
    filename,
    fullText: normalizedText,
    userId,
  } as any);
  await saveDocumentSource(doc.id, filename, sourceBuffer);

  const chunks = chunkTextV2(normalizedText);
  for (const chunk of chunks) {
    await storage.createChunk({
      documentId: doc.id,
      text: chunk.text,
      startPosition: chunk.originalStartPosition,
      endPosition: chunk.originalStartPosition + chunk.text.length,
    });
  }

  await storage.updateDocument(doc.id, { chunkCount: chunks.length });

  generateDocumentSummary(normalizedText)
    .then(async (summaryData) => {
      await storage.updateDocument(doc.id, {
        summary: summaryData.summary,
        mainArguments: summaryData.mainArguments,
        keyConcepts: summaryData.keyConcepts,
      });
    })
    .catch((error) => {
      console.error(`Failed to generate summary for document ${doc.id}:`, error);
    });

  const storedDoc = await storage.getDocument(doc.id);
  if (!storedDoc) {
    throw new Error(`Document ${doc.id} was created but could not be reloaded`);
  }

  return storedDoc;
}
