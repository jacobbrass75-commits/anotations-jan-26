/**
 * Pipeline V2 - Improved AI Annotation System
 *
 * Key improvements over V1:
 * 1. Reference/metadata filtering before chunking
 * 2. Larger chunk sizes (1000 chars) for better context
 * 3. Enhanced prompts that explicitly filter noise
 * 4. Better model (gpt-4o-mini for balance of quality/speed)
 * 5. Keeps Generator → Verifier → Refiner architecture
 */

import OpenAI from "openai";
import type {
  CandidateAnnotation,
  VerifiedCandidate,
  VerifierVerdict,
  RefinedAnnotation,
  PipelineAnnotation,
  DocumentContext,
  AnnotationCategory,
} from "@shared/schema";
import {
  generatorResponseSchema,
  verifierResponseSchema,
  refinerResponseSchema,
  documentContextSchema,
} from "@shared/schema";
import { PIPELINE_CONFIG, cosineSimilarity, getEmbedding } from "./openai";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "missing" });
  }
  return _openai;
}

// V2 Configuration - improved settings
export const PIPELINE_V2_CONFIG = {
  MODEL: "gpt-4o-mini", // Better model for quality
  CHUNK_SIZE: 1000, // Larger chunks for better context
  CHUNK_OVERLAP: 100, // More overlap
  CANDIDATES_PER_CHUNK: 3,
  VERIFIER_THRESHOLD: 0.7,
  LLM_CONCURRENCY: 5,
  MIN_HIGHLIGHT_LENGTH: 15, // Slightly longer minimum
  MAX_HIGHLIGHT_LENGTH: 600, // Allow slightly longer highlights
  GENERATOR_MAX_TOKENS: 1000,
  VERIFIER_MAX_TOKENS: 800,
  REFINER_MAX_TOKENS: 600,
};

// Document context cache for V2
const documentContextCacheV2 = new Map<string, DocumentContext>();

const INTENT_STOPWORDS = new Set([
  "about",
  "above",
  "after",
  "again",
  "against",
  "also",
  "and",
  "any",
  "are",
  "around",
  "because",
  "been",
  "before",
  "being",
  "between",
  "both",
  "can",
  "could",
  "document",
  "does",
  "each",
  "find",
  "focus",
  "from",
  "have",
  "into",
  "just",
  "like",
  "main",
  "more",
  "most",
  "much",
  "must",
  "only",
  "other",
  "over",
  "research",
  "should",
  "that",
  "their",
  "them",
  "then",
  "there",
  "these",
  "this",
  "those",
  "through",
  "under",
  "using",
  "very",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
]);

function extractIntentKeywords(intent: string): string[] {
  const tokens = intent
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !INTENT_STOPWORDS.has(token));
  return Array.from(new Set(tokens));
}

function splitChunkIntoSentences(chunk: string): Array<{ text: string; start: number; end: number }> {
  const candidates: Array<{ text: string; start: number; end: number }> = [];
  const sentencePattern = /[^.!?\n]+[.!?]?/g;
  let match: RegExpExecArray | null;
  while ((match = sentencePattern.exec(chunk)) !== null) {
    const raw = match[0];
    const trimmed = raw.trim();
    if (trimmed.length < 25) continue;
    const startOffset = raw.indexOf(trimmed);
    const start = match.index + (startOffset >= 0 ? startOffset : 0);
    const end = start + trimmed.length;
    candidates.push({ text: trimmed, start, end });
  }
  return candidates;
}

function looksLikeNoise(text: string): boolean {
  const normalized = text.toLowerCase();
  if (normalized.length < 20) return true;
  if (/^\s*\[\d+\]/.test(normalized)) return true;
  if (/doi:\s*[\d.\/]/.test(normalized)) return true;
  if (/^\s*\d+\s+of\s+\d+\s*$/i.test(normalized)) return true;
  if (/^paragraph\s+\d+:/i.test(normalized)) return false;
  if (/^\s*(figure|table)\s+\d+/i.test(normalized)) return true;
  if (/^\s*\d+\./.test(normalized) && normalized.includes(",")) return true;
  return false;
}

