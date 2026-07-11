import Anthropic from "@anthropic-ai/sdk";
import type { CitationData, ProjectAnnotation } from "@shared/schema";
import { formatSourceStubByRole, type SourceRole, type StyleAnalysis } from "./sourceRoles";
import { ANTHROPIC_MODELS } from "./aiModels";
import { sanitizeSseError } from "./sseUtils";

// --- Interfaces ---

export interface WritingRequest {
  topic: string;
  annotationIds: string[];
  sourceDocumentIds?: string[];
  projectId?: string;
  citationStyle: "mla" | "apa" | "chicago";
  tone: "academic" | "casual" | "ap_style";
  targetLength: "short" | "medium" | "long";
  noEnDashes: boolean;
  deepWrite: boolean;
  voiceProfile?: string | null;
  modelOverride?: string | null;
}

export interface WritingPlanSection {
  title: string;
  description: string;
  sourceIds: string[];
  targetWords: number;
}

export interface WritingPlan {
  thesis: string;
  sections: WritingPlanSection[];
  bibliography: string[];
}

export interface WritingSource {
  id: string;
  kind: "project_document" | "annotation" | "web_clip";
  title: string;
  author: string;
  excerpt: string;
  fullText: string;
  category: string;
  note: string | null;
  citationData: CitationData | null;
  documentFilename: string;
}

export interface TieredSource {
  id: string;
  kind: "project_document";
  title: string;
  author: string;
  category: string;
  citationData: CitationData | null;
  documentFilename: string;
  summary: string | null;
  mainArguments: string[] | null;
  keyConcepts: string[] | null;
  roleInProject: string | null;
  projectContext: string | null;
  sourceRole?: SourceRole | null;
  styleAnalysis?: string | null;
  chunkCount?: number | null;
  annotations: ProjectAnnotation[];
  excerpt: string;
  documentId: string;
}

export interface WritingSSEEvent {
  type: "status" | "plan" | "section" | "complete" | "error" | "saved";
  phase?: string;
  message?: string;
  plan?: WritingPlan;
  index?: number;
  title?: string;
  content?: string;
  fullText?: string;
  usage?: { inputTokens: number; outputTokens: number };
  error?: string;
  savedPaper?: {
    documentId: string;
    projectDocumentId: string;
    filename: string;
    savedAt: number;
  };
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

interface GeneratedText {
  text: string;
  usage: TokenUsage;
}

interface PlannedWriting {
  plan: WritingPlan;
  usage: TokenUsage;
}

// --- Constants ---

const TARGET_WORDS: Record<string, number> = {
  short: 1500,
  medium: 2500,
  long: 4000,
};

const DEFAULT_MODEL = ANTHROPIC_MODELS.sonnet;
const DEEP_WRITE_MODEL = ANTHROPIC_MODELS.sonnet;
const PLANNER_MAX_TOKENS = 4096;
const COMPACT_PLANNER_MAX_TOKENS = 3072;
const MAX_COMPACT_PLANNER_SOURCES = 80;

// --- Helpers ---

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to your .env file.");
  }
  return new Anthropic({ apiKey });
}

function getUsage(response: {
  usage?: { input_tokens?: number | null; output_tokens?: number | null };
}): TokenUsage {
  return {
    inputTokens: Math.max(0, response.usage?.input_tokens ?? 0),
    outputTokens: Math.max(0, response.usage?.output_tokens ?? 0),
  };
}

function addUsage(total: TokenUsage, usage: TokenUsage): void {
  total.inputTokens += usage.inputTokens;
  total.outputTokens += usage.outputTokens;
}

function usesAdaptiveThinking(model: string): boolean {
  return /\b(fable|mythos|sonnet-5|opus-4-8)\b/i.test(model);
}

function applyWritingModelOptions(
  params: Anthropic.MessageCreateParamsNonStreaming,
  model: string,
  deepWrite: boolean,
): Anthropic.MessageCreateParamsNonStreaming {
  if (usesAdaptiveThinking(model)) {
    params.output_config = {
      ...params.output_config,
      effort: deepWrite ? "high" : "medium",
    };
    return params;
  }

  if (deepWrite) {
    params.thinking = { type: "enabled", budget_tokens: 4096 };
    params.max_tokens = Math.max(params.max_tokens, 8192);
  }

  return params;
}

