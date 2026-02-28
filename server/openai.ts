import OpenAI from "openai";
import type { 
  AnnotationCategory, 
  SearchResult, 
  AnalysisResult, 
  TextChunk,
  CandidateAnnotation,
  VerifiedCandidate,
  VerifierVerdict,
  RefinedAnnotation,
  PipelineAnnotation,
  DocumentContext,
  CitationData,
} from "@shared/schema";
import {
  generatorResponseSchema,
  verifierResponseSchema,
  refinerResponseSchema,
  documentContextSchema,
} from "@shared/schema";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "missing" });
  }
  return _openai;
}

const EMBEDDING_MODEL = "text-embedding-3-small";
const ANALYSIS_MODEL = "gpt-4o-mini";

// Pipeline configuration
export const PIPELINE_CONFIG = {
  MODEL: "gpt-4o-mini",
  CANDIDATES_PER_CHUNK: parseInt(process.env.CANDIDATES_PER_CHUNK || "3", 10),
  VERIFIER_THRESHOLD: parseFloat(process.env.VERIFIER_THRESHOLD || "0.7"),
  LLM_CONCURRENCY: parseInt(process.env.LLM_CONCURRENCY || "5", 10),

  CHUNKS_QUICK: 10,
  CHUNKS_STANDARD: 30,
  CHUNKS_THOROUGH: 100,
  CHUNKS_EXHAUSTIVE: 999,

  GENERATOR_MAX_TOKENS: 800,
  VERIFIER_MAX_TOKENS: 600,
  REFINER_MAX_TOKENS: 400,
  SUMMARIZER_MAX_TOKENS: 500,

  MIN_HIGHLIGHT_LENGTH: 10,
  MAX_HIGHLIGHT_LENGTH: 500,
  OVERLAP_THRESHOLD: 0.5,
  MAX_CHUNKS_TO_ANNOTATE: 30,
};

export type ThoroughnessLevel = 'quick' | 'standard' | 'thorough' | 'exhaustive';

export function getMaxChunksForLevel(level: ThoroughnessLevel): number {
  switch (level) {
    case 'quick': return PIPELINE_CONFIG.CHUNKS_QUICK;
    case 'standard': return PIPELINE_CONFIG.CHUNKS_STANDARD;
    case 'thorough': return PIPELINE_CONFIG.CHUNKS_THOROUGH;
    case 'exhaustive': return PIPELINE_CONFIG.CHUNKS_EXHAUSTIVE;
    default: return PIPELINE_CONFIG.CHUNKS_STANDARD;
  }
}