function inferHeuristicCategory(sentence: string): AnnotationCategory {
  const lower = sentence.toLowerCase();
  if (/\b(method|methodology|procedure|approach|sample|protocol|review loop|limitation)\b/.test(lower)) {
    return "methodology";
  }
  if (/\b(result|results|evidence|data|show|shows|found|findings|reduce|increase)\b/.test(lower)) {
    return "evidence";
  }
  if (/\b(argue|argument|claim|conclude|conclusion|suggest|therefore)\b/.test(lower)) {
    return "argument";
  }
  return "key_quote";
}

function buildHeuristicNote(sentence: string, keywords: string[]): string {
  const lower = sentence.toLowerCase();
  const matched = keywords.filter((keyword) => lower.includes(keyword)).slice(0, 3);
  if (matched.length > 0) {
    return `Relevant to ${matched.join(", ")} and directly supports the research focus.`;
  }
  return "Contains a substantive claim that supports the active research focus.";
}

function buildHeuristicCandidates(chunk: string, intent: string): CandidateAnnotation[] {
  const keywords = extractIntentKeywords(intent);
  const sentenceCandidates = splitChunkIntoSentences(chunk)
    .filter((candidate) => !looksLikeNoise(candidate.text))
    .map((candidate) => {
      const lower = candidate.text.toLowerCase();
      const keywordMatches = keywords.reduce(
        (count, keyword) => (lower.includes(keyword) ? count + 1 : count),
        0
      );
      const bonus =
        /\b(result|evidence|method|claim|conclusion|limitations?)\b/.test(lower) ? 1 : 0;
      return {
        ...candidate,
        score: keywordMatches * 2 + bonus,
      };
    })
    .sort((a, b) => b.score - a.score || b.text.length - a.text.length);

  const picked = sentenceCandidates.slice(0, PIPELINE_V2_CONFIG.CANDIDATES_PER_CHUNK);
  const fallbackPool =
    picked.length > 0
      ? picked
      : splitChunkIntoSentences(chunk)
          .slice(0, 1)
          .map((candidate) => ({ ...candidate, score: 0 }));

  return fallbackPool.map((candidate) => {
    const confidenceBase = 0.62 + Math.min(3, Math.max(0, candidate.score || 0)) * 0.08;
    return {
      highlightStart: candidate.start,
      highlightEnd: candidate.end,
      highlightText: chunk.slice(candidate.start, candidate.end),
      category: inferHeuristicCategory(candidate.text),
      note: buildHeuristicNote(candidate.text, keywords),
      confidence: Math.min(0.88, confidenceBase),
    };
  });
}

