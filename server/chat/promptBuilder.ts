import type { Conversation, Message, Project, WritingStyle } from "@shared/schema";
import { buildProjectAnnotationJumpPath, buildTextFingerprint } from "@shared/annotationLinks";
import { ANTHROPIC_MODELS } from "../aiModels";
import type { QuoteJumpTarget } from "../quoteJumpLinks";
import {
  buildVoiceProfileBlock,
  formatSourceForPrompt,
  formatSourceForPromptTiered,
  type TieredSource,
  type WritingSource,
} from "../writingPipeline";
import { buildStyleSection } from "../sourceRoles";

export const MAX_SOURCE_EXCERPT_CHARS = 2000;
export const MAX_SOURCE_FULLTEXT_CHARS = 30000;
export const MAX_SOURCE_TOTAL_FULLTEXT_CHARS = 150000;
export const CHAT_MAX_TOKENS = 8192;
export const COMPILE_MAX_TOKENS = 8192;
export const VERIFY_MAX_TOKENS = 8192;
export const MAX_CONTEXT_ESCALATIONS = 2;

export const MODELS = {
  precision: {
    chat: ANTHROPIC_MODELS.opus,
    compile: ANTHROPIC_MODELS.opus,
    verify: ANTHROPIC_MODELS.opus,
  },
  extended: {
    chat: ANTHROPIC_MODELS.sonnet,
    compile: ANTHROPIC_MODELS.sonnet,
    verify: ANTHROPIC_MODELS.sonnet,
  },
  research: ANTHROPIC_MODELS.sonnet,
} as const;

const FREE_MODELS: typeof MODELS = {
  precision: {
    chat: ANTHROPIC_MODELS.haiku,
    compile: ANTHROPIC_MODELS.haiku,
    verify: ANTHROPIC_MODELS.sonnet,
  },
  extended: {
    chat: ANTHROPIC_MODELS.sonnet,
    compile: ANTHROPIC_MODELS.sonnet,
    verify: ANTHROPIC_MODELS.sonnet,
  },
  research: ANTHROPIC_MODELS.sonnet,
};

const TOKEN_LIMITS = {
  precision: 200_000,
  extended: 200_000,
} as const;

const RESERVED_TOKENS = 10_000;
const OUTPUT_TOKENS = CHAT_MAX_TOKENS;

export const BASE_SYSTEM_PROMPT =
  "You are ScholarMark AI, a helpful academic writing assistant. You help students with research, writing, citations, and understanding academic sources. Be concise, accurate, and helpful.";

export type WritingProjectContext = Pick<
  Project,
  "name" | "thesis" | "scope" | "contextSummary" | "voiceProfile"
>;
export type WritingStyleContext = Pick<WritingStyle, "name" | "description" | "voiceProfile">;
export type PromptSource = WritingSource | TieredSource;
export type WritingMode = "precision" | "extended";
export type ContextWarningLevel = "ok" | "caution" | "critical";
export type AnthropicHistoryMessage = { role: "user" | "assistant"; content: string };

export interface ContextUsageEstimate {
  systemTokens: number;
  historyTokens: number;
  totalUsed: number;
  available: number;
  limit: number;
  warningLevel: ContextWarningLevel;
}

export function parseStyleAnalysisValue(raw: string | null | undefined) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Parameters<typeof buildStyleSection>[0][number]["styleAnalysis"];
  } catch {
    return null;
  }
}

function normalizedPromptValue(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "Not provided.";
}

export function prettyToneLabel(tone?: string): string {
  if (!tone) return "academic";
  if (tone === "ap_style") return "AP style";
  return tone;
}

export function getWritingMode(conv: Pick<Conversation, "writingModel">): WritingMode {
  return conv.writingModel === "extended" ? "extended" : "precision";
}