function clipPromptText(text: string | null | undefined, maxChars: number): string {
  if (!text) return "";
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars).trimEnd()}...`;
}

function extractJsonObjectText(text: string): string {
  const unfenced = text
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "")
    .trim();
  if (unfenced.startsWith("{")) return unfenced;

  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return unfenced.slice(start, end + 1).trim();
  }

  return unfenced;
}

function parseWritingPlanText(text: string, totalWords: number): WritingPlan {
  type RawPlanSection = {
    title?: unknown;
    description?: unknown;
    targetWords?: unknown;
    sourceIds?: unknown;
    annotationIds?: unknown;
  };

  const parsed = JSON.parse(extractJsonObjectText(text)) as {
    thesis?: unknown;
    bibliography?: unknown;
    sections?: unknown;
  };

  if (
    typeof parsed.thesis !== "string" ||
    !parsed.thesis.trim() ||
    !Array.isArray(parsed.sections)
  ) {
    throw new Error("Invalid plan structure");
  }

  const rawSections = parsed.sections as RawPlanSection[];
  if (rawSections.length === 0) {
    throw new Error("Invalid plan structure");
  }

  const sectionCount = Math.max(1, rawSections.length);
  const fallbackWords = Math.max(250, Math.round(totalWords / sectionCount));

  const sections: WritingPlanSection[] = rawSections.map((section, index) => {
    const sourceIds = Array.isArray(section.sourceIds)
      ? section.sourceIds
      : Array.isArray(section.annotationIds)
        ? section.annotationIds
        : [];
    const title =
      typeof section.title === "string" && section.title.trim()
        ? section.title.trim()
        : `Section ${index + 1}`;
    const description =
      typeof section.description === "string" && section.description.trim()
        ? section.description.trim()
        : `Develop ${title}.`;

    return {
      title,
      description,
      sourceIds: sourceIds.filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0,
      ),
      targetWords:
        typeof section.targetWords === "number" &&
        Number.isFinite(section.targetWords) &&
        section.targetWords > 0
          ? section.targetWords
          : fallbackWords,
    };
  });

  return {
    thesis: parsed.thesis.trim(),
    sections,
    bibliography: Array.isArray(parsed.bibliography)
      ? parsed.bibliography.filter(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
        )
      : [],
  };
}

export function formatSourceForPrompt(source: WritingSource): string {
  const parts: string[] = [];
  parts.push(`[SOURCE ${source.id}]`);
  parts.push(`Type: ${source.kind}`);
  parts.push(`Document: ${source.documentFilename}`);
  parts.push(`Title: ${source.title}`);
  parts.push(`Author(s): ${source.author}`);
  parts.push(`Category: ${source.category}`);
  if (source.note) parts.push(`Note: ${source.note}`);
  if (source.citationData) {
    const cd = source.citationData;
    const authorStr =
      cd.authors && cd.authors.length > 0
        ? cd.authors.map((a) => `${a.firstName} ${a.lastName}`).join(", ")
        : "Unknown Author";
    parts.push(`Citation Author(s): ${authorStr}`);
    parts.push(`Citation Title: ${cd.title}${cd.subtitle ? ": " + cd.subtitle : ""}`);
    if (cd.publicationDate) parts.push(`Date: ${cd.publicationDate}`);
    if (cd.publisher) parts.push(`Publisher: ${cd.publisher}`);
    if (cd.containerTitle) parts.push(`In: ${cd.containerTitle}`);
    if (cd.pageStart) {
      parts.push(`Pages: ${cd.pageStart}${cd.pageEnd ? "-" + cd.pageEnd : ""}`);
    }
    if (cd.url) parts.push(`URL: ${cd.url}`);
  }
  parts.push(`Excerpt: "${source.excerpt}"`);
  parts.push(`Content Snippet:\n${source.fullText}`);
  return parts.join("\n");
}

export interface TieredFormatOptions {
  /** Cap on annotations included inline. Omitted = include all (small-project behavior). */
  maxAnnotations?: number;
}

/**
 * Pick which annotations earn inline prompt space when a cap applies.
 * Manual annotations are user-curated, so they always outrank AI ones;
 * AI annotations compete on confidence. Selected annotations are returned
 * in document order so the prompt reads coherently.
 */
export function selectAnnotationsForPrompt(
  annotations: ProjectAnnotation[],
  maxAnnotations?: number,
): ProjectAnnotation[] {
  if (!maxAnnotations || annotations.length <= maxAnnotations) {
    return annotations;
  }

  const prioritized = [...annotations].sort((a, b) => {
    const aManual = a.isAiGenerated === false ? 0 : 1;
    const bManual = b.isAiGenerated === false ? 0 : 1;
    if (aManual !== bManual) return aManual - bManual;
    return (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0);
  });

  return prioritized.slice(0, maxAnnotations).sort((a, b) => a.startPosition - b.startPosition);
}

export function formatSourceForPromptTiered(
  source: TieredSource,
  options: TieredFormatOptions = {},
): string {
  const parts: string[] = [];
  parts.push(`[SOURCE ${source.id}]`);
  parts.push(
    formatSourceStubByRole({
      id: source.id,
      title: source.title,
      sourceRole: source.sourceRole || "evidence",
      styleAnalysis: parseStyleAnalysis(source.styleAnalysis),
      summary: source.summary,
      annotationCount: source.annotations.length,
      chunkCount: source.chunkCount,
    }),
  );
  parts.push(`Document: ${source.documentFilename}`);
  parts.push(`Title: ${source.title}`);
  parts.push(`Author(s): ${source.author}`);

  if (source.citationData) {
    const cd = source.citationData;
    const authorStr =
      cd.authors && cd.authors.length > 0
        ? cd.authors.map((a) => `${a.firstName} ${a.lastName}`).join(", ")
        : "Unknown Author";
    parts.push(`Citation Author(s): ${authorStr}`);
    parts.push(`Citation Title: ${cd.title}${cd.subtitle ? ": " + cd.subtitle : ""}`);
    if (cd.publicationDate) parts.push(`Date: ${cd.publicationDate}`);
    if (cd.publisher) parts.push(`Publisher: ${cd.publisher}`);
    if (cd.containerTitle) parts.push(`In: ${cd.containerTitle}`);
    if (cd.pageStart) {
      parts.push(`Pages: ${cd.pageStart}${cd.pageEnd ? "-" + cd.pageEnd : ""}`);
    }
    if (cd.url) parts.push(`URL: ${cd.url}`);
  }

  if (source.summary) parts.push(`Summary: ${source.summary}`);
  if (source.mainArguments?.length) {
    parts.push(`Main Arguments: ${source.mainArguments.join("; ")}`);
  }
  if (source.keyConcepts?.length) {
    parts.push(`Key Concepts: ${source.keyConcepts.join(", ")}`);
  }
  if (source.roleInProject) parts.push(`Role in Project: ${source.roleInProject}`);
  if (source.projectContext) parts.push(`Project Context: ${source.projectContext}`);

  if (source.annotations.length > 0) {
    const includedAnnotations = selectAnnotationsForPrompt(
      source.annotations,
      options.maxAnnotations,
    );
    const omittedCount = source.annotations.length - includedAnnotations.length;

    parts.push("");
    parts.push(
      omittedCount > 0
        ? `ANNOTATED PASSAGES (showing ${includedAnnotations.length} of ${source.annotations.length} annotations):`
        : `ANNOTATED PASSAGES (${source.annotations.length} annotations):`,
    );
    parts.push("");

    for (const ann of includedAnnotations) {
      const confidence =
        typeof ann.confidenceScore === "number"
          ? ` | Confidence: ${ann.confidenceScore.toFixed(2)}`
          : "";
      const promptInfo = ann.promptText ? ` | Prompt: "${ann.promptText}"` : "";

      parts.push(`[ANNOTATION ${ann.id}] Category: ${ann.category}${confidence}${promptInfo}`);
      parts.push(`"${ann.highlightedText}"`);
      if (ann.note) parts.push(`Note: ${ann.note}`);
      parts.push(`Position: chars ${ann.startPosition}-${ann.endPosition}`);
      parts.push(`Document: ${source.documentId}`);
      parts.push("");
    }

    if (omittedCount > 0) {
      parts.push(
        `[${omittedCount} more annotations not shown - retrieve with get_source_chunks or <chunk_request> when needed]`,
      );
      parts.push("");
    }
  } else {
    parts.push(`Excerpt: "${source.excerpt}"`);
  }

  return parts.join("\n");
}

function parseStyleAnalysis(raw: string | null | undefined): StyleAnalysis | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StyleAnalysis>;
    return {
      avgSentenceLength: parsed.avgSentenceLength || "Mixed sentence lengths",
      vocabularyLevel:
        parsed.vocabularyLevel === "academic" ||
        parsed.vocabularyLevel === "conversational" ||
        parsed.vocabularyLevel === "mixed"
          ? parsed.vocabularyLevel
          : "mixed",
      paragraphStructure: parsed.paragraphStructure || "Balanced analytical paragraphs",
      toneMarkers: Array.isArray(parsed.toneMarkers)
        ? parsed.toneMarkers.filter((item): item is string => typeof item === "string")
        : [],
      commonTransitions: Array.isArray(parsed.commonTransitions)
        ? parsed.commonTransitions.filter((item): item is string => typeof item === "string")
        : [],
    };
  } catch {
    return null;
  }
}

export function buildVoiceProfileBlock(voiceProfileJson: string | null | undefined): string {
  if (!voiceProfileJson) return "";

  try {
    const vp = JSON.parse(voiceProfileJson) as Record<string, unknown>;
    if (!vp || typeof vp !== "object") return "";

    const distinctivePhrases = Array.isArray(vp.distinctivePhrases)
      ? (vp.distinctivePhrases as string[]).join(", ")
      : "";
    const avoidedPatterns = Array.isArray(vp.avoidedPatterns)
      ? (vp.avoidedPatterns as string[]).join(", ")
      : "";
    const toneMarkers = Array.isArray(vp.toneMarkers)
      ? (vp.toneMarkers as string[]).join(", ")
      : "";

    return `