function logStageFailure(
  stage: "context" | "generator" | "verifier" | "refiner",
  details: { chunkStart: number; chunkLength: number; documentId: string },
  error: unknown
) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[V2] ${stage} stage failed`, {
    ...details,
    error: message,
  });
}

/**
 * Filter out references section and metadata from text
 * This is a key improvement to reduce noise highlights
 */
export function filterTextNoise(text: string): { cleanText: string; removedSections: string[] } {
  const removedSections: string[] = [];
  let cleanText = text;

  // Common reference section headers (case-insensitive)
  const referencePatterns = [
    /\n\s*references?\s*\n/i,
    /\n\s*bibliography\s*\n/i,
    /\n\s*works?\s+cited\s*\n/i,
    /\n\s*literature\s+cited\s*\n/i,
    /\n\s*sources?\s*\n/i,
  ];

  // Find and remove references section
  for (const pattern of referencePatterns) {
    const match = cleanText.match(pattern);
    if (match && match.index !== undefined) {
      const refStart = match.index;
      // Only remove if it's in the latter half of the document (likely references)
      if (refStart > cleanText.length * 0.5) {
        removedSections.push(`References section (starting at position ${refStart})`);
        cleanText = cleanText.substring(0, refStart);
        break;
      }
    }
  }

  // Remove common metadata patterns at the start
  const metadataPatterns = [
    // DOI patterns
    /^.*?doi:\s*[\d.\/\w-]+\n/i,
    // Citation/copyright notices
    /^.*?©\s*\d{4}.*?\n/i,
    // Page numbers alone
    /^\s*\d+\s*\n/,
    // Journal headers with volume/issue
    /^.*?vol\.\s*\d+.*?no\.\s*\d+.*?\n/i,
  ];

  for (const pattern of metadataPatterns) {
    const match = cleanText.match(pattern);
    if (match) {
      cleanText = cleanText.replace(pattern, '');
      removedSections.push('Metadata header');
    }
  }

  // Remove footnote clusters (numbered references in sequence)
  // Pattern: multiple lines starting with numbers like "1. Author..." "2. Author..."
  const footnotePattern = /(\n\s*\d+\.\s+[A-Z][^.]+\.\s+[^.]+\.\s*\d{4}[.\s]*)+$/i;
  const footnoteMatch = cleanText.match(footnotePattern);
  if (footnoteMatch && footnoteMatch[0].length > 200) {
    removedSections.push('Footnote cluster');
    cleanText = cleanText.replace(footnotePattern, '');
  }

  return { cleanText: cleanText.trim(), removedSections };
}

/**
 * V2 Chunking with larger chunks and noise filtering
 */
export interface TextChunkDataV2 {
  text: string;
  startPosition: number;
  endPosition: number;
  originalStartPosition: number; // Position in original text
}

export function chunkTextV2(
  text: string,
  chunkSize: number = PIPELINE_V2_CONFIG.CHUNK_SIZE,
  overlap: number = PIPELINE_V2_CONFIG.CHUNK_OVERLAP
): TextChunkDataV2[] {
  // First, filter noise
  const { cleanText } = filterTextNoise(text);

  const chunks: TextChunkDataV2[] = [];
  let start = 0;

  while (start < cleanText.length) {
    let end = start + chunkSize;

    // Try to end at a sentence/paragraph boundary
    if (end < cleanText.length) {
      const slice = cleanText.slice(start, Math.min(end + 150, cleanText.length));
      const boundaryPos = findBestBoundary(slice, chunkSize);
      if (boundaryPos > 0) {
        end = start + boundaryPos;
      }
    }

    const chunkText = cleanText.slice(start, end);

    if (chunkText.trim() && chunkText.trim().length > 50) {
      // Find original position in the full text
      const originalStart = text.indexOf(chunkText.substring(0, 100));

      chunks.push({
        text: chunkText,
        startPosition: start,
        endPosition: end,
        originalStartPosition: originalStart >= 0 ? originalStart : start,
      });
    }

    start = end - overlap;
    if (start >= cleanText.length - overlap) break;
  }

  return chunks;
}

function findBestBoundary(text: string, targetLength: number): number {
  // Prefer paragraph breaks, then sentence endings
  const boundaries = [
    { pattern: /\n\s*\n/, priority: 1 }, // Paragraph break
    { pattern: /\.\s+[A-Z]/, priority: 2 }, // Sentence ending followed by capital
    { pattern: /[.!?]\s+/, priority: 3 }, // Any sentence ending
    { pattern: /[,;:]\s+/, priority: 4 }, // Clause boundary
  ];

  let bestPos = -1;
  let bestPriority = Infinity;

  for (const { pattern, priority } of boundaries) {
    const regex = new RegExp(pattern.source, 'g');
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match.index >= targetLength - 100 && match.index <= targetLength + 100) {
        if (priority < bestPriority ||
            (priority === bestPriority && Math.abs(match.index - targetLength) < Math.abs(bestPos - targetLength))) {
          bestPos = match.index + match[0].length;
          bestPriority = priority;
        }
      }
    }
  }

  return bestPos;
}

// === PHASE 1: ENHANCED GENERATOR ===

export async function generateCandidatesV2(
  chunk: string,
  intent: string,
  documentContext?: DocumentContext
): Promise<CandidateAnnotation[]> {
  const contextStr = documentContext
    ? `Document summary: ${documentContext.summary}\nKey concepts: ${documentContext.keyConcepts.join(", ")}\n\n`
    : "";

  // Enhanced prompt with explicit noise filtering instructions
  const prompt = `You identify research-relevant passages from academic documents. Output valid JSON only.

${contextStr}Research intent: ${intent}

Text chunk (${chunk.length} chars):
"""
${chunk}
"""

