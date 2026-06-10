import { storage } from "../storage";
import { getToolResponseLimit, truncateToolResult } from "../contextCompaction";
import { formatSourceStubByRole } from "../sourceRoles";
import type { ResearchFinding } from "../researchAgent";
import type { TieredSource } from "../writingPipeline";
import { clipText } from "./shared";
import { parseStyleAnalysisValue } from "./promptBuilder";

interface SourceToolInput {
  docId?: string;
  query?: string;
  maxItems?: number;
}

export function buildSourceTools() {
  return [
    {
      name: "get_source_summary",
      description: "Get the compact summary and high-level arguments for a source document.",
      input_schema: {
        type: "object",
        properties: {
          docId: { type: "string", description: "The document id to summarize." },
        },
        required: ["docId"],
      },
    },
    {
      name: "get_source_chunks",
      description: "Get specific annotated passages or chunk excerpts from an evidence source.",
      input_schema: {
        type: "object",
        properties: {
          docId: { type: "string", description: "The document id to inspect." },
          query: { type: "string", description: "What evidence or theme to look for." },
          maxItems: { type: "integer", description: "Maximum passages to return." },
        },
        required: ["docId"],
      },
    },
  ];
}

function normalizeSourceToolInput(input: unknown): SourceToolInput {
  if (!input || typeof input !== "object") {
    return {};
  }

  const value = input as Record<string, unknown>;
  return {
    docId: typeof value.docId === "string" ? value.docId : undefined,
    query: typeof value.query === "string" ? value.query : undefined,
    maxItems: typeof value.maxItems === "number" ? value.maxItems : undefined,
  };
}

function getQueryTerms(query?: string): string[] {
  if (!query) return [];
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2);
}

function scoreAnnotationMatch(
  annotation: TieredSource["annotations"][number],
  queryTerms: string[],
): number {
  if (queryTerms.length === 0) return 0;
  const haystack = `${annotation.highlightedText} ${annotation.note || ""}`.toLowerCase();
  return queryTerms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function formatSourceSummary(source: TieredSource): string {
  const parts = [
    formatSourceStubByRole({
      id: source.id,
      title: source.title,
      sourceRole: source.sourceRole || "evidence",
      styleAnalysis: parseStyleAnalysisValue(source.styleAnalysis),
      summary: source.summary,
      annotationCount: source.annotations.length,
      chunkCount: source.chunkCount,
    }),
  ];

  if (source.summary) {
    parts.push(`Summary: ${source.summary}`);
  }
  if (source.mainArguments?.length) {
    parts.push(`Main arguments: ${source.mainArguments.join("; ")}`);
  }
  if (source.keyConcepts?.length) {
    parts.push(`Key concepts: ${source.keyConcepts.join(", ")}`);
  }

  return parts.join("\n");
}

export function createSourceToolExecutor(sources: TieredSource[]) {
  const sourceByDocId = new Map<string, TieredSource>();
  for (const source of sources) {
    sourceByDocId.set(source.documentId, source);
    sourceByDocId.set(source.id, source);
  }

  const toolLimit = getToolResponseLimit(sources.length);

  return async (name: string, input: unknown): Promise<string> => {
    const { docId, query, maxItems } = normalizeSourceToolInput(input);
    if (!docId) {
      return "[TOOL ERROR] Missing docId.";
    }

    const source = sourceByDocId.get(docId);
    if (!source) {
      return `[TOOL ERROR] Source "${docId}" was not found.`;
    }

    if (name === "get_source_summary") {
      return truncateToolResult(formatSourceSummary(source), toolLimit);
    }

    if (name === "get_source_chunks") {
      const queryTerms = getQueryTerms(query);
      const annotationLimit = Math.max(1, Math.min(maxItems || 4, 6));
      const rankedAnnotations = [...source.annotations]
        .map((annotation) => ({
          annotation,
          score: scoreAnnotationMatch(annotation, queryTerms),
        }))
        .sort((left, right) => right.score - left.score);

      if (rankedAnnotations.length > 0) {
        const annotationText = rankedAnnotations
          .slice(0, annotationLimit)
          .map(({ annotation }, index) => {
            const lines = [
              `[ANNOTATION ${index + 1}] chars ${annotation.startPosition}-${annotation.endPosition} | category: ${annotation.category}`,
              `"${clipText(annotation.highlightedText, 1200) || annotation.highlightedText}"`,
            ];
            if (annotation.note) {
              lines.push(`Note: ${annotation.note}`);
            }
            return lines.join("\n");
          })
          .join("\n\n");

        return truncateToolResult(annotationText, toolLimit);
      }

      const chunks = await storage.getChunksForDocument(source.documentId);
      const chunkText = chunks
        .slice(0, annotationLimit)
        .map(
          (chunk, index) =>
            `[CHUNK ${index + 1}] chars ${chunk.startPosition}-${chunk.endPosition}\n${clipText(chunk.text, 1200) || chunk.text}`,
        )
        .join("\n\n");

      return truncateToolResult(
        chunkText || "[NO EVIDENCE] No annotations or chunks were available for this source.",
        toolLimit,
      );
    }

    return `[TOOL ERROR] Unsupported tool "${name}".`;
  };
}

function findNearestChunkIndex(
  chunks: Array<{ startPosition: number; endPosition: number }>,
  targetStart: number,
): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const distance = Math.min(
      Math.abs(chunk.startPosition - targetStart),
      Math.abs(chunk.endPosition - targetStart),
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }

  return bestIndex;
}

