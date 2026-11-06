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
import { currentAnnotationSearchText } from "./annotationSearchIndex";
import type { TokenUsageReporter } from "./aiUsage";

const TEXT_MATCH_SCORE = 0.6;
// Raw source passages rank just below an annotation or context with the same match,
// so a saved note on a passage outranks the bare text around it.
const SOURCE_TEXT_WEIGHT = 0.9;
const SOURCE_PASSAGES_PER_DOCUMENT = 3;
const SOURCE_WINDOW_SIZE = 400;
const SOURCE_WINDOW_STEP = 200;
const SOURCE_SNIPPET_RADIUS = 160;

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

  const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2);
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

interface SourcePassageMatch {
  /** Offsets of matchedText in the source's full text: fullText.slice(start, end). */
  startPosition: number;
  endPosition: number;
  /** Exact source text around the match, unmodified, so it can be quoted as is. */
  matchedText: string;
  score: number;
}

interface PassageHit {
  matchStart: number;
  matchEnd: number;
  score: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Bounds of a passage around a match: about SOURCE_SNIPPET_RADIUS characters each side,
 * cut at whitespace so no word is split, with surrounding whitespace excluded. The text
 * itself is never rewritten.
 */
function passageBounds(text: string, start: number, end: number): [number, number] {
  let from = Math.max(0, start - SOURCE_SNIPPET_RADIUS);
  let to = Math.min(text.length, end + SOURCE_SNIPPET_RADIUS);
  if (from > 0 && !/\s/.test(text[from - 1])) {
    const firstSpace = text.slice(from, start).search(/\s/);
    if (firstSpace !== -1) from += firstSpace + 1;
  }
  if (to < text.length && !/\s/.test(text[to])) {
    const lastSpace = text.slice(end, to).search(/\s\S*$/);
    if (lastSpace !== -1) to = end + lastSpace;
  }
  while (from < start && /\s/.test(text[from])) from += 1;
  while (to > end && /\s/.test(text[to - 1])) to -= 1;
  return [from, to];
}

/**
 * Keyword passages in a source's stored full text, scored like the rest of project
 * search: an exact phrase (whitespace-tolerant, case-insensitive) first, otherwise
 * windows where at least half of the query words appear. Each passage is an exact
 * slice of the full text, in the same coordinates annotations and read_source_text use.
 * Matches inside excludeRanges (annotations that already matched) are skipped.
 */
export function findSourcePassages(
  fullText: string,
  query: string,
  options: { excludeRanges?: Array<[number, number]>; maxMatches?: number } = {},
): SourcePassageMatch[] {
  const phrase = query.trim();
  if (!phrase || !fullText) return [];
  const maxMatches = options.maxMatches ?? SOURCE_PASSAGES_PER_DOCUMENT;
  const excludeRanges = options.excludeRanges ?? [];
  const isExcluded = (start: number, end: number) =>
    excludeRanges.some(([rangeStart, rangeEnd]) => start < rangeEnd && end > rangeStart);
  const toPassages = (hits: PassageHit[]): SourcePassageMatch[] =>
    hits.map(({ matchStart, matchEnd, score }) => {
      const [startPosition, endPosition] = passageBounds(fullText, matchStart, matchEnd);
      return {
        startPosition,
        endPosition,
        matchedText: fullText.slice(startPosition, endPosition),
        score,
      };
    });

  const phraseHits: PassageHit[] = [];
  const phrasePattern = new RegExp(phrase.split(/\s+/).map(escapeRegExp).join("\\s+"), "gi");
  let match: RegExpExecArray | null;
  while ((match = phrasePattern.exec(fullText)) !== null) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    if (isExcluded(matchStart, matchEnd)) continue;
    phraseHits.push({ matchStart, matchEnd, score: (TEXT_MATCH_SCORE + 0.3) * SOURCE_TEXT_WEIGHT });
    if (phraseHits.length >= maxMatches) break;
  }
  if (phraseHits.length > 0) return toPassages(phraseHits);

  const queryWords = phrase
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2);
  if (queryWords.length < 2) return [];
  const lowerText = fullText.toLowerCase();
  const presentWords = queryWords.filter((word) => lowerText.includes(word));
  if (presentWords.length / queryWords.length < 0.5) return [];

  // Case-insensitive patterns on the original text keep offsets exact even where
  // lowercasing would change a string's length.
  const wordPatterns = presentWords.map((word) => new RegExp(escapeRegExp(word), "i"));
  const windows: PassageHit[] = [];
  for (let start = 0; start < fullText.length; start += SOURCE_WINDOW_STEP) {
    const window = fullText.slice(start, start + SOURCE_WINDOW_SIZE);
    const score = textMatchScore(phrase, window);
    const hits =
      score > 0
        ? wordPatterns
            .map((pattern) => pattern.exec(window))
            .filter((hit): hit is RegExpExecArray => hit !== null)
        : [];
    if (hits.length > 0) {
      const matchStart = start + Math.min(...hits.map((hit) => hit.index));
      const matchEnd = start + Math.max(...hits.map((hit) => hit.index + hit[0].length));
      if (!isExcluded(matchStart, matchEnd)) {
        windows.push({ matchStart, matchEnd, score: score * SOURCE_TEXT_WEIGHT });
      }
    }
    if (start + SOURCE_WINDOW_SIZE >= fullText.length) break;
  }

  windows.sort((a, b) => b.score - a.score || a.matchStart - b.matchStart);
  const kept: PassageHit[] = [];
  for (const candidate of windows) {
    if (kept.length >= maxMatches) break;
    const overlaps = kept.some(
      (hit) => Math.abs(hit.matchStart - candidate.matchStart) < SOURCE_WINDOW_SIZE,
    );
    if (!overlaps) kept.push(candidate);
  }
  return toPassages(kept);
}