IMPORTANT FILTERING RULES - DO NOT highlight:
- Reference citations (e.g., "Smith, 2020", "[1]", numbered bibliography entries)
- Author names, affiliations, email addresses
- Page numbers, volume/issue numbers
- Copyright notices, journal headers
- Figure/table captions unless they contain key findings
- Generic methodological boilerplate
- Acknowledgments sections

ONLY highlight passages that:
- Directly address the research intent
- Contain substantive claims, findings, or arguments
- Provide evidence or methodology details relevant to the intent
- Would be genuinely useful for a researcher with this focus

Find up to ${PIPELINE_V2_CONFIG.CANDIDATES_PER_CHUNK} distinct passages worth highlighting. For each:
- highlightStart: integer offset where highlight begins (0-indexed from chunk start)
- highlightEnd: integer offset where highlight ends (exclusive)
- highlightText: exact substring, must equal chunk text from highlightStart to highlightEnd
- category: one of "key_quote", "argument", "evidence", "methodology"
- note: 1-2 sentences explaining specific relevance to research intent (not generic)
- confidence: 0.0 to 1.0 (be conservative - only 0.8+ for truly relevant content)

Return JSON: {"candidates": [...]}
If nothing genuinely relevant, return: {"candidates": []}`;

  try {
    const response = await getOpenAI().chat.completions.create({
      model: PIPELINE_V2_CONFIG.MODEL,
      messages: [
        {
          role: "system",
          content: "You are a precise research assistant that identifies only substantive, relevant passages. You filter out noise like references, metadata, and boilerplate. Output valid JSON only."
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: PIPELINE_V2_CONFIG.GENERATOR_MAX_TOKENS,
      temperature: 0.5, // Slightly lower for more consistent selection
    });

    const content = response.choices[0].message.content;
    if (!content) return buildHeuristicCandidates(chunk, intent);

    const parsed = JSON.parse(content);
    const validated = generatorResponseSchema.safeParse(parsed);

    if (!validated.success) {
      console.error("[V2] Generator response validation failed:", validated.error);
      return buildHeuristicCandidates(chunk, intent);
    }

    if (validated.data.candidates.length === 0) {
      return buildHeuristicCandidates(chunk, intent);
    }

    return validated.data.candidates;
  } catch (error) {
    console.error("[V2] Generator error:", error);
    return buildHeuristicCandidates(chunk, intent);
  }
}

// === PHASE 2: ENHANCED VERIFIER ===

export function hardVerifyCandidateV2(
  candidate: CandidateAnnotation,
  chunk: string
): { valid: boolean; errors: string[]; correctedCandidate?: CandidateAnnotation } {
  const errors: string[] = [];

  // Basic validation
  if (!candidate.highlightText || candidate.highlightText.length === 0) {
    errors.push("Empty highlight text");
    return { valid: false, errors };
  }

  // Length constraints
  if (candidate.highlightText.length < PIPELINE_V2_CONFIG.MIN_HIGHLIGHT_LENGTH) {
    errors.push(`Highlight too short (min ${PIPELINE_V2_CONFIG.MIN_HIGHLIGHT_LENGTH} chars)`);
    return { valid: false, errors };
  }
  if (candidate.highlightText.length > PIPELINE_V2_CONFIG.MAX_HIGHLIGHT_LENGTH) {
    errors.push(`Highlight too long (max ${PIPELINE_V2_CONFIG.MAX_HIGHLIGHT_LENGTH} chars)`);
    return { valid: false, errors };
  }

  // Noise pattern detection (additional V2 filter)
  const noisePatterns = [
    /^\s*\d+\.\s+[A-Z][^,]+,\s+[A-Z]/, // Reference pattern: "1. Author, A."
    /^\s*\[\d+\]/, // Numbered citation
    /©\s*\d{4}/, // Copyright
    /doi:\s*[\d.\/]/i, // DOI
    /vol\.\s*\d+/i, // Volume number
    /pp?\.\s*\d+-\d+/, // Page range
    /^\s*figure\s+\d+/i, // Figure caption start
    /^\s*table\s+\d+/i, // Table caption start
  ];

  for (const pattern of noisePatterns) {
    if (pattern.test(candidate.highlightText)) {
      errors.push("Highlight appears to be reference/metadata noise");
      return { valid: false, errors };
    }
  }

  // Grounding check
  const foundPos = chunk.indexOf(candidate.highlightText);
  if (foundPos === -1) {
    errors.push("Grounding failed: highlightText not found in chunk");
    return { valid: false, errors };
  }

  // Verify or correct offsets
  const expectedText = chunk.slice(candidate.highlightStart, candidate.highlightEnd);
  if (expectedText === candidate.highlightText) {
    return { valid: true, errors: [], correctedCandidate: candidate };
  }

  // Realign offsets
  const correctedCandidate: CandidateAnnotation = {
    ...candidate,
    highlightStart: foundPos,
    highlightEnd: foundPos + candidate.highlightText.length,
  };

  return { valid: true, errors: [], correctedCandidate };
}

export async function softVerifyCandidatesV2(
  candidates: CandidateAnnotation[],
  chunk: string,
  intent: string
): Promise<VerifierVerdict[]> {
  if (candidates.length === 0) return [];

  const candidatesJson = candidates.map((c, i) => ({
    index: i,
    highlightText: c.highlightText,
    category: c.category,
    note: c.note,
    confidence: c.confidence,
  }));

  // Enhanced verifier prompt
  const prompt = `Evaluate annotation quality with strict standards. Output valid JSON only.

