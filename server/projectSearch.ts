import { db } from "./db";
import { eq } from "drizzle-orm";
import {
  projects,
  folders,
  projectDocuments,
  projectAnnotations,
  documents,
  type GlobalSearchResult,
  type AnnotationCategory,
  type SearchResult,
} from "@shared/schema";
import { getEmbeddingWithUsage, cosineSimilarity, searchDocument } from "./openai";
import { storage } from "./storage";
import type { TokenUsageReporter } from "./aiUsage";

const TEXT_MATCH_SCORE = 0.6;

interface SearchFilters {
  categories?: AnnotationCategory[];
  folderIds?: string[];
  documentIds?: string[];
}

interface SearchResponse {
  results: GlobalSearchResult[];
  totalResults: number;
  searchTime: number;
}

function textMatchScore(query: string, text: string): number {
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();
  
  if (textLower.includes(queryLower)) {
    return TEXT_MATCH_SCORE + 0.3;
  }
  
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
  if (queryWords.length === 0) return 0;
  
  let matchedWords = 0;
  for (const word of queryWords) {
    if (textLower.includes(word)) {
      matchedWords++;
    }
  }
  
  const matchRatio = matchedWords / queryWords.length;
  return matchRatio >= 0.5 ? TEXT_MATCH_SCORE * matchRatio : 0;
}

export async function globalSearch(
  projectId: string,
  query: string,
  filters?: SearchFilters,
  limit: number = 20
): Promise<SearchResponse> {
  const startTime = Date.now();
  const results: GlobalSearchResult[] = [];

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) {
    return { results: [], totalResults: 0, searchTime: Date.now() - startTime };
  }

  if (project.contextSummary || project.thesis) {
    const textToMatch = [project.contextSummary, project.thesis, project.name].filter(Boolean).join(' ');
    const score = textMatchScore(query, textToMatch);
    if (score > 0) {
      results.push({
        type: 'folder_context',
        matchedText: project.contextSummary || project.thesis || project.name,
        similarityScore: score,
        relevanceLevel: getRelevanceLevel(score),
      });
    }
  }

  const projectFolders = await db
    .select()
    .from(folders)
    .where(eq(folders.projectId, projectId));

  for (const folder of projectFolders) {
    if (filters?.folderIds && !filters.folderIds.includes(folder.id)) continue;
    
    const textToMatch = [folder.contextSummary, folder.description, folder.name].filter(Boolean).join(' ');
    const score = textMatchScore(query, textToMatch);
    if (score > 0) {
      results.push({
        type: 'folder_context',
        folderId: folder.id,
        folderName: folder.name,
        matchedText: folder.contextSummary || folder.description || folder.name,
        similarityScore: score,
        relevanceLevel: getRelevanceLevel(score),
      });
    }
  }

  const projectDocs = await db
    .select({
      projectDoc: projectDocuments,
      doc: documents,
    })
    .from(projectDocuments)
    .innerJoin(documents, eq(projectDocuments.documentId, documents.id))
    .where(eq(projectDocuments.projectId, projectId));

  for (const { projectDoc, doc } of projectDocs) {
    if (filters?.documentIds && !filters.documentIds.includes(projectDoc.id)) continue;
    if (filters?.folderIds && projectDoc.folderId && !filters.folderIds.includes(projectDoc.folderId)) continue;

    const textToMatch = [projectDoc.retrievalContext, doc.summary, doc.filename].filter(Boolean).join(' ');
    const score = textMatchScore(query, textToMatch);
    if (score > 0) {
      results.push({
        type: 'document_context',
        documentId: projectDoc.id,
        documentFilename: doc.filename,
        folderId: projectDoc.folderId || undefined,
        matchedText: projectDoc.retrievalContext || doc.summary || doc.filename,
        citationData: projectDoc.citationData || undefined,
        similarityScore: score,
        relevanceLevel: getRelevanceLevel(score),
      });
    }
  }

  const allAnnotations = await db
    .select({
      annotation: projectAnnotations,
      projectDoc: projectDocuments,
      doc: documents,
    })
    .from(projectAnnotations)
    .innerJoin(projectDocuments, eq(projectAnnotations.projectDocumentId, projectDocuments.id))
    .innerJoin(documents, eq(projectDocuments.documentId, documents.id))
    .where(eq(projectDocuments.projectId, projectId));

  for (const { annotation, projectDoc, doc } of allAnnotations) {
    if (filters?.categories && !filters.categories.includes(annotation.category as AnnotationCategory)) continue;
    if (filters?.documentIds && !filters.documentIds.includes(projectDoc.id)) continue;
    if (filters?.folderIds && projectDoc.folderId && !filters.folderIds.includes(projectDoc.folderId)) continue;

    const textToMatch = [annotation.searchableContent, annotation.highlightedText, annotation.note].filter(Boolean).join(' ');
    const score = textMatchScore(query, textToMatch);
    if (score > 0) {
      results.push({
        type: 'annotation',
        documentId: projectDoc.id,
        documentFilename: doc.filename,
        folderId: projectDoc.folderId || undefined,
        annotationId: annotation.id,
        matchedText: annotation.searchableContent || annotation.highlightedText,
        highlightedText: annotation.highlightedText,
        note: annotation.note || undefined,
        category: annotation.category as AnnotationCategory,
        citationData: projectDoc.citationData || undefined,
        similarityScore: score,
        relevanceLevel: getRelevanceLevel(score),
        startPosition: annotation.startPosition,
      });
    }
  }

  results.sort((a, b) => b.similarityScore - a.similarityScore);
  const limitedResults = results.slice(0, limit);

  return {
    results: limitedResults,
    totalResults: results.length,
    searchTime: Date.now() - startTime,
  };
}

function getRelevanceLevel(similarity: number): 'high' | 'medium' | 'low' {
  if (similarity >= 0.7) return 'high';
  if (similarity >= 0.5) return 'medium';
  return 'low';
}

/**
 * Search within a single project document using semantic search
 */
export async function searchProjectDocument(
  projectDocId: string,
  query: string,
  onTokenUsage?: TokenUsageReporter,
): Promise<SearchResult[]> {
  // Get the project document
  const [projectDoc] = await db
    .select()
    .from(projectDocuments)
    .where(eq(projectDocuments.id, projectDocId));

  if (!projectDoc) {
    throw new Error("Project document not found");
  }

  // Get the underlying document
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, projectDoc.documentId));

  if (!doc) {
    throw new Error("Document not found");
  }

  // Get project for context
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectDoc.projectId));

  // Get chunks for this document
  const docChunks = await storage.getChunksForDocument(doc.id);

  if (docChunks.length === 0) {
    return [];
  }

  // Generate query embedding
  const queryEmbedding = await getEmbeddingWithUsage(query, onTokenUsage);

  // Rank chunks by similarity
  const rankedChunks = docChunks
    .filter((c) => c.embedding)
    .map((chunk) => ({
      text: chunk.text,
      startPosition: chunk.startPosition,
      endPosition: chunk.endPosition,
      similarity: cosineSimilarity(chunk.embedding!, queryEmbedding),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);

  if (rankedChunks.length === 0) {
    return [];
  }

  // Build research context from project thesis if available
  const researchContext = project?.thesis || doc.userIntent || "";

  // Use LLM to find relevant quotes
  const results = await searchDocument(query, researchContext, rankedChunks, onTokenUsage);

  return results;
}