export async function loadSurroundingChunks(
  documentId: string,
  annotationStartPosition: number,
  annotationEndPosition: number,
  chunksBefore = 4,
  chunksAfter = 4,
): Promise<string> {
  const chunks = await storage.getChunksForDocument(documentId);
  if (chunks.length === 0) {
    return "[SURROUNDING CONTEXT unavailable]\nNo chunked text is available for this document.";
  }

  const ordered = [...chunks].sort((a, b) => a.startPosition - b.startPosition);
  let annotationChunkIndex = ordered.findIndex(
    (chunk) =>
      (chunk.startPosition <= annotationStartPosition &&
        chunk.endPosition >= annotationStartPosition) ||
      (chunk.startPosition <= annotationEndPosition &&
        chunk.endPosition >= annotationEndPosition) ||
      (chunk.startPosition >= annotationStartPosition &&
        chunk.endPosition <= annotationEndPosition),
  );

  if (annotationChunkIndex === -1) {
    annotationChunkIndex = findNearestChunkIndex(ordered, annotationStartPosition);
  }

  const startIdx = Math.max(0, annotationChunkIndex - chunksBefore);
  const endIdx = Math.min(ordered.length - 1, annotationChunkIndex + chunksAfter);
  const surrounding = ordered.slice(startIdx, endIdx + 1);
  const rangeStart = surrounding[0].startPosition;
  const rangeEnd = surrounding[surrounding.length - 1].endPosition;

  const merged = surrounding
    .map((chunk) => `[CHUNK ${chunk.startPosition}-${chunk.endPosition}]\n${chunk.text}`)
    .join("\n\n");

  return `[SURROUNDING CONTEXT for chars ${rangeStart}-${rangeEnd}]\n${merged}`;
}

export function formatDeepDiveFindings(filename: string, findings: ResearchFinding[]): string {
  const lines: string[] = [`[DEEP DIVE FINDINGS - Source: "${filename}"]`, ""];

  if (findings.length === 0) {
    lines.push("No relevant passages were returned from full-text review.");
    return lines.join("\n");
  }

  findings.forEach((finding, index) => {
    const quoteText = clipText(finding.quote, 1800) || finding.quote;
    lines.push(
      `[FINDING ${index + 1}] Position: chars ${finding.startPosition}-${finding.endPosition} | Verified: ${finding.verified ? "yes" : "no"}`,
    );
    lines.push(`"${quoteText}"`);
    lines.push(`Relevance: ${finding.relevance}`);
    if (finding.verificationNote) {
      lines.push(`Verification: ${finding.verificationNote}`);
    }
    lines.push("");
  });

  return lines.join("\n");
}