Research intent: ${intent}

Original chunk:
"""
${chunk}
"""

Candidates to evaluate:
${JSON.stringify(candidatesJson, null, 2)}

STRICT EVALUATION CRITERIA:

1. RELEVANCE (most important):
   - Does this DIRECTLY help the research intent? Not just tangentially related?
   - Would a researcher with this intent actually want to cite/reference this?
   - Reject anything that's generic or only loosely connected

2. CONTENT QUALITY:
   - Is this substantive content (not references, metadata, boilerplate)?
   - Does it contain an actual claim, finding, or methodological detail?
   - Reject figure/table captions unless they state key results

3. CATEGORY ACCURACY:
   - key_quote: A direct, important statement by the author
   - argument: A claim or position being advanced
   - evidence: Data, results, or supporting information
   - methodology: Description of methods, procedures, approaches

4. NOTE QUALITY:
   - Is the explanation specific to this passage and intent?
   - Does it explain WHY this matters, not just WHAT it says?

Return JSON:
{
  "verdicts": [
    {
      "candidateIndex": 0,
      "approved": true/false,
      "qualityScore": 0.0 to 1.0,
      "adjustedCategory": "only if category was wrong",
      "adjustedNote": "only if note needs improvement",
      "issues": ["list any problems"]
    }
  ]
}`;

  try {
    const response = await getOpenAI().chat.completions.create({
      model: PIPELINE_V2_CONFIG.MODEL,
      messages: [
        {
          role: "system",
          content: "You are a strict research quality reviewer. Reject anything that isn't genuinely useful for the research intent. Output valid JSON only."
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: PIPELINE_V2_CONFIG.VERIFIER_MAX_TOKENS,
      temperature: 0.1,
    });

    const content = response.choices[0].message.content;
    if (!content) {
      return candidates.map((candidate, index) => ({
        candidateIndex: index,
        approved: true,
        qualityScore: Math.max(0.72, Math.min(0.9, candidate.confidence || 0.75)),
        issues: [],
      }));
    }

    const parsed = JSON.parse(content);
    const validated = verifierResponseSchema.safeParse(parsed);

    if (!validated.success) {
      console.error("[V2] Verifier response validation failed:", validated.error);
      return candidates.map((candidate, index) => ({
        candidateIndex: index,
        approved: true,
        qualityScore: Math.max(0.72, Math.min(0.9, candidate.confidence || 0.75)),
        issues: ["Verifier schema validation failed; accepted heuristic fallback"],
      }));
    }

    return validated.data.verdicts;
  } catch (error) {
    console.error("[V2] Verifier error:", error);
    return candidates.map((candidate, index) => ({
      candidateIndex: index,
      approved: true,
      qualityScore: Math.max(0.72, Math.min(0.9, candidate.confidence || 0.75)),
      issues: ["Verifier model error; accepted heuristic fallback"],
    }));
  }
}

// Duplicate detection (same as V1)
function calculateOverlap(start1: number, end1: number, start2: number, end2: number): number {
  const overlapStart = Math.max(start1, start2);
  const overlapEnd = Math.min(end1, end2);
  const overlap = Math.max(0, overlapEnd - overlapStart);
  const minSpan = Math.min(end1 - start1, end2 - start2);
  return minSpan > 0 ? overlap / minSpan : 0;
}

function isDuplicateAnnotationV2(
  candidateAbsStart: number,
  candidateAbsEnd: number,
  candidateConfidence: number,
  existingAnnotations: Array<{ startPosition: number; endPosition: number; confidenceScore?: number | null }>
): boolean {
  for (const existing of existingAnnotations) {
    const overlap = calculateOverlap(
      candidateAbsStart, candidateAbsEnd,
      existing.startPosition, existing.endPosition
    );
    if (overlap >= 0.5) {
      const existingConfidence = existing.confidenceScore ?? 0.5;
      if (existingConfidence >= candidateConfidence) return true;
    }
  }
  return false;
}

export async function verifyCandidatesV2(
  candidates: CandidateAnnotation[],
  chunk: string,
  chunkStart: number,
  intent: string,
  existingAnnotations: Array<{ startPosition: number; endPosition: number; confidenceScore?: number | null }>
): Promise<VerifiedCandidate[]> {
  const verified: VerifiedCandidate[] = [];

  // Hard verification with V2 noise filters
  const hardVerified: { candidate: CandidateAnnotation; index: number }[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const result = hardVerifyCandidateV2(candidates[i], chunk);
    if (result.valid && result.correctedCandidate) {
      const corrected = result.correctedCandidate;
      const absStart = chunkStart + corrected.highlightStart;
      const absEnd = chunkStart + corrected.highlightEnd;
      if (!isDuplicateAnnotationV2(absStart, absEnd, corrected.confidence, existingAnnotations)) {
        hardVerified.push({ candidate: corrected, index: i });
      }
    }
  }

  if (hardVerified.length === 0) return [];

  // Soft verification
  const softVerdicts = await softVerifyCandidatesV2(
    hardVerified.map(h => h.candidate),
    chunk,
    intent
  );

  // Merge results
  for (let i = 0; i < hardVerified.length; i++) {
    const { candidate } = hardVerified[i];
    const verdict = softVerdicts.find(v => v.candidateIndex === i);

    if (verdict && verdict.approved && verdict.qualityScore >= PIPELINE_V2_CONFIG.VERIFIER_THRESHOLD) {
      verified.push({
        ...candidate,
        qualityScore: verdict.qualityScore,
        category: verdict.adjustedCategory || candidate.category,
        note: verdict.adjustedNote || candidate.note,
        adjustedCategory: verdict.adjustedCategory,
        adjustedNote: verdict.adjustedNote,
      });
    }
  }

  return verified;
}

// === PHASE 3: REFINER (Same structure as V1 but with enhanced prompt) ===

export async function refineAnnotationsV2(
  verified: VerifiedCandidate[],
  intent: string,
  documentContext?: DocumentContext
): Promise<RefinedAnnotation[]> {
  if (verified.length === 0) return [];

  // Pass through for small sets
  if (verified.length <= 2) {
    return verified.map(v => ({
      highlightStart: v.highlightStart,
      highlightEnd: v.highlightEnd,
      highlightText: v.highlightText,
      category: v.adjustedCategory || v.category,
      note: v.adjustedNote || v.note,
      confidence: v.qualityScore,
    }));
  }

  const contextStr = documentContext
    ? `Document context: ${documentContext.summary}\n\n`
    : "";

  const prompt = `Polish these annotations for final output. Ensure high quality. Output valid JSON only.