export async function globalSearch(
  projectId: string,
  query: string,
  filters?: SearchFilters,
  limit: number = 20,
  options: { includeSourceText?: boolean } = {},
): Promise<SearchResponse> {
  const startTime = Date.now();
  const results: GlobalSearchResult[] = [];

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) {
    return { results: [], totalResults: 0, searchTime: Date.now() - startTime };
  }

  if (project.contextSummary || project.thesis) {
    const textToMatch = [project.contextSummary, project.thesis, project.name]
      .filter(Boolean)
      .join(" ");
    const score = textMatchScore(query, textToMatch);
    if (score > 0) {
      results.push({
        type: "folder_context",
        matchedText: project.contextSummary || project.thesis || project.name,
        similarityScore: score,
        relevanceLevel: getRelevanceLevel(score),
      });
    }
  }

  const projectFolders = await db.select().from(folders).where(eq(folders.projectId, projectId));

  for (const folder of projectFolders) {
    if (filters?.folderIds && !filters.folderIds.includes(folder.id)) continue;

    const textToMatch = [folder.contextSummary, folder.description, folder.name]
      .filter(Boolean)
      .join(" ");
    const score = textMatchScore(query, textToMatch);
    if (score > 0) {
      results.push({
        type: "folder_context",
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
    if (
      filters?.folderIds &&
      projectDoc.folderId &&
      !filters.folderIds.includes(projectDoc.folderId)
    )
      continue;

    const textToMatch = [projectDoc.retrievalContext, doc.summary, doc.filename]
      .filter(Boolean)
      .join(" ");
    const score = textMatchScore(query, textToMatch);
    if (score > 0) {
      results.push({
        type: "document_context",
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

  const matchedAnnotationRanges = new Map<string, Array<[number, number]>>();
  for (const { annotation, projectDoc, doc } of allAnnotations) {
    if (
      filters?.categories &&
      !filters.categories.includes(annotation.category as AnnotationCategory)
    )
      continue;
    if (filters?.documentIds && !filters.documentIds.includes(projectDoc.id)) continue;
    if (
      filters?.folderIds &&
      projectDoc.folderId &&
      !filters.folderIds.includes(projectDoc.folderId)
    )
      continue;

    // Match the annotation as it is now. The persisted searchableContent can predate an
    // edit (rows edited before edits re-indexed), and it never holds more than the
    // category tag, highlighted text, and note, so rebuilding it loses no context.
    const searchText = currentAnnotationSearchText(annotation);
    const score = textMatchScore(query, searchText);
    if (score > 0) {
      results.push({
        type: "annotation",
        documentId: projectDoc.id,
        documentFilename: doc.filename,
        folderId: projectDoc.folderId || undefined,
        annotationId: annotation.id,
        matchedText: searchText,
        highlightedText: annotation.highlightedText,
        note: annotation.note || undefined,
        category: annotation.category as AnnotationCategory,
        citationData: projectDoc.citationData || undefined,
        similarityScore: score,
        relevanceLevel: getRelevanceLevel(score),
        startPosition: annotation.startPosition,
      });
      const ranges = matchedAnnotationRanges.get(projectDoc.id) ?? [];
      ranges.push([annotation.startPosition, annotation.endPosition]);
      matchedAnnotationRanges.set(projectDoc.id, ranges);
    }
  }

  // Unannotated source passages, for callers that opt in (the MCP search tools). The web
  // workspace's result card and copy actions are built for annotations and contexts, so
  // it does not ask for them. Only sources the project owner can read are scanned (the
  // same ownership rule as read_source_text), and only once they finish processing, so
  // partial OCR text is never returned. A category filter asks for annotations, so it
  // leaves raw text out. Passages inside a matching annotation are covered by it.
  if (options.includeSourceText && !filters?.categories?.length) {
    for (const { projectDoc, doc } of projectDocs) {
      if (doc.userId !== project.userId || doc.status !== "ready") continue;
      if (filters?.documentIds && !filters.documentIds.includes(projectDoc.id)) continue;
      if (
        filters?.folderIds &&
        projectDoc.folderId &&
        !filters.folderIds.includes(projectDoc.folderId)
      )
        continue;

      const passages = findSourcePassages(doc.fullText, query, {
        excludeRanges: matchedAnnotationRanges.get(projectDoc.id),
      });
      for (const passage of passages) {
        results.push({
          type: "source_text",
          documentId: projectDoc.id,
          documentFilename: doc.filename,
          folderId: projectDoc.folderId || undefined,
          matchedText: passage.matchedText,
          citationData: projectDoc.citationData || undefined,
          similarityScore: passage.score,
          relevanceLevel: getRelevanceLevel(passage.score),
          startPosition: passage.startPosition,
          endPosition: passage.endPosition,
        });
      }
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

function getRelevanceLevel(similarity: number): "high" | "medium" | "low" {
  if (similarity >= 0.7) return "high";
  if (similarity >= 0.5) return "medium";
  return "low";
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
  const [doc] = await db.select().from(documents).where(eq(documents.id, projectDoc.documentId));

  if (!doc) {
    throw new Error("Document not found");
  }

  // Get project for context
  const [project] = await db.select().from(projects).where(eq(projects.id, projectDoc.projectId));

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