[VOICE PROFILE — match this author's writing style]
${vp.voiceSummary || ""}

Sentence rhythm: ${vp.avgSentenceLength || ""}
Vocabulary: ${vp.vocabularyLevel || ""}
Paragraph style: ${vp.paragraphStructure || ""}
Evidence introduction: ${vp.evidenceIntroduction || ""}
Argument structure: ${vp.argumentStructure || ""}
Hedging style: ${vp.hedgingStyle || ""}
Opens with: ${vp.openingPattern || ""}
Closes with: ${vp.closingPattern || ""}
Distinctive phrases to use naturally: ${distinctivePhrases}
NEVER do these: ${avoidedPatterns}
Tone: ${toneMarkers}`;
  } catch {
    return "";
  }
}

// --- Phase 1: PLANNER ---

async function runPlanner(
  client: Anthropic,
  request: WritingRequest,
  sources: WritingSource[],
  model: string,
  voiceBlock: string,
): Promise<PlannedWriting> {
  const totalWords = TARGET_WORDS[request.targetLength] || 2500;
  const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  const sourceBlock = sources
    .map((source, i) => `--- Source ${i + 1} ---\n${formatSourceForPrompt(source)}`)
    .join("\n\n");

  const systemPrompt = `You are an academic writing planner. Given a topic, tone, and source materials,
create a detailed outline for a paper.

Output ONLY a JSON object (no markdown fences, no extra text) with:
- thesis: The main argument/thesis statement
- sections: Array of sections, each with:
  - title: Section heading
  - description: What this section should cover
  - sourceIds: Array of source IDs to use in this section
- targetWords: Target word count for this section
- bibliography: Array of concise ${request.citationStyle.toUpperCase()} bibliography entries based on available citation data

The total word count across sections should be approximately ${totalWords} words.

Target lengths:
- short: ~1500 words (3 pages)
- medium: ~2500 words (5 pages)
- long: ~4000 words (8 pages)

Always include an Introduction and Conclusion section. Distribute sources logically across sections.
Keep the JSON compact:
- Do not include quotes or source excerpts in the JSON
- Keep each description under 240 characters
- Keep bibliography entries under 220 characters each
- Include no more than 12 bibliography entries

Do not invent fake source metadata. If source metadata is missing, use conservative placeholders in bibliography entries.${voiceBlock}`;

  const userPrompt = `Topic: ${request.topic}
Tone: ${request.tone}
Target length: ${request.targetLength} (~${totalWords} words)
Citation style: ${request.citationStyle}

Source materials (${sources.length} total):
${sourceBlock || "(No sources provided - write based on topic alone)"}`;

  const response = await client.messages.create(
    applyWritingModelOptions(
      {
        model,
        max_tokens: PLANNER_MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      },
      model,
      usesAdaptiveThinking(model) && request.deepWrite,
    ),
  );
  addUsage(totalUsage, getUsage(response));

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  try {
    return {
      plan: parseWritingPlanText(text, totalWords),
      usage: totalUsage,
    };
  } catch (e) {
    const firstParseError = e instanceof Error ? e.message : String(e);
    const compactResponse = await runCompactPlanner(
      client,
      request,
      sources,
      model,
      voiceBlock,
      totalWords,
    );
    addUsage(totalUsage, compactResponse.usage);

    try {
      return {
        plan: parseWritingPlanText(compactResponse.text, totalWords),
        usage: totalUsage,
      };
    } catch (compactError) {
      throw new Error(
        `Failed to parse writing plan from AI response: ${compactError instanceof Error ? compactError.message : String(compactError)} (initial planner parse failed with: ${firstParseError})`,
        { cause: compactError },
      );
    }
  }
}

async function runCompactPlanner(
  client: Anthropic,
  request: WritingRequest,
  sources: WritingSource[],
  model: string,
  voiceBlock: string,
  totalWords: number,
): Promise<GeneratedText> {
  const sourceBrief = sources
    .slice(0, MAX_COMPACT_PLANNER_SOURCES)
    .map((source, i) => {
      const citationTitle = source.citationData?.title || source.title || source.documentFilename;
      return [
        `Source ${i + 1}`,
        `id: ${source.id}`,
        `title: ${clipPromptText(citationTitle, 120)}`,
        `author: ${clipPromptText(source.author, 90)}`,
        `summary: ${clipPromptText(source.excerpt || source.note || source.fullText, 280)}`,
      ].join(" | ");
    })
    .join("\n");

  const systemPrompt = `You are repairing an academic paper outline request.
Return ONLY one valid compact JSON object. No markdown fences.

Schema:
{
  "thesis": "one sentence",
  "sections": [
    {
      "title": "section heading",
      "description": "under 180 characters",
      "sourceIds": ["exact source ids from the source list"],
      "targetWords": 500
    }
  ],
  "bibliography": ["short citation or source label, under 160 characters"]
}

Rules:
- Total target words should be about ${totalWords}
- Use 4 to 7 sections, including Introduction and Conclusion
- Keep bibliography to 8 entries or fewer
- Do not include source excerpts, quotes, or long strings inside JSON
- Do not invent source IDs${voiceBlock}`;

  const userPrompt = `Topic: ${clipPromptText(request.topic, 1800)}
Tone: ${request.tone}
Target length: ${request.targetLength} (~${totalWords} words)
Citation style: ${request.citationStyle}

Source list:
${sourceBrief || "(No sources provided)"}`;

  const response = await client.messages.create(
    applyWritingModelOptions(
      {
        model,
        max_tokens: COMPACT_PLANNER_MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      },
      model,
      usesAdaptiveThinking(model) && request.deepWrite,
    ),
  );

  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  return {
    text: textBlocks.map((block) => block.text).join("\n\n"),
    usage: getUsage(response),
  };
}

// --- Phase 2: WRITER (per section) ---

async function writeSection(
  client: Anthropic,
  plan: WritingPlan,
  sectionIndex: number,
  request: WritingRequest,
  sources: WritingSource[],
  model: string,
  voiceBlock: string,
): Promise<GeneratedText> {
  const section = plan.sections[sectionIndex];

  // Get relevant sources for this section
  const relevantSources =
    section.sourceIds.length > 0
      ? sources.filter((source) => section.sourceIds.includes(source.id))
      : sources;

  const sourceBlock = relevantSources
    .map((source) => formatSourceForPrompt(source))
    .join("\n\n---\n\n");

  const planSummary = plan.sections
    .map((s, i) => `${i + 1}. ${s.title} (~${s.targetWords} words): ${s.description}`)
    .join("\n");

  const noEnDashesLine = request.noEnDashes
    ? "\n- NEVER use em-dashes or en-dashes. Use commas, periods, or semicolons instead."
    : "";

  const systemPrompt = `You are an academic writer. Write the following section of a paper.

Full outline (for context on the paper's arc):
Thesis: ${plan.thesis}
${planSummary}

Your assignment: Write section "${section.title}"
Description: ${section.description}
Target length: ${section.targetWords} words
Tone: ${request.tone}
Citation style: ${request.citationStyle}

Source material (from the student's selected project sources):
${sourceBlock || "(No specific sources for this section)"}

Requirements:
- Write ONLY this section, not the whole paper
- Include in-text citations in ${request.citationStyle.toUpperCase()} format where appropriate
- Use ONLY the provided sources as primary evidence
- Match the specified tone${noEnDashesLine}
- Do not fabricate quotations, page numbers, publication details, or bibliography entries
- If uncertain, cite conservatively and state uncertainty plainly${voiceBlock}

Output the section text in markdown format. Start with the section heading as ## ${section.title}`;

  const messageParams: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: Math.max(2048, section.targetWords * 2),
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Write the "${section.title}" section now.`,
      },
    ],
  };

  if (request.deepWrite) {
    messageParams.max_tokens = Math.max(messageParams.max_tokens, section.targetWords * 3);
  }

  const response = await client.messages.create(
    applyWritingModelOptions(messageParams, model, request.deepWrite),
  );

  // Extract text content (skip thinking blocks)
  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  return {
    text: textBlocks.map((b) => b.text).join("\n\n"),
    usage: getUsage(response),
  };
}

// --- Phase 3: STITCHER ---

async function stitch(
  client: Anthropic,
  plan: WritingPlan,
  sectionTexts: string[],
  request: WritingRequest,
  model: string,
  voiceBlock: string,
): Promise<GeneratedText> {
  const combinedSections = sectionTexts.join("\n\n---\n\n");

  const noEnDashesLine = request.noEnDashes
    ? "\n- NEVER use em-dashes or en-dashes. Use commas, periods, or semicolons instead."
    : "";

  const systemPrompt = `You are an academic editor. You have been given all sections of a paper written by different writers.
Your job is to:
1. Add smooth transitions between sections
2. Ensure consistent voice and tone throughout
3. Write a compelling introduction (if not already present)
4. Write a conclusion that ties the argument together
5. Append a complete bibliography/works cited section in ${request.citationStyle.toUpperCase()} format
6. Do NOT rewrite the sections - only add transitions, intro, conclusion, and bibliography${noEnDashesLine}
7. Do not fabricate source details that are not supported by the source material

The thesis of the paper is: ${plan.thesis}

Output the complete paper in markdown format.${voiceBlock}`;

  const response = await client.messages.create(
    applyWritingModelOptions(
      {
        model,
        max_tokens: 8192,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Here are the sections to stitch together:\n\n${combinedSections}\n\nBibliography entries from the plan:\n${plan.bibliography.join("\n")}`,
          },
        ],
      },
      model,
      usesAdaptiveThinking(model) && request.deepWrite,
    ),
  );

  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  return {
    text: textBlocks.map((b) => b.text).join("\n\n"),
    usage: getUsage(response),
  };
}