${contextStr}Research intent: ${intent}

Verified annotations:
${JSON.stringify(verified.map((v, i) => ({
  index: i,
  highlightText: v.highlightText,
  category: v.adjustedCategory || v.category,
  note: v.adjustedNote || v.note,
  confidence: v.qualityScore,
  highlightStart: v.highlightStart,
  highlightEnd: v.highlightEnd,
})), null, 2)}

For each annotation:
1. Ensure note is concise but specific (1-2 sentences max)
2. Note should explain WHY this matters for the intent, not just summarize
3. Verify category accuracy
4. Keep all position data unchanged

Return JSON:
{
  "refined": [
    {
      "highlightStart": number,
      "highlightEnd": number,
      "highlightText": "exact text",
      "category": "key_quote" | "argument" | "evidence" | "methodology",
      "note": "polished note",
      "confidence": 0.0 to 1.0
    }
  ]
}`;

  try {
    const response = await getOpenAI().chat.completions.create({
      model: PIPELINE_V2_CONFIG.MODEL,
      messages: [
        { role: "system", content: "You polish research annotations for clarity and usefulness. Output valid JSON only." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: PIPELINE_V2_CONFIG.REFINER_MAX_TOKENS,
      temperature: 0.3,
    });

    const content = response.choices[0].message.content;
    if (!content) {
      return verified.map(v => ({
        highlightStart: v.highlightStart,
        highlightEnd: v.highlightEnd,
        highlightText: v.highlightText,
        category: v.adjustedCategory || v.category,
        note: v.adjustedNote || v.note,
        confidence: v.qualityScore,
      }));
    }

    const parsed = JSON.parse(content);
    const validated = refinerResponseSchema.safeParse(parsed);

    if (!validated.success) {
      console.error("[V2] Refiner validation failed:", validated.error);
      return verified.map(v => ({
        highlightStart: v.highlightStart,
        highlightEnd: v.highlightEnd,
        highlightText: v.highlightText,
        category: v.adjustedCategory || v.category,
        note: v.adjustedNote || v.note,
        confidence: v.qualityScore,
      }));
    }

    return validated.data.refined;
  } catch (error) {
    console.error("[V2] Refiner error:", error);
    return verified.map(v => ({
      highlightStart: v.highlightStart,
      highlightEnd: v.highlightEnd,
      highlightText: v.highlightText,
      category: v.adjustedCategory || v.category,
      note: v.adjustedNote || v.note,
      confidence: v.qualityScore,
    }));
  }
}

// === DOCUMENT CONTEXT V2 ===

export async function getDocumentContextV2(
  documentId: string,
  fullText: string
): Promise<DocumentContext | undefined> {
  if (documentContextCacheV2.has(documentId)) {
    return documentContextCacheV2.get(documentId);
  }

  try {
    const { cleanText } = filterTextNoise(fullText);
    const truncatedText = cleanText.slice(0, 5000); // Slightly more context

    const response = await getOpenAI().chat.completions.create({
      model: PIPELINE_V2_CONFIG.MODEL,
      messages: [
        { role: "system", content: "You summarize academic documents for research context. Output valid JSON only." },
        { role: "user", content: `Summarize this document briefly, focusing on the main thesis and key findings.