export async function getEmbedding(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return response.data[0].embedding;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function analyzeChunkForIntent(
  chunk: string,
  chunkStart: number,
  intent: string
): Promise<AnalysisResult> {
  try {
    const response = await getOpenAI().chat.completions.create({
      model: ANALYSIS_MODEL,
      messages: [
        {
          role: "system",
          content: "You are a research assistant that identifies relevant passages in academic texts. Respond with valid JSON only.",
        },
        {
          role: "user",
          content: `Given this text chunk and the user's research intent, determine if this chunk contains content worth highlighting.

User's research intent: ${intent}

Text chunk:
${chunk}

If this chunk is relevant, respond with JSON:
{
  "isRelevant": true,
  "highlightText": "exact substring from the chunk to highlight (copy verbatim, must be a substring that exists in the chunk)",
  "category": "key_quote" | "argument" | "evidence" | "methodology",
  "note": "brief explanation of why this matters for the user's research (1-2 sentences)",
  "confidence": 0.0 to 1.0
}

If not relevant, respond with:
{"isRelevant": false}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content;
    if (!content) {
      return { isRelevant: false };
    }

    return JSON.parse(content) as AnalysisResult;
  } catch (error) {
    console.error("Error analyzing chunk:", error);
    return { isRelevant: false };
  }
}

export async function generateDocumentSummary(
  fullText: string
): Promise<{
  summary: string;
  mainArguments: string[];
  keyConcepts: string[];
}> {
  try {
    const truncatedText = fullText.slice(0, 8000); // Limit for context window

    const response = await getOpenAI().chat.completions.create({
      model: ANALYSIS_MODEL,
      messages: [
        {
          role: "system",
          content: "You are a research assistant that summarizes academic documents. Respond with valid JSON only.",
        },
        {
          role: "user",
          content: `Analyze this academic text and provide:
1. A concise summary (2-3 sentences)
2. List of main arguments or claims (3-5 items)
3. Key concepts and terms (5-8 items)

Text:
${truncatedText}

Respond with JSON:
{
  "summary": "concise summary here",
  "mainArguments": ["argument 1", "argument 2", ...],
  "keyConcepts": ["concept 1", "concept 2", ...]
}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content;
    if (!content) {
      return {
        summary: "Could not generate summary.",
        mainArguments: [],
        keyConcepts: [],
      };
    }

    return JSON.parse(content);
  } catch (error) {
    console.error("Error generating summary:", error);
    return {
      summary: "Could not generate summary.",
      mainArguments: [],
      keyConcepts: [],
    };
  }
}

export async function searchDocument(
  query: string,
  intent: string,
  relevantChunks: { text: string; startPosition: number; endPosition: number }[]
): Promise<SearchResult[]> {
  try {
    const chunksText = relevantChunks
      .map((c, i) => `[Chunk ${i + 1}, Position ${c.startPosition}-${c.endPosition}]\n${c.text}`)
      .join("\n\n---\n\n");

    const response = await getOpenAI().chat.completions.create({
      model: ANALYSIS_MODEL,
      messages: [
        {
          role: "system",
          content: "You are a research assistant helping find exact quotes from academic documents. Respond with valid JSON only.",
        },
        {
          role: "user",
          content: `The user is researching: ${intent}
They are asking: ${query}

Here are relevant passages from their document:
${chunksText}

Find and return exact quotes that answer their query. For each quote:
1. Provide the exact text (copy verbatim from the chunks above)
2. Include the start and end positions from the chunk metadata
3. Explain how it relates to their question (1 sentence)
4. Rate relevance as "high", "medium", or "low"

Respond with JSON array of results (max 5):
{
  "results": [
    {
      "quote": "exact text from chunk",
      "startPosition": number,
      "endPosition": number,
      "explanation": "why this is relevant",
      "relevance": "high" | "medium" | "low"
    }
  ]
}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content;
    if (!content) {
      return [];
    }

    const parsed = JSON.parse(content);
    return parsed.results || [];
  } catch (error) {
    console.error("Error searching document:", error);
    return [];
  }
}

export function findHighlightPosition(
  fullText: string,
  highlightText: string,
  chunkStart: number
): { start: number; end: number } | null {
  // Search within a window around the chunk
  const searchStart = Math.max(0, chunkStart - 100);
  const searchEnd = Math.min(fullText.length, chunkStart + 2000);
  const window = fullText.slice(searchStart, searchEnd);

  const pos = window.indexOf(highlightText);
  if (pos !== -1) {
    const absStart = searchStart + pos;
    const absEnd = absStart + highlightText.length;
    return { start: absStart, end: absEnd };
  }

  // Try a broader search
  const broadPos = fullText.indexOf(highlightText);
  if (broadPos !== -1) {
    return { start: broadPos, end: broadPos + highlightText.length };
  }

  return null;
}

// === THREE-PHASE ANNOTATION PIPELINE ===

// Document context cache for the current request
const documentContextCache = new Map<string, DocumentContext>();

// Calculate overlap ratio between two spans
export function calculateOverlap(
  start1: number,
  end1: number,
  start2: number,
  end2: number
): number {
  const overlapStart = Math.max(start1, start2);
  const overlapEnd = Math.min(end1, end2);
  const overlap = Math.max(0, overlapEnd - overlapStart);
  const minSpan = Math.min(end1 - start1, end2 - start2);
  return minSpan > 0 ? overlap / minSpan : 0;
}

// Check if an annotation would be a duplicate of existing ones
export function isDuplicateAnnotation(
  candidateAbsStart: number,
  candidateAbsEnd: number,
  candidateConfidence: number,
  existingAnnotations: Array<{ startPosition: number; endPosition: number; confidenceScore?: number | null }>
): boolean {
  for (const existing of existingAnnotations) {
    const overlap = calculateOverlap(
      candidateAbsStart,
      candidateAbsEnd,
      existing.startPosition,
      existing.endPosition
    );

    if (overlap >= PIPELINE_CONFIG.OVERLAP_THRESHOLD) {
      const existingConfidence = existing.confidenceScore ?? 0.5;
      const existingLength = existing.endPosition - existing.startPosition;
      const candidateLength = candidateAbsEnd - candidateAbsStart;

      if (existingConfidence > candidateConfidence) return true;
      if (existingConfidence === candidateConfidence && existingLength <= candidateLength) return true;
    }
  }
  return false;
}

// Hard verification - check if candidate text matches the chunk
// Returns corrected candidate with realigned offsets if text is found elsewhere
export function hardVerifyCandidate(
  candidate: CandidateAnnotation,
  chunk: string
): { valid: boolean; errors: string[]; correctedCandidate?: CandidateAnnotation } {
  const errors: string[] = [];

  // Check basic text validity
  if (!candidate.highlightText || candidate.highlightText.length === 0) {
    errors.push("Empty highlight text");
    return { valid: false, errors };
  }

  // Check length constraints on the text itself
  if (candidate.highlightText.length < PIPELINE_CONFIG.MIN_HIGHLIGHT_LENGTH) {
    errors.push(`Highlight too short (min ${PIPELINE_CONFIG.MIN_HIGHLIGHT_LENGTH} chars)`);
    return { valid: false, errors };
  }
  if (candidate.highlightText.length > PIPELINE_CONFIG.MAX_HIGHLIGHT_LENGTH) {
    errors.push(`Highlight too long (max ${PIPELINE_CONFIG.MAX_HIGHLIGHT_LENGTH} chars)`);
    return { valid: false, errors };
  }

  // Check if text exists in chunk - this is the primary grounding check
  const foundPos = chunk.indexOf(candidate.highlightText);
  if (foundPos === -1) {
    errors.push("Grounding failed: highlightText not found in chunk");
    return { valid: false, errors };
  }

  // Verify or correct offsets
  const expectedText = chunk.slice(candidate.highlightStart, candidate.highlightEnd);
  if (expectedText === candidate.highlightText) {
    // Offsets are correct
    return { valid: true, errors: [], correctedCandidate: candidate };
  }

  // Offsets don't match - realign to where the text was actually found
  const correctedCandidate: CandidateAnnotation = {
    ...candidate,
    highlightStart: foundPos,
    highlightEnd: foundPos + candidate.highlightText.length,
  };

  return { valid: true, errors: [], correctedCandidate };
}

// === PHASE 1: GENERATOR ===

export async function generateCandidates(
  chunk: string,
  intent: string,
  documentContext?: DocumentContext
): Promise<CandidateAnnotation[]> {
  const contextStr = documentContext
    ? `Document summary: ${documentContext.summary}\nKey concepts: ${documentContext.keyConcepts.join(", ")}\n\n`
    : "";

  const prompt = `You identify research-relevant passages. Output valid JSON only.

${contextStr}Research intent: ${intent}

Text chunk (${chunk.length} chars):
"""
${chunk}
"""

Find up to ${PIPELINE_CONFIG.CANDIDATES_PER_CHUNK} distinct passages worth highlighting. For each:
- highlightStart: integer offset where highlight begins (0-indexed from chunk start)
- highlightEnd: integer offset where highlight ends (exclusive)
- highlightText: exact substring, must equal chunk text from highlightStart to highlightEnd
- category: one of "key_quote", "argument", "evidence", "methodology"
- note: 1-2 sentences explaining relevance to research intent
- confidence: 0.0 to 1.0

Return JSON: {"candidates": [...]}
If nothing relevant, return: {"candidates": []}`;

  try {
    const response = await getOpenAI().chat.completions.create({
      model: PIPELINE_CONFIG.MODEL,
      messages: [
        { role: "system", content: "You are a precise research assistant. Output valid JSON only." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: PIPELINE_CONFIG.GENERATOR_MAX_TOKENS,
      temperature: 0.6,
    });

    const content = response.choices[0].message.content;
    if (!content) return [];

    const parsed = JSON.parse(content);
    const validated = generatorResponseSchema.safeParse(parsed);

    if (!validated.success) {
      console.error("Generator response validation failed:", validated.error);
      return [];
    }

    return validated.data.candidates;
  } catch (error) {
    console.error("Generator error:", error);
    return [];
  }
}

// === PHASE 2: VERIFIER ===

export async function softVerifyCandidates(
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

  const prompt = `Evaluate annotation quality. Be strict. Output valid JSON only.

Research intent: ${intent}

Original chunk:
"""
${chunk}
"""

Candidates to evaluate:
${JSON.stringify(candidatesJson, null, 2)}

For each candidate, assess:
1. RELEVANCE: Does this genuinely help the research intent? (not tangential)
2. CATEGORY: Is the category correct for this type of content?
3. NOTE: Is the explanation specific and accurate?

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
      model: PIPELINE_CONFIG.MODEL,
      messages: [
        { role: "system", content: "You are a strict research quality reviewer. Output valid JSON only." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: PIPELINE_CONFIG.VERIFIER_MAX_TOKENS,
      temperature: 0.1,
    });

    const content = response.choices[0].message.content;
    if (!content) return [];

    const parsed = JSON.parse(content);
    const validated = verifierResponseSchema.safeParse(parsed);

    if (!validated.success) {
      console.error("Verifier response validation failed:", validated.error);
      return [];
    }

    return validated.data.verdicts;
  } catch (error) {
    console.error("Verifier error:", error);
    return [];
  }
}

export async function verifyCandidates(
  candidates: CandidateAnnotation[],
  chunk: string,
  chunkStart: number,
  intent: string,
  existingAnnotations: Array<{ startPosition: number; endPosition: number; confidenceScore?: number | null }>
): Promise<VerifiedCandidate[]> {
  const verified: VerifiedCandidate[] = [];

  // First, apply hard verification (with offset correction)
  const hardVerified: { candidate: CandidateAnnotation; index: number }[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const result = hardVerifyCandidate(candidates[i], chunk);
    if (result.valid && result.correctedCandidate) {
      // Use the corrected candidate with realigned offsets
      const corrected = result.correctedCandidate;
      const absStart = chunkStart + corrected.highlightStart;
      const absEnd = chunkStart + corrected.highlightEnd;
      if (!isDuplicateAnnotation(absStart, absEnd, corrected.confidence, existingAnnotations)) {
        hardVerified.push({ candidate: corrected, index: i });
      }
    }
  }

  if (hardVerified.length === 0) return [];

  // Then, apply soft verification using LLM
  const softVerdicts = await softVerifyCandidates(
    hardVerified.map(h => h.candidate),
    chunk,
    intent
  );

  // Merge results
  for (const { candidate, index } of hardVerified) {
    const verdict = softVerdicts.find(v => v.candidateIndex === hardVerified.findIndex(h => h.index === index));
    
    if (verdict && verdict.approved && verdict.qualityScore >= PIPELINE_CONFIG.VERIFIER_THRESHOLD) {
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

// === PHASE 3: REFINER ===

export async function refineAnnotations(
  verified: VerifiedCandidate[],
  intent: string,
  documentContext?: DocumentContext
): Promise<RefinedAnnotation[]> {
  if (verified.length === 0) return [];

  // For small sets, skip refining and pass through
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

  const prompt = `Polish these annotations for final output. Output valid JSON only.

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
1. Keep the note concise but informative (1-2 sentences max)
2. Ensure category is accurate
3. Keep all position data unchanged

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
      model: PIPELINE_CONFIG.MODEL,
      messages: [
        { role: "system", content: "You polish research annotations. Output valid JSON only." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: PIPELINE_CONFIG.REFINER_MAX_TOKENS,
      temperature: 0.3,
    });

    const content = response.choices[0].message.content;
    if (!content) {
      // Fallback to verified annotations
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
      console.error("Refiner response validation failed:", validated.error);
      // Fallback
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
    console.error("Refiner error:", error);
    // Fallback
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

// === DOCUMENT CONTEXT ===

export async function getDocumentContext(
  documentId: string,
  fullText: string
): Promise<DocumentContext | undefined> {
  // Check cache
  if (documentContextCache.has(documentId)) {
    return documentContextCache.get(documentId);
  }

  try {
    const truncatedText = fullText.slice(0, 4000);

    const response = await getOpenAI().chat.completions.create({
      model: PIPELINE_CONFIG.MODEL,
      messages: [
        { role: "system", content: "You summarize documents for research context. Output valid JSON only." },
        { role: "user", content: `Summarize this document briefly.

Text:
${truncatedText}

Return JSON:
{
  "summary": "2-3 sentence summary",
  "keyConcepts": ["concept1", "concept2", ...]
}` },
      ],
      response_format: { type: "json_object" },
      max_tokens: PIPELINE_CONFIG.SUMMARIZER_MAX_TOKENS,
      temperature: 0.3,
    });

    const content = response.choices[0].message.content;
    if (!content) return undefined;

    const parsed = JSON.parse(content);
    const validated = documentContextSchema.safeParse(parsed);

    if (validated.success) {
      documentContextCache.set(documentId, validated.data);
      return validated.data;
    }
  } catch (error) {
    console.error("Document context generation failed:", error);
  }

  return undefined;
}

export function clearDocumentContextCache(documentId?: string): void {
  if (documentId) {
    documentContextCache.delete(documentId);
  } else {
    documentContextCache.clear();
  }
}

// === MAIN PIPELINE ===

export async function analyzeChunkWithPipeline(
  chunk: string,
  chunkStart: number,
  intent: string,
  documentId: string,
  fullText: string,
  existingAnnotations: Array<{ startPosition: number; endPosition: number; confidenceScore?: number | null }>
): Promise<PipelineAnnotation[]> {
  // Get document context (cached)
  const context = await getDocumentContext(documentId, fullText);

  // Phase 1: Generate candidates
  const candidates = await generateCandidates(chunk, intent, context);
  if (candidates.length === 0) return [];

  // Phase 2: Verify candidates
  const verified = await verifyCandidates(
    candidates,
    chunk,
    chunkStart,
    intent,
    existingAnnotations
  );
  if (verified.length === 0) return [];

  // Phase 3: Refine annotations
  const refined = await refineAnnotations(verified, intent, context);

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

export async function processChunksWithPipeline(
  chunks: Array<{ text: string; startPosition: number; id: string }>,
  intent: string,
  documentId: string,
  fullText: string,
  existingAnnotations: Array<{ startPosition: number; endPosition: number; confidenceScore?: number | null }>
): Promise<PipelineAnnotation[]> {
  const allAnnotations: PipelineAnnotation[] = [];
  const runningAnnotations = [...existingAnnotations];

  const batchSize = PIPELINE_CONFIG.LLM_CONCURRENCY;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map((chunk) =>
        analyzeChunkWithPipeline(
          chunk.text,
          chunk.startPosition,
          intent,
          documentId,
          fullText,
          runningAnnotations
        )
      )
    );

    // Flatten and add to running list for duplicate detection
    for (const annotations of batchResults) {
      for (const ann of annotations) {
        if (!isDuplicateAnnotation(
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
 * Extract citation metadata from document text using AI
 * Analyzes the beginning of the document to identify author, title, publication info
 */
export async function extractCitationMetadata(
  documentText: string,
  highlightedText?: string
): Promise<CitationData | null> {
  const textSample = documentText.substring(0, 3000);
  const contextHint = highlightedText 
    ? `The user wants to cite this specific quote: "${highlightedText.substring(0, 200)}..."\n\n`
    : "";

  try {
    const response = await getOpenAI().chat.completions.create({
      model: ANALYSIS_MODEL,
      messages: [
        {
          role: "system",
          content: `You are an expert academic librarian specializing in Chicago-style citations. 
Analyze the provided document text to extract bibliographic information.
Look for author names, titles, publication details, dates, DOIs, and journal/publisher information.
Academic PDFs often have author names and titles in the header or first paragraphs.
Respond with valid JSON only.`
        },
        {
          role: "user",
          content: `${contextHint}Extract citation metadata from this document text:

${textSample}

Respond with JSON in this exact format:
{
  "sourceType": "book" | "journal" | "website" | "newspaper" | "chapter" | "thesis" | "other",
  "authors": [{"firstName": "...", "lastName": "..."}],
  "title": "Title of the work",
  "subtitle": "optional subtitle",
  "containerTitle": "Journal name or book title if this is a chapter/article",
  "publisher": "Publisher name",
  "publicationPlace": "City of publication",
  "publicationDate": "YYYY or YYYY-MM-DD format",
  "volume": "for journals",
  "issue": "for journals",
  "pageStart": "starting page",
  "pageEnd": "ending page",
  "url": "URL if available",
  "doi": "DOI if available",
  "edition": "edition number if not first",
  "editors": [{"firstName": "...", "lastName": "..."}]
}

Only include fields you can confidently extract. Omit uncertain fields.
If you cannot identify any citation information, respond with: {"error": "Unable to extract citation metadata"}`
        }
      ],
      response_format: { type: "json_object" },
      max_tokens: 800,
    });

    const content = response.choices[0].message.content;
    if (!content) return null;

    const parsed = JSON.parse(content);
    if (parsed.error) {
      console.log("AI could not extract citation metadata:", parsed.error);
      return null;
    }

    const validSourceTypes = ['book', 'journal', 'website', 'newspaper', 'chapter', 'thesis', 'other'];
    if (!validSourceTypes.includes(parsed.sourceType)) {
      parsed.sourceType = 'other';
    }

    if (!parsed.authors || !Array.isArray(parsed.authors)) {
      parsed.authors = [];
    }

    if (!parsed.title) {
      parsed.title = "Unknown Title";
    }

    return parsed as CitationData;
  } catch (error) {
    console.error("Error extracting citation metadata:", error);
    return null;
  }
}