// --- Main pipeline (streaming via callback) ---

export async function runWritingPipeline(
  request: WritingRequest,
  sources: WritingSource[],
  onEvent: (event: WritingSSEEvent) => void,
): Promise<void> {
  const client = getClient();
  const model = request.modelOverride || (request.deepWrite ? DEEP_WRITE_MODEL : DEFAULT_MODEL);
  const voiceBlock = buildVoiceProfileBlock(request.voiceProfile);

  const totalUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
  };

  try {
    // Phase 1: Planning
    onEvent({
      type: "status",
      phase: "planning",
      message: usesAdaptiveThinking(model)
        ? "Creating outline with Claude Fable 5..."
        : "Creating outline...",
    });

    const plannedWriting = await runPlanner(client, request, sources, model, voiceBlock);
    const { plan } = plannedWriting;
    addUsage(totalUsage, plannedWriting.usage);

    onEvent({ type: "plan", plan });

    // Phase 2: Writing each section
    const sectionTexts: string[] = [];

    for (let i = 0; i < plan.sections.length; i++) {
      const section = plan.sections[i];
      onEvent({
        type: "status",
        phase: "writing",
        message: `Writing section ${i + 1} of ${plan.sections.length}: "${section.title}"...`,
      });

      const sectionResult = await writeSection(
        client,
        plan,
        i,
        request,
        sources,
        model,
        voiceBlock,
      );
      sectionTexts.push(sectionResult.text);
      addUsage(totalUsage, sectionResult.usage);

      onEvent({
        type: "section",
        index: i,
        title: section.title,
        content: sectionResult.text,
      });
    }

    // Phase 3: Stitching
    onEvent({
      type: "status",
      phase: "stitching",
      message: "Polishing and adding transitions...",
    });

    const stitchedResult = await stitch(client, plan, sectionTexts, request, model, voiceBlock);
    addUsage(totalUsage, stitchedResult.usage);

    onEvent({
      type: "complete",
      fullText: stitchedResult.text,
      usage: totalUsage,
    });
  } catch (error) {
    onEvent({ type: "error", error: sanitizeSseError(error, "Writing pipeline failed") });
  }
}