Text:
${truncatedText}

Return JSON:
{
  "summary": "2-3 sentence summary focusing on main argument/findings",
  "keyConcepts": ["concept1", "concept2", ...]
}` },
      ],
      response_format: { type: "json_object" },
      max_tokens: 600,
      temperature: 0.3,
    });

    const content = response.choices[0].message.content;
    if (!content) return undefined;

    const parsed = JSON.parse(content);
    const validated = documentContextSchema.safeParse(parsed);

    if (validated.success) {
      documentContextCacheV2.set(documentId, validated.data);
      return validated.data;
    }
  } catch (error) {
    console.error("[V2] Document context generation failed:", error);
  }

  return undefined;
}

export function clearDocumentContextCacheV2(documentId?: string): void {
  if (documentId) {
    documentContextCacheV2.delete(documentId);
  } else {
    documentContextCacheV2.clear();
  }
}

// === MAIN PIPELINE V2 ===

export async function analyzeChunkWithPipelineV2(
  chunk: string,
  chunkStart: number,
  intent: string,
  documentId: string,
  fullText: string,
  existingAnnotations: Array<{ startPosition: number; endPosition: number; confidenceScore?: number | null }>
): Promise<PipelineAnnotation[]> {
  let context: DocumentContext | undefined;
  try {
    context = await getDocumentContextV2(documentId, fullText);
  } catch (error) {
    logStageFailure("context", { chunkStart, chunkLength: chunk.length, documentId }, error);
  }

  let candidates: CandidateAnnotation[];
  try {
    candidates = await generateCandidatesV2(chunk, intent, context);
  } catch (error) {
    logStageFailure("generator", { chunkStart, chunkLength: chunk.length, documentId }, error);
    return [];
  }
  if (candidates.length === 0) {
    return [];
  }

  let verified: VerifiedCandidate[];
  try {
    verified = await verifyCandidatesV2(candidates, chunk, chunkStart, intent, existingAnnotations);
  } catch (error) {
    logStageFailure("verifier", { chunkStart, chunkLength: chunk.length, documentId }, error);
    return [];
  }
  if (verified.length === 0) {
    return [];
  }

  let refined: RefinedAnnotation[];
  try {
    refined = await refineAnnotationsV2(verified, intent, context);
  } catch (error) {
    logStageFailure("refiner", { chunkStart, chunkLength: chunk.length, documentId }, error);
    return [];
  }

  // Convert to absolute positions
  return refined.map((r) => ({
    absoluteStart: chunkStart + r.highlightStart,
    absoluteEnd: chunkStart + r.highlightEnd,
    highlightText: r.highlightText,
    category: r.category,
    note: r.note,
    confidence: r.confidence,
  }));
}

export async function processChunksWithPipelineV2(
  chunks: Array<{ text: string; startPosition: number; id: string }>,
  intent: string,
  documentId: string,
  fullText: string,
  existingAnnotations: Array<{ startPosition: number; endPosition: number; confidenceScore?: number | null }>
): Promise<PipelineAnnotation[]> {
  const allAnnotations: PipelineAnnotation[] = [];
  const runningAnnotations = [...existingAnnotations];

  const batchSize = PIPELINE_V2_CONFIG.LLM_CONCURRENCY;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);

    const batchResults = await Promise.allSettled(
      batch.map((chunk) =>
        analyzeChunkWithPipelineV2(
          chunk.text,
          chunk.startPosition,
          intent,
          documentId,
          fullText,
          runningAnnotations
        )
      )
    );

    for (let batchIndex = 0; batchIndex < batchResults.length; batchIndex++) {
      const batchResult = batchResults[batchIndex];
      if (batchResult.status === "rejected") {
        const chunk = batch[batchIndex];
        const message = batchResult.reason instanceof Error
          ? batchResult.reason.message
          : String(batchResult.reason);
        console.error("[V2] Chunk analysis failed", {
          chunkId: chunk.id,
          chunkStart: chunk.startPosition,
          chunkLength: chunk.text.length,
          error: message,
        });
        continue;
      }

      for (const ann of batchResult.value) {
        if (!isDuplicateAnnotationV2(
          ann.absoluteStart,
          ann.absoluteEnd,
          ann.confidence,
          runningAnnotations
        )) {
          allAnnotations.push(ann);
          runningAnnotations.push({
            startPosition: ann.absoluteStart,
            endPosition: ann.absoluteEnd,
            confidenceScore: ann.confidence,
          });
        }
      }
    }
  }

  return allAnnotations;
}

/**
 * Process chunks with multiple prompts in parallel
 * Each prompt runs the full 3-phase pipeline independently
 * Returns a Map of promptIndex -> PipelineAnnotation[]
 */
export async function processChunksWithMultiplePrompts(
  chunks: Array<{ text: string; startPosition: number; id: string }>,
  prompts: Array<{ text: string; color: string; index: number }>,
  documentId: string,
  fullText: string,
  existingAnnotations: Array<{ startPosition: number; endPosition: number; confidenceScore?: number | null }>
): Promise<Map<number, PipelineAnnotation[]>> {
  // Run all prompts in parallel
  const results = await Promise.all(
    prompts.map(async (prompt) => {
      // Each prompt runs the full pipeline independently
      // Note: We pass a copy of existingAnnotations so prompts don't interfere with each other's deduplication
      const annotations = await processChunksWithPipelineV2(
        chunks,
        prompt.text,
        documentId,
        fullText,
        [...existingAnnotations]
      );
      return { promptIndex: prompt.index, annotations };
    })
  );

  // Return map of promptIndex -> annotations
  const resultMap = new Map<number, PipelineAnnotation[]>();
  for (const { promptIndex, annotations } of results) {
    resultMap.set(promptIndex, annotations);
  }
  return resultMap;
}
