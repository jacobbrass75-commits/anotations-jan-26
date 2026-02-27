import Anthropic from "@anthropic-ai/sdk";
import type { CitationData } from "@shared/schema";

// --- Interfaces ---

export interface WritingRequest {
  topic: string;
  annotationIds: string[];
  projectId?: string;
  citationStyle: "mla" | "apa" | "chicago";
  tone: "academic" | "casual" | "ap_style";
  targetLength: "short" | "medium" | "long";
  noEnDashes: boolean;
  deepWrite: boolean;
}

export interface WritingPlanSection {
  title: string;
  description: string;
  annotationIds: string[];
  targetWords: number;
}

export interface WritingPlan {
  thesis: string;
  sections: WritingPlanSection[];
  bibliography: string[];
}

export interface AnnotationSource {
  id: string;
  highlightedText: string;
  note: string | null;
  category: string;
  citationData: CitationData | null;
  documentFilename: string;
}

export interface WritingSSEEvent {
  type: "status" | "plan" | "section" | "complete" | "error";
  phase?: string;
  message?: string;
  plan?: WritingPlan;
  index?: number;
  title?: string;
  content?: string;
  fullText?: string;
  usage?: { inputTokens: number; outputTokens: number };
  error?: string;
}

// --- Constants ---

const TARGET_WORDS: Record<string, number> = {
  short: 1500,
  medium: 2500,
  long: 4000,
};

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEEP_WRITE_MODEL = "claude-sonnet-4-5-20241022";

// --- Helpers ---

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to your .env file."
    );
  }
  return new Anthropic({ apiKey });
}

function formatAnnotationForPrompt(ann: AnnotationSource): string {
  const parts: string[] = [];
  parts.push(`[Source ID: ${ann.id}]`);
  if (ann.citationData) {
    const cd = ann.citationData;
    const authorStr =
      cd.authors && cd.authors.length > 0
        ? cd.authors.map((a) => `${a.firstName} ${a.lastName}`).join(", ")
        : "Unknown Author";
    parts.push(`Author(s): ${authorStr}`);
    parts.push(`Title: ${cd.title}${cd.subtitle ? ": " + cd.subtitle : ""}`);
    if (cd.publicationDate) parts.push(`Date: ${cd.publicationDate}`);
    if (cd.publisher) parts.push(`Publisher: ${cd.publisher}`);
    if (cd.containerTitle) parts.push(`In: ${cd.containerTitle}`);
    if (cd.pageStart) {
      parts.push(
        `Pages: ${cd.pageStart}${cd.pageEnd ? "-" + cd.pageEnd : ""}`
      );
    }
    if (cd.url) parts.push(`URL: ${cd.url}`);
  } else {
    parts.push(`Source: ${ann.documentFilename}`);
  }
  parts.push(`Category: ${ann.category}`);
  if (ann.note) parts.push(`Note: ${ann.note}`);
  parts.push(`Quoted text: "${ann.highlightedText}"`);
  return parts.join("\n");
}

// --- Phase 1: PLANNER ---