export function getModelsForConversation(
  conv: Pick<Conversation, "writingModel">,
  tier?: string | null,
) {
  const mode = getWritingMode(conv);
  return tier === "free" ? FREE_MODELS[mode] : MODELS[mode];
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateContextUsage(
  systemPrompt: string,
  messages: AnthropicHistoryMessage[],
  mode: WritingMode,
): ContextUsageEstimate {
  const systemTokens = estimateTokens(systemPrompt);
  const historyTokens = messages.reduce(
    (total, message) => total + estimateTokens(message.content),
    0,
  );
  const limit = TOKEN_LIMITS[mode];
  const totalUsed = systemTokens + historyTokens + OUTPUT_TOKENS + RESERVED_TOKENS;
  const available = limit - totalUsed;

  let warningLevel: ContextWarningLevel = "ok";
  if (available < 20_000) warningLevel = "caution";
  if (available < 5_000) warningLevel = "critical";

  return {
    systemTokens,
    historyTokens,
    totalUsed,
    available,
    limit,
    warningLevel,
  };
}

export function buildProjectContextBlock(project: WritingProjectContext | null): string {
  if (!project) {
    return "PROJECT CONTEXT:\nProject: Standalone writing mode\nThesis: Not provided.\nScope: Not provided.\nSummary: Not provided.";
  }

  return `PROJECT CONTEXT:
Project: ${normalizedPromptValue(project.name)}
Thesis: ${normalizedPromptValue(project.thesis)}
Scope: ${normalizedPromptValue(project.scope)}
Summary: ${normalizedPromptValue(project.contextSummary)}`;
}

export function isTieredSource(source: PromptSource): source is TieredSource {
  return "annotations" in source;
}

/**
 * Token budget for inline annotations across all sources in the system prompt.
 * Small projects fit entirely (previous behavior preserved); past the budget,
 * each source gets a top-K slice and the rest stays retrievable via the
 * gatherer tools and <chunk_request> escalation.
 */
export const ANNOTATION_PROMPT_TOKEN_BUDGET = Math.max(
  1000,
  parseInt(process.env.ANNOTATION_PROMPT_TOKEN_BUDGET || "8000", 10) || 8000,
);
const MIN_ANNOTATIONS_PER_SOURCE = 3;

type TieredAnnotation = TieredSource["annotations"][number];

function estimateAnnotationTokens(annotation: TieredAnnotation): number {
  const overheadChars = 120; // id/category/position/document lines
  return Math.ceil(
    (annotation.highlightedText.length + (annotation.note?.length || 0) + overheadChars) / 4,
  );
}

export interface SourceBlockPlan {
  /** Per-source annotation caps, keyed by source id. Null = no caps needed. */
  perSourceLimits: Map<string, number> | null;
  totalAnnotations: number;
  includedAnnotations: number;
  estimatedAnnotationTokens: number;
}

export function planSourceBlock(sources: PromptSource[]): SourceBlockPlan {
  const tiered = sources.filter(isTieredSource);
  const totalAnnotations = tiered.reduce((count, source) => count + source.annotations.length, 0);
  const estimatedAnnotationTokens = tiered.reduce(
    (count, source) =>
      count +
      source.annotations.reduce(
        (sourceTotal, annotation) => sourceTotal + estimateAnnotationTokens(annotation),
        0,
      ),
    0,
  );

  if (estimatedAnnotationTokens <= ANNOTATION_PROMPT_TOKEN_BUDGET) {
    return {
      perSourceLimits: null,
      totalAnnotations,
      includedAnnotations: totalAnnotations,
      estimatedAnnotationTokens,
    };
  }

  const annotatedSources = tiered.filter((source) => source.annotations.length > 0);
  const perSourceBudget = ANNOTATION_PROMPT_TOKEN_BUDGET / Math.max(annotatedSources.length, 1);
  const perSourceLimits = new Map<string, number>();
  let includedAnnotations = 0;

  for (const source of annotatedSources) {
    const sourceTokens = source.annotations.reduce(
      (sourceTotal, annotation) => sourceTotal + estimateAnnotationTokens(annotation),
      0,
    );
    const avgTokens = Math.max(sourceTokens / source.annotations.length, 1);
    const rawLimit = Math.floor(perSourceBudget / avgTokens);
    const limit = Math.min(
      source.annotations.length,
      Math.max(MIN_ANNOTATIONS_PER_SOURCE, rawLimit),
    );
    perSourceLimits.set(source.id, limit);
    includedAnnotations += limit;
  }

  return {
    perSourceLimits,
    totalAnnotations,
    includedAnnotations,
    estimatedAnnotationTokens,
  };
}

export function buildSourceBlock(
  sources: PromptSource[],
  plan: SourceBlockPlan = planSourceBlock(sources),
): string {
  if (sources.length === 0) {
    return "No explicit source materials are attached to this conversation.";
  }

  return sources
    .map((source, i) => {
      const sourceText = isTieredSource(source)
        ? formatSourceForPromptTiered(source, {
            maxAnnotations: plan.perSourceLimits?.get(source.id),
          })
        : formatSourceForPrompt(source);
      return `--- Source ${i + 1} ---\n${sourceText}`;
    })
    .join("\n\n");
}

export function buildSelectedWritingStyleBlock(writingStyle: WritingStyleContext | null): string {
  if (!writingStyle) return "";
  const profileBlock = buildVoiceProfileBlock(writingStyle.voiceProfile);
  if (!profileBlock) return "";
  const description = writingStyle.description?.trim()
    ? `\nUse case: ${writingStyle.description.trim()}`
    : "";

  return `

[SELECTED WRITING STYLE]
Name: ${writingStyle.name}${description}
This user explicitly selected this reusable writing style for the current draft.${profileBlock}`;
}

export function buildWritingSystemPrompt(
  sources: PromptSource[],
  project: WritingProjectContext | null,
  writingStyle: WritingStyleContext | null,
  citationStyle?: string,
  tone?: string,
  humanize?: boolean,
  noEnDashes?: boolean,
): string {
  const styleSection = buildStyleSection(
    sources
      .filter(
        (source): source is TieredSource =>
          isTieredSource(source) && source.sourceRole === "style_reference",
      )
      .map((source) => ({
        title: source.title,
        styleAnalysis: parseStyleAnalysisValue(source.styleAnalysis),
      })),
  );
  const voiceProfileBlock = writingStyle
    ? buildSelectedWritingStyleBlock(writingStyle)
    : buildVoiceProfileBlock(project?.voiceProfile);
  const styleLabel = (citationStyle || "chicago").toUpperCase();
  const noEnDashesRule = noEnDashes
    ? "\n9. NEVER use em-dashes or en-dashes. Use commas, periods, or semicolons instead."
    : "";
  const includeHumanStyle = humanize ?? true;
  const writingStyleBlock = includeHumanStyle
    ? `
WRITING STYLE:
- Vary sentence length. Mix short punchy sentences with longer analytical ones.
- Use active voice by default. Passive only when actor is unknown.
- Avoid cliche phrases: "It is important to note", "Furthermore", "In conclusion".
- Start paragraphs with substance, not meta-commentary.
- Write as a knowledgeable human expert, not as an AI summarizing.`
    : "";

  return `You are ScholarMark AI, an expert academic writing partner. You are collaborating with a student on a research paper.

${buildProjectContextBlock(project)}

You have access to ${sources.length} source document(s).

SOURCE MATERIALS:
${buildSourceBlock(sources)}${styleSection}${voiceProfileBlock}

CONVERSATION FLOW:
When a student brings a new writing task, follow this collaborative process:

PHASE 1 - DISCOVERY (first message on a new topic):
Ask the student about their thesis/argument, what angle they want to take, the scope (paragraph, section, full essay), and intended audience/tone. Keep it to 2-3 focused questions, not an interrogation.

PHASE 2 - SOURCE REVIEW:
Review the available source materials and tell the student which sources you found most relevant to their topic. Briefly explain why each source connects. Let them confirm or redirect.

PHASE 3 - OUTLINE:
Propose a structured outline showing how you'd organize the argument and where each source fits. Wait for the student to approve, modify, or redirect before writing.

PHASE 4 - DRAFTING:
Only after outline approval, write the content. Wrap substantial writing in <document> tags.

IMPORTANT EXCEPTIONS:
- If the student says "just write it", "go ahead", or explicitly asks you to skip planning - go straight to drafting.
- If the student asks to revise, expand, or edit existing text - do it immediately without re-doing discovery.
- If continuing an ongoing writing thread where thesis/sources are already established - skip to the relevant phase.
- Short requests like "add a transition sentence" or "fix this paragraph" should be done immediately.

WRITING RULES:
1. Write in ${prettyToneLabel(tone)} register with ${styleLabel} citations.
2. Ground claims in the provided sources. Cite page numbers when available.
3. Use exact source text for direct quotations.
4. Flag claims that go beyond source support.
5. Build on prior conversation and maintain the student's argument thread.
6. Use footnotes for citations: [^1], [^2], etc. with footnote definitions at the end.${noEnDashesRule}
7. Documents marked as style references are voice guides only. Never cite or quote them.

Do not fabricate quotations, publication details, page numbers, or bibliography metadata. If source detail is uncertain, state uncertainty clearly and cite conservatively.${writingStyleBlock}

CONTEXT TOOLS:
You are seeing annotated highlights and summaries from each source. This is your primary working material.

If you need surrounding context for a specific annotation, output exactly:
<chunk_request annotation_id="ANNOTATION_ID" document_id="DOCUMENT_ID">
Brief reason for requesting surrounding context
</chunk_request>

If you need a full-source deep dive, output exactly:
<context_request document_id="DOCUMENT_ID">
What you need from the full source and why
</context_request>

QUOTING RULES:
- Quotes from annotation blocks are pre-verified.
- If you quote from chunk retrieval or deep dive findings, mention that it came from full-text review.
- Include annotation ID or character position when citing evidence.
- Do not fabricate quotes.

OUTPUT FORMAT:
When producing substantial written content (a full paragraph or more of paper content), wrap it in document tags:

<document title="Section Title">
Your written content here in markdown...
</document>

Brief conversational responses (questions, acknowledgments, short clarifications) should NOT use document tags.`;
}

export function buildCompilePrompt({
  transcript,
  project,
  sources,
  writingStyle,
  style,
  tone,
  noEnDashes,
}: {
  transcript: string;
  project: WritingProjectContext | null;
  sources: PromptSource[];
  writingStyle: WritingStyleContext | null;
  style: string;
  tone: string;
  noEnDashes: boolean;
}): string {
  const projectContextBlock = buildProjectContextBlock(project);
  const writingStyleBlock =
    buildSelectedWritingStyleBlock(writingStyle) || buildVoiceProfileBlock(project?.voiceProfile);
  const sourcesBlock =
    sources.length > 0 ? `\n\nSOURCE MATERIALS:\n${buildSourceBlock(sources)}` : "";

  const noEnDashesRule = noEnDashes
    ? "\n11. NEVER use em-dashes or en-dashes. Use commas, periods, or semicolons instead."
    : "";

  return `You are assembling a final academic paper from a writing conversation.
The student and AI have been collaboratively drafting sections.

${projectContextBlock}
Target citation style: ${style.toUpperCase()}
Target tone: ${prettyToneLabel(tone)}${writingStyleBlock}

RULES:
1. Include every piece of substantive writing the assistant produced.
2. Preserve the student's thesis and argument structure.
3. Do NOT summarize or shorten sections. Include draft content in full unless superseded by a later revision.
4. If the same topic or section was revised multiple times, use the LATEST version.
5. Remove conversational chatter and keep only polished paper content.
6. Add only what is required to unify the paper: transitions, a unified introduction (if missing), and a conclusion that synthesizes the argument.
7. Use footnotes for citations ([^1], [^2], etc.) throughout the paper.
8. Include footnote definitions immediately before the bibliography.
9. Compile a bibliography from all cited sources using ${style.toUpperCase()} format.
10. Write naturally: vary sentence length, prefer active voice, and avoid filler phrases.
11. Do not fabricate source details not grounded in the provided sources.${noEnDashesRule}
12. Output clean markdown using ## section headings.

CONVERSATION TRANSCRIPT:
${transcript}${sourcesBlock}`;
}

export function buildVerifyPrompt({
  compiledContent,
  project,
  sources,
  style,
}: {
  compiledContent: string;
  project: WritingProjectContext | null;
  sources: PromptSource[];
  style: string;
}): string {
  const projectContextBlock = buildProjectContextBlock(project);
  const sourcesBlock =
    sources.length > 0
      ? `\n\nSOURCE MATERIALS FOR VERIFICATION:\n${buildSourceBlock(sources)}`
      : "\n\nSOURCE MATERIALS FOR VERIFICATION:\nNo attached source materials were provided.";

  return `You are an academic paper reviewer performing strict source and citation verification.

${projectContextBlock}
Citation style to enforce: ${style.toUpperCase()}

Verification requirements:
1. Cross-reference every direct quote against the provided source text.
2. Check whether paraphrases accurately reflect the source content.
3. Verify page numbers or section references where they are provided.
4. Flag any citation that does not correspond to the provided sources.
5. Check footnote numbering consistency and formatting correctness.
6. Check citation and bibliography formatting consistency in ${style.toUpperCase()}.
7. Identify unsupported or over-claimed assertions.
8. Review logical flow, argument coherence, tone consistency, and major grammar issues.

Output format:
- Executive summary (2-4 sentences)
- Findings (numbered, highest severity first)
- Each finding must include: location/passage, issue, and concrete fix
- Strengths (optional)

PAPER TO REVIEW:
${compiledContent}${sourcesBlock}`;
}

export function toAnthropicMessages(history: Message[]): AnthropicHistoryMessage[] {
  return history
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
    }));
}

export function buildQuoteJumpTargets(
  projectId: string | null,
  sources: PromptSource[],
): QuoteJumpTarget[] {
  if (!projectId) return [];

  return sources
    .filter((source): source is TieredSource => isTieredSource(source))
    .flatMap((source) =>
      source.annotations
        .filter((annotation) => annotation.highlightedText?.trim())
        .map((annotation) => ({
          quote: annotation.highlightedText,
          jumpPath: buildProjectAnnotationJumpPath({
            projectId,
            projectDocumentId: source.id,
            annotationId: annotation.id,
            startPosition: annotation.startPosition,
            anchorFingerprint: buildTextFingerprint(annotation.highlightedText),
          }),
        })),
    );
}