async function runPlanner(
  client: Anthropic,
  request: WritingRequest,
  annotations: AnnotationSource[],
  model: string
): Promise<WritingPlan> {
  const totalWords = TARGET_WORDS[request.targetLength] || 2500;

  const annotationBlock = annotations
    .map((ann, i) => `--- Annotation ${i + 1} ---\n${formatAnnotationForPrompt(ann)}`)
    .join("\n\n");

  const systemPrompt = `You are an academic writing planner. Given a topic, tone, and a set of source annotations,
create a detailed outline for a paper.

Output ONLY a JSON object (no markdown fences, no extra text) with:
- thesis: The main argument/thesis statement
- sections: Array of sections, each with:
  - title: Section heading
  - description: What this section should cover
  - annotationIds: Array of source annotation IDs to use in this section
  - targetWords: Target word count for this section
- bibliography: Array of formatted ${request.citationStyle.toUpperCase()} bibliography entries based on available citation data

The total word count across sections should be approximately ${totalWords} words.

Target lengths:
- short: ~1500 words (3 pages)
- medium: ~2500 words (5 pages)
- long: ~4000 words (8 pages)

Always include an Introduction and Conclusion section. Distribute annotations logically across sections.`;

  const userPrompt = `Topic: ${request.topic}
Tone: ${request.tone}
Target length: ${request.targetLength} (~${totalWords} words)
Citation style: ${request.citationStyle}

Source annotations (${annotations.length} total):
${annotationBlock || "(No annotations provided - write based on topic alone)"}`;

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Parse JSON from response (strip markdown fences if present)
  const jsonStr = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
  try {
    const plan: WritingPlan = JSON.parse(jsonStr);
    // Validate structure
    if (!plan.thesis || !Array.isArray(plan.sections)) {
      throw new Error("Invalid plan structure");
    }
    return plan;
  } catch (e) {
    throw new Error(
      `Failed to parse writing plan from AI response: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

// --- Phase 2: WRITER (per section) ---

async function writeSection(
  client: Anthropic,
  plan: WritingPlan,
  sectionIndex: number,
  request: WritingRequest,
  annotations: AnnotationSource[],
  model: string
): Promise<string> {
  const section = plan.sections[sectionIndex];

  // Get relevant annotations for this section
  const relevantAnnotations = section.annotationIds.length > 0
    ? annotations.filter((a) => section.annotationIds.includes(a.id))
    : annotations; // fallback: give all annotations if none mapped

  const annotationBlock = relevantAnnotations
    .map((ann) => formatAnnotationForPrompt(ann))
    .join("\n\n---\n\n");

  const planSummary = plan.sections
    .map(
      (s, i) =>
        `${i + 1}. ${s.title} (~${s.targetWords} words): ${s.description}`
    )
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

Source material (annotations from the student's research):
${annotationBlock || "(No specific sources for this section)"}

Requirements:
- Write ONLY this section, not the whole paper
- Include in-text citations in ${request.citationStyle.toUpperCase()} format where appropriate
- Use the provided source annotations as evidence
- Match the specified tone${noEnDashesLine}

Output the section text in markdown format. Start with the section heading as ## ${section.title}`;

  const messageParams: Anthropic.MessageCreateParams = {
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

  // Deep Write: add extended thinking on Sonnet
  if (request.deepWrite) {
    messageParams.thinking = { type: "enabled", budget_tokens: 4096 };
    // Extended thinking requires higher max_tokens
    messageParams.max_tokens = Math.max(8192, section.targetWords * 3);
  }

  const response = await client.messages.create(messageParams);

  // Extract text content (skip thinking blocks)
  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );
  return textBlocks.map((b) => b.text).join("\n\n");
}

// --- Phase 3: STITCHER ---

async function stitch(
  client: Anthropic,
  plan: WritingPlan,
  sectionTexts: string[],
  request: WritingRequest,
  model: string
): Promise<string> {
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

The thesis of the paper is: ${plan.thesis}

Output the complete paper in markdown format.`;

  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Here are the sections to stitch together:\n\n${combinedSections}\n\nBibliography entries from the plan:\n${plan.bibliography.join("\n")}`,
      },
    ],
  });

  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );
  return textBlocks.map((b) => b.text).join("\n\n");
}

// --- Main pipeline (streaming via callback) ---

export async function runWritingPipeline(
  request: WritingRequest,
  annotations: AnnotationSource[],
  onEvent: (event: WritingSSEEvent) => void
): Promise<void> {
  const client = getClient();
  const model = request.deepWrite ? DEEP_WRITE_MODEL : DEFAULT_MODEL;

  let totalInput = 0;
  let totalOutput = 0;

  try {
    // Phase 1: Planning
    onEvent({
      type: "status",
      phase: "planning",
      message: "Creating outline...",
    });

    const plan = await runPlanner(client, request, annotations, model);

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

      const sectionContent = await writeSection(
        client,
        plan,
        i,
        request,
        annotations,
        model
      );
      sectionTexts.push(sectionContent);

      onEvent({
        type: "section",
        index: i,
        title: section.title,
        content: sectionContent,
      });
    }

    // Phase 3: Stitching
    onEvent({
      type: "status",
      phase: "stitching",
      message: "Polishing and adding transitions...",
    });

    const fullText = await stitch(client, plan, sectionTexts, request, model);

    onEvent({
      type: "complete",
      fullText,
      usage: { inputTokens: totalInput, outputTokens: totalOutput },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    onEvent({ type: "error", error: message });
  }
}
