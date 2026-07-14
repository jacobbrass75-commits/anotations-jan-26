import { ANTHROPIC_MODELS } from "./aiModels";

export interface CompactedMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface AnthropicLike {
  messages: {
    create: (...args: any[]) => Promise<{
      content: Array<{ type: string; text?: string }>;
    }>;
  };
}

const DEFAULT_COMPACTION_THRESHOLD = 6;
export const DEFAULT_PROMPT_MEMORY_TOKEN_BUDGET = Math.max(
  20_000,
  parseInt(process.env.PROMPT_MEMORY_TOKEN_BUDGET || "160000", 10) || 160_000,
);
export const MAX_COMPACTION_SUMMARY_CHARS = Math.max(
  2_000,
  parseInt(process.env.MAX_COMPACTION_SUMMARY_CHARS || "8000", 10) || 8_000,
);

export interface PromptMemoryDiagnostics {
  budgetTokens: number;
  estimatedSystemTokens: number;
  estimatedMessageTokens: number;
  estimatedTotalTokens: number;
  inputMessageCount: number;
  outputMessageCount: number;
  droppedMessageCount: number;
  droppedSyntheticMessageCount: number;
  keptSyntheticMessageCount: number;
  inputExchangeCount: number;
  outputExchangeCount: number;
  droppedExchangeCount: number;
  lexicalMatchesRetained: number;
  overBudget: boolean;
  readerMode?: "precision" | "extended";
}

export interface PromptMemoryPolicyInput {
  systemPrompt: string;
  messages: CompactedMessage[];
  /** Message indices that must survive selection, normally the current request. */
  requiredMessageIndices?: number[];
  tokenBudget?: number;
  currentRequest?: string;
  minimumRecentTurns?: number;
}

export interface CompactedHistoryOptions {
  currentRequest?: string;
  relevantEarlierTurnCount?: number;
}

export const TRUNCATED_DRAFT_MARKER =
  "[PARTIAL DRAFT - MODEL OUTPUT LIMIT; NOT CANONICAL]";

export function markTruncatedDraft(content: string): string {
  return `${TRUNCATED_DRAFT_MARKER}\n${content}`;
}

export function isTruncatedDraftMessage(content: string): boolean {
  return content.trimStart().startsWith(TRUNCATED_DRAFT_MARKER);
}

function extractText(response: { content?: Array<{ type: string; text?: string }> }): string {
  if (!Array.isArray(response.content)) return "";
  return response.content
    .filter(
      (block): block is { type: string; text: string } =>
        block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function normalizeContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (
          block &&
          typeof block === "object" &&
          "text" in block &&
          typeof block.text === "string"
        ) {
          return block.text;
        }
        return "[structured content]";
      })
      .join("\n");
  }

  if (!content) return "";
  return JSON.stringify(content).slice(0, 500);
}

function stripToolResults(content: unknown): string {
  const normalized = normalizeContent(content);
  return normalized
    .replace(/<tool_result\b[^>]*>[\s\S]*?<\/tool_result>/gi, "[evidence gathered - see clipboard]")
    .replace(/<chunk_request\b[^>]*>[\s\S]*?<\/chunk_request>/gi, "")
    .replace(/<context_request\b[^>]*>[\s\S]*?<\/context_request>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function estimateTokens(text: string): number {
  // A UTF-8 byte upper bound is deliberately conservative across the supported
  // tokenizers: it cannot undercount CJK, emoji, source code, or high-entropy
  // strings the way characters/4 can. Include framing allowance per message.
  return Buffer.byteLength(text, "utf8") + 12;
}

function boundSummary(summary: string): string {
  if (summary.length <= MAX_COMPACTION_SUMMARY_CHARS) return summary;
  const suffix = "\n[summary bounded]";
  const maxBodyChars = Math.max(1, MAX_COMPACTION_SUMMARY_CHARS - suffix.length);
  const clipped = summary.slice(0, maxBodyChars);
  const lastBoundary = Math.max(clipped.lastIndexOf("\n"), clipped.lastIndexOf(". "));
  return `${clipped.slice(0, lastBoundary > maxBodyChars * 0.75 ? lastBoundary + 1 : clipped.length).trim()}${suffix}`;
}

function buildExtractiveFallbackSummary(
  existingSummary: string | null,
  turns: Array<{ role: string; content: unknown }>,
): string {
  const decisionPattern =
    /\b(?:thesis|argument|decid(?:e|ed)|must|never|exclude|include|emphasize|citation|tone|format|section|revise|replace|instead|do not|don't|end with|heading|first person|word count|length)\b/i;
  const durableLines = turns.flatMap((message) => {
    const cleaned = stripToolResults(message.content);
    const lines = cleaned
      .split(/(?<=[.!?])\s+|\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const selected = lines.filter((line) => decisionPattern.test(line));
    const fallback = selected.length > 0 ? selected : message.role === "user" ? lines.slice(0, 2) : [];
    return fallback.map((line) => `[${message.role}] ${line.slice(0, 600)}`);
  });
  const previousBudget = existingSummary ? Math.floor(MAX_COMPACTION_SUMMARY_CHARS * 0.55) : 0;
  const previous = existingSummary ? boundSummary(existingSummary).slice(0, previousBudget).trim() : "";
  const header = "Deterministic compaction fallback (model summary unavailable):";
  const remainingBudget = Math.max(
    500,
    MAX_COMPACTION_SUMMARY_CHARS - previous.length - header.length - 16,
  );
  const extracted = durableLines.join("\n").slice(0, remainingBudget).trim();
  return boundSummary([previous, header, extracted || "No durable decisions were extracted."].filter(Boolean).join("\n\n"));
}

function preserveDurableSummaryState(existingSummary: string | null, nextSummary: string): string {
  if (!existingSummary?.trim()) return nextSummary;
  const decisionPattern =
    /\b(?:thesis|argument|decid(?:e|ed)|must|never|exclude|include|citation|tone|format|section|revise|replace|instead|do not|don't|end with|heading|first person|word count|length)\b/i;
  const nextTerms = lexicalTerms(nextSummary);
  const missing = existingSummary
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length >= 12 &&
        (decisionPattern.test(line) || /^[-*]\s+/.test(line) || /^\[(?:user|assistant)\]/i.test(line)),
    )
    .filter((line) => {
      const terms = Array.from(lexicalTerms(line));
      if (terms.length === 0) return false;
      const overlap = terms.filter((term) => nextTerms.has(term)).length;
      return overlap / terms.length < 0.5;
    })
    .slice(0, 12);
  if (missing.length === 0) return nextSummary;
  const carryHeader = "Carry-forward decisions preserved deterministically:";
  const carryBudget = Math.floor(MAX_COMPACTION_SUMMARY_CHARS * 0.35);
  const carry = `${carryHeader}\n${missing.map((line) => `- ${line}`).join("\n")}`.slice(
    0,
    carryBudget,
  );
  const nextBudget = Math.max(500, MAX_COMPACTION_SUMMARY_CHARS - carry.length - 2);
  return `${nextSummary.slice(0, nextBudget).trim()}\n\n${carry}`;
}

type InclusionState = "include" | "exclude";

function normalizeDecisionSubject(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/^the\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCitationStyleDecisions(
  text: string,
): Array<{ index: number; style: string; value: string }> {
  const decisions: Array<{ index: number; style: string; value: string }> = [];
  const patterns = [
    /\b(?:switch(?:ed|ing)?|chang(?:e|ed|ing)|mov(?:e|ed|ing))\b[^.!?\n]{0,80}?\bto\s+(apa|mla|chicago)\b/gi,
    /\b(?:requires?|required|adopt(?:ed|ing)?|select(?:ed|ing)?|cho(?:ose|sen|osing))\s+(apa|mla|chicago)\b/gi,
    /\b(?:use|using)\s+(apa|mla|chicago)(?:\s+(?:citation|citations|style))?\b/gi,
    /\bcitation\s+style\s*(?:is|was|:|=|to)?\s*(apa|mla|chicago)\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of Array.from(text.matchAll(pattern))) {
      const style = match[1].toUpperCase();
      const afterStyle = text.slice((match.index ?? 0) + match[0].length);
      const variant = afterStyle.match(
        /^\s+(notes?\s+and\s+bibliography|author[- ]date|footnotes?|parenthetical(?:\s+citations?)?)/i,
      )?.[1];
      const displayStyle = style === "CHICAGO" ? "Chicago" : style;
      decisions.push({
        index: match.index ?? 0,
        style,
        value: variant ? `${displayStyle} ${variant.toLowerCase()}` : displayStyle,
      });
    }
  }
  return decisions.sort((left, right) => left.index - right.index);
}

function extractInclusionDecisions(
  text: string,
): Array<{ index: number; subject: string; displaySubject: string; state: InclusionState }> {
  const decisions: Array<{
    index: number;
    subject: string;
    displaySubject: string;
    state: InclusionState;
  }> = [];
  const pattern =
    /\b(include|exclude|omit|remove|keep|restore|reintroduce)\s+(?:the\s+)?([^.!?\n,;]{2,160}?)(?=\s+instead\b|[.!?\n,;]|$)/gi;
  for (const match of Array.from(text.matchAll(pattern))) {
    const verb = match[1].toLowerCase();
    const displaySubject = match[2].trim();
    const subject = normalizeDecisionSubject(displaySubject);
    if (!subject) continue;
    decisions.push({
      index: match.index ?? 0,
      subject,
      displaySubject,
      state:
        verb === "include" || verb === "keep" || verb === "restore" || verb === "reintroduce"
          ? "include"
          : "exclude",
    });
  }
  return decisions;
}

/**
 * Carry-forward memory is useful only while it remains current. Detect explicit
 * reversals conservatively (the same citation-style slot or exact inclusion
 * subject must have both states), remove stale statements, and append a compact
 * canonical statement of the latest decision.
 */
function removeSupersededSummaryDecisions(summary: string, decisionContext: string[]): string {
  const context = decisionContext.filter(Boolean).join("\n");
  const citationDecisions = extractCitationStyleDecisions(context);
  const citationStyles = new Set(citationDecisions.map((decision) => decision.style));
  const currentCitationStyle =
    citationStyles.size > 1 ? citationDecisions[citationDecisions.length - 1]?.style : null;
  const currentCitationValue = currentCitationStyle
    ? citationDecisions[citationDecisions.length - 1]?.value || currentCitationStyle
    : null;
  const staleCitationStyles = currentCitationStyle
    ? Array.from(citationStyles).filter((style) => style !== currentCitationStyle)
    : [];

  const inclusionHistory = new Map<
    string,
    { displaySubject: string; states: Set<InclusionState>; latest: InclusionState }
  >();
  for (const decision of extractInclusionDecisions(context)) {
    const existing = inclusionHistory.get(decision.subject);
    if (existing) {
      existing.states.add(decision.state);
      existing.latest = decision.state;
      existing.displaySubject = decision.displaySubject;
    } else {
      inclusionHistory.set(decision.subject, {
        displaySubject: decision.displaySubject,
        states: new Set([decision.state]),
        latest: decision.state,
      });
    }
  }
  const reversedInclusionDecisions = Array.from(inclusionHistory.entries()).filter(
    ([, decision]) => decision.states.size > 1,
  );

  let lines = summary
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (staleCitationStyles.length > 0) {
    lines = lines.filter(
      (line) => !staleCitationStyles.some((style) => new RegExp(`\\b${style}\\b`, "i").test(line)),
    );
  }

  const includeWords = /\b(?:include|included|including|keep|kept|restore|restored|reintroduce|reintroduced)\b/i;
  const excludeWords = /\b(?:exclude|excluded|excluding|omit|omitted|omitting|remove|removed|removing)\b/i;
  for (const [subject, decision] of reversedInclusionDecisions) {
    const staleWords = decision.latest === "include" ? excludeWords : includeWords;
    lines = lines.filter((line) => {
      const normalizedLine = normalizeDecisionSubject(line);
      return !(normalizedLine.includes(subject) && staleWords.test(line));
    });
  }

  if (
    currentCitationValue &&
    !lines.some((line) => line.toLowerCase().includes(currentCitationValue.toLowerCase()))
  ) {
    lines.push(`Current citation style: ${currentCitationValue}.`);
  }
  for (const [subject, decision] of reversedInclusionDecisions) {
    const currentWords = decision.latest === "include" ? includeWords : excludeWords;
    const alreadyRepresented = lines.some(
      (line) => normalizeDecisionSubject(line).includes(subject) && currentWords.test(line),
    );
    if (!alreadyRepresented) {
      lines.push(`Current decision: ${decision.latest} the ${decision.displaySubject}.`);
    }
  }
  return lines.join("\n");
}

export function isSyntheticRetrievalMessage(content: string): boolean {
  return (
    /^\s*\[(?:CONTEXT RETRIEVAL|DEEP DIVE FINDINGS|EVIDENCE GATHERED THIS TURN|EVIDENCE CLIPBOARD)\b/i.test(
      content,
    ) ||
    /^\s*<(?:tool_result|chunk_request|context_request)\b/i.test(content)
  );
}

/**
 * Escalation adds a server-generated retrieval user message after the genuine
 * request. Both are required: evidence without its question is unsafe, while a
 * question without the retrieved evidence defeats the escalation.
 */
export function getRequiredTurnMessageIndices(
  messages: CompactedMessage[],
  currentRequest = "",
): number[] {
  let genuineRequestIndex = -1;
  if (currentRequest) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === "user" && messages[index].content === currentRequest) {
        genuineRequestIndex = index;
        break;
      }
    }
  }
  if (genuineRequestIndex < 0) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (
        message.role === "user" &&
        !isSyntheticRetrievalMessage(message.content) &&
        !/^\s*\[EARLIER CONVERSATION SUMMARY\b/i.test(message.content)
      ) {
        genuineRequestIndex = index;
        break;
      }
    }
  }

  let retrievalIndex = -1;
  for (let index = messages.length - 1; index > genuineRequestIndex; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && isSyntheticRetrievalMessage(message.content)) {
      retrievalIndex = index;
      break;
    }
  }

  return [genuineRequestIndex, retrievalIndex]
    .filter((index, position, indices) => index >= 0 && indices.indexOf(index) === position)
    .sort((left, right) => left - right);
}

function isDurableMemoryMessage(content: string): boolean {
  return (
    content.startsWith("[EVIDENCE CLIPBOARD") ||
    content.startsWith("[EARLIER CONVERSATION SUMMARY")
  );
}

function isCurrentTurnEvidenceMessage(content: string): boolean {
  return content.startsWith("[EVIDENCE GATHERED THIS TURN]");
}

function lexicalTerms(text: string): Set<string> {
  const stopwords = new Set([
    "about",
    "after",
    "again",
    "also",
    "and",
    "are",
    "but",
    "for",
    "from",
    "have",
    "into",
    "not",
    "that",
    "the",
    "their",
    "this",
    "was",
    "what",
    "when",
    "with",
    "you",
    "your",
  ]);
  const matched =
    text
      .normalize("NFKC")
      .toLowerCase()
      .match(new RegExp("[\\p{L}\\p{N}]{2,}", "gu")) ?? [];
  const terms: string[] = [];
  for (const rawTerm of matched) {
    const term = rawTerm.trim();
    if (term.length > 2 && !stopwords.has(term)) terms.push(term);
    // Whitespace-free scripts need subword features; otherwise an entire CJK
    // sentence becomes one token and semantically overlapping phrases never match.
    if (/[^\x00-\x7f]/.test(term)) {
      const characters = Array.from(term);
      for (let index = 0; index < characters.length - 1; index += 1) {
        terms.push(`${characters[index]}${characters[index + 1]}`);
      }
    }
  }
  return new Set(terms);
}

function countLexicalMatches(content: string, requestTerms: Set<string>): number {
  if (requestTerms.size === 0) return 0;
  const contentTerms = lexicalTerms(content);
  let matches = 0;
  for (const term of Array.from(requestTerms)) {
    if (contentTerms.has(term)) matches += 1;
  }
  return matches;
}

/**
 * Enforces a deterministic hard prompt budget. Required messages are retained;
 * then durable memory and ordinary dialogue outrank synthetic retrieval payloads.
 * Messages are returned in their original order.
 */
export function applyPromptMemoryPolicy({
  systemPrompt,
  messages,
  requiredMessageIndices = [],
  tokenBudget = DEFAULT_PROMPT_MEMORY_TOKEN_BUDGET,
  currentRequest = "",
  minimumRecentTurns = 2,
}: PromptMemoryPolicyInput): {
  messages: CompactedMessage[];
  diagnostics: PromptMemoryDiagnostics;
} {
  const budgetTokens = Math.max(1, tokenBudget);
  const systemTokens = estimateTokens(systemPrompt);
  const explicitRequired = new Set(
    requiredMessageIndices.filter((index) => index >= 0 && index < messages.length),
  );
  const messageTokens = messages.map((message) => estimateTokens(message.content));
  let usedTokens = systemTokens;
  const selected = new Set<number>();

  interface ExchangeUnit {
    indices: number[];
    hasGenuineUser: boolean;
    durable: boolean;
    synthetic: boolean;
    lexicalMatches: number;
    priority: number;
  }
  const units: ExchangeUnit[] = [];
  let currentUnit: ExchangeUnit | null = null;
  const requestText =
    currentRequest ||
    Array.from(explicitRequired)
      .map((index) => messages[index]?.content || "")
      .join("\n");
  const requestTerms = lexicalTerms(requestText);

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const durable = isDurableMemoryMessage(message.content);
    const synthetic = isSyntheticRetrievalMessage(message.content) && !durable;
    const genuineUser = message.role === "user" && !synthetic && !durable;
    const currentTurnEvidence = isCurrentTurnEvidenceMessage(message.content);
    if (
      message.role === "user" &&
      (genuineUser || durable || synthetic || currentTurnEvidence || !currentUnit)
    ) {
      currentUnit = {
        indices: [],
        hasGenuineUser: genuineUser,
        durable,
        synthetic,
        lexicalMatches: 0,
        priority: 0,
      };
      units.push(currentUnit);
    } else if (!currentUnit) {
      currentUnit = {
        indices: [],
        hasGenuineUser: false,
        durable: false,
        synthetic,
        lexicalMatches: 0,
        priority: 0,
      };
      units.push(currentUnit);
    }
    currentUnit.indices.push(index);
    currentUnit.durable ||= durable;
    currentUnit.synthetic ||= synthetic;
  }

  const recentGenuineUnits = units
    .filter((unit) => unit.hasGenuineUser)
    .slice(-Math.max(0, minimumRecentTurns));
  const recentUnits = new Set<ExchangeUnit>(recentGenuineUnits);
  const requiredUnits = new Set<ExchangeUnit>();
  for (const unit of units) {
    if (unit.indices.some((index) => explicitRequired.has(index))) requiredUnits.add(unit);
  }

  for (const unit of units) {
    const content = unit.indices.map((index) => messages[index].content).join("\n");
    unit.lexicalMatches = countLexicalMatches(content, requestTerms);
    const durableDecision =
      /\b(?:decid(?:e|ed)|must|never|exclude|include|thesis|citation style|tone|format|pinned?)\b/i.test(
        content,
      );
    const quotedEvidence = /\[direct_quote\]|(?:^|\s)"[^"\n]{20,}"/i.test(content);
    const durableDraft = /<document(?:\s|>)/i.test(content);
    const newestIndex = unit.indices[unit.indices.length - 1] || 0;
    unit.priority =
      (unit.durable ? 1_000_000 : 0) +
      (recentUnits.has(unit) ? 700_000 : 0) +
      (isCurrentTurnEvidenceMessage(content) ? 600_000 : 0) +
      (quotedEvidence ? 400_000 : 0) +
      (durableDraft ? 350_000 : 0) +
      (durableDecision ? 250_000 : 0) +
      unit.lexicalMatches * 20_000 +
      (unit.synthetic ? 0 : 10_000) +
      newestIndex;
  }

  for (const unit of Array.from(requiredUnits)) {
    for (const index of unit.indices) {
      selected.add(index);
      usedTokens += messageTokens[index];
    }
  }

  if (usedTokens > budgetTokens) {
    throw new Error(
      `Required prompt context exceeds the configured memory budget (${usedTokens}/${budgetTokens} estimated tokens).`,
    );
  }

  const candidates = units
    .filter((unit) => !requiredUnits.has(unit))
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        right.indices[right.indices.length - 1] - left.indices[left.indices.length - 1],
    );

  for (const candidate of candidates) {
    const tokens = candidate.indices.reduce((total, index) => total + messageTokens[index], 0);
    if (usedTokens + tokens > budgetTokens) continue;
    for (const index of candidate.indices) selected.add(index);
    usedTokens += tokens;
  }

  const output = messages.filter((_, index) => selected.has(index));
  const dropped = messages.filter((_, index) => !selected.has(index));
  const keptSyntheticMessageCount = output.filter((message) =>
    isSyntheticRetrievalMessage(message.content),
  ).length;
  const droppedSyntheticMessageCount = dropped.filter((message) =>
    isSyntheticRetrievalMessage(message.content),
  ).length;

  return {
    messages: output,
    diagnostics: {
      budgetTokens,
      estimatedSystemTokens: systemTokens,
      estimatedMessageTokens: usedTokens - systemTokens,
      estimatedTotalTokens: usedTokens,
      inputMessageCount: messages.length,
      outputMessageCount: output.length,
      droppedMessageCount: dropped.length,
      droppedSyntheticMessageCount,
      keptSyntheticMessageCount,
      inputExchangeCount: units.length,
      outputExchangeCount: units.filter((unit) =>
        unit.indices.some((index) => selected.has(index)),
      ).length,
      droppedExchangeCount: units.filter((unit) =>
        unit.indices.every((index) => !selected.has(index)),
      ).length,
      lexicalMatchesRetained: units
        .filter((unit) => unit.indices.some((index) => selected.has(index)))
        .reduce((total, unit) => total + unit.lexicalMatches, 0),
      overBudget: false,
    },
  };
}

export type ReaderMemoryMode = "precision" | "extended";

export function applyReaderPromptMemoryPolicy(
  mode: ReaderMemoryMode,
  input: PromptMemoryPolicyInput,
): ReturnType<typeof applyPromptMemoryPolicy> {
  const result = applyPromptMemoryPolicy(input);
  return {
    ...result,
    diagnostics: { ...result.diagnostics, readerMode: mode },
  };
}

export async function compactConversation(
  anthropic: AnthropicLike,
  messages: Array<{ role: string; content: unknown }>,
  existingSummary: string | null,
  compactedAtTurn: number,
  threshold: number = DEFAULT_COMPACTION_THRESHOLD,
): Promise<{ summary: string; compactedAtTurn: number } | null> {
  const isGenuineUser = (message: { role: string; content: unknown }) =>
    message.role === "user" && !isSyntheticRetrievalMessage(normalizeContent(message.content));
  const userTurnCount = messages.filter(isGenuineUser).length;
  const newlySummarizableTurns = userTurnCount - threshold - compactedAtTurn;
  const minimumBatchSize = compactedAtTurn === 0 && !existingSummary ? 1 : threshold;
  if (newlySummarizableTurns < minimumBatchSize) {
    return null;
  }

  let genuineUsersSeen = 0;
  let startIndex = messages.length;
  for (let index = 0; index < messages.length; index += 1) {
    if (!isGenuineUser(messages[index])) continue;
    genuineUsersSeen += 1;
    if (genuineUsersSeen > compactedAtTurn) {
      startIndex = index;
      break;
    }
  }
  genuineUsersSeen = 0;
  let endIndex = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (!isGenuineUser(messages[index])) continue;
    genuineUsersSeen += 1;
    if (genuineUsersSeen === threshold) {
      endIndex = index;
      break;
    }
  }
  startIndex = Math.min(startIndex, endIndex);
  const turnsToSummarize = messages.slice(startIndex, endIndex);
  if (turnsToSummarize.length === 0) {
    return null;
  }

  const summaryInput = existingSummary
    ? `Previous summary:\n${existingSummary}\n\nNew turns to incorporate:\n`
    : "";

  let summaryText = "";
  try {
    const response = await anthropic.messages.create(
      {
        model: ANTHROPIC_MODELS.haiku,
        max_tokens: 2048,
        system: `Summarize this conversation history for an academic writing assistant. Preserve:
- The thesis and argument structure being developed
- Key decisions made, including what to include, exclude, or emphasize
- Section structure of the paper so far
- Specific student instructions about tone, citation style, and formatting
Discard:
- Bulky raw source dumps and tool-call details
- Discovery questions already answered
- Superseded drafts where only the latest version matters
- Preserve source IDs, exact approved quotes and locators, and evidence decisions unless they are already represented in the supplied evidence memory
Be concise. Target 300-500 tokens. Write in past tense.`,
        messages: [
          {
            role: "user",
            content:
              summaryInput +
              turnsToSummarize
                .map(
                  (message) =>
                    `[${message.role}]: ${normalizeContent(message.content).slice(0, 2000) || "[empty]"}`,
                )
                .join("\n\n"),
          },
        ],
      },
      { timeout: 8_000, maxRetries: 0 },
    );
    summaryText = extractText(response);
  } catch {
    // A deterministic fallback below keeps the writing turn alive and prevents
    // unsummarized decisions from disappearing from the managed prompt.
  }

  if (!summaryText) {
    summaryText = buildExtractiveFallbackSummary(existingSummary, turnsToSummarize);
  } else {
    summaryText = preserveDurableSummaryState(existingSummary, summaryText);
  }
  summaryText = removeSupersededSummaryDecisions(summaryText, [
    existingSummary || "",
    ...turnsToSummarize.map((message) => normalizeContent(message.content)),
  ]);

  return {
    // The summarizer already received the previous summary, so replace it with
    // the newly consolidated version instead of appending forever.
    summary: boundSummary(summaryText),
    compactedAtTurn: userTurnCount - threshold,
  };
}

export function compactReaderConversation(
  _mode: ReaderMemoryMode,
  anthropic: AnthropicLike,
  messages: Array<{ role: string; content: unknown }>,
  existingSummary: string | null,
  compactedAtTurn: number,
  threshold: number = DEFAULT_COMPACTION_THRESHOLD,
): ReturnType<typeof compactConversation> {
  return compactConversation(
    anthropic,
    messages,
    existingSummary,
    compactedAtTurn,
    threshold,
  );
}

/**
 * Return the messages containing the latest known revision of every named
 * <document> section. Untitled and non-tagged substantive drafts are treated as
 * distinct so the compile path fails closed instead of silently omitting prose.
 * Output-limit partials are continuation context, never canonical paper state.
 */
export function getRequiredCompileMessageIndices(messages: CompactedMessage[]): number[] {
  const latestBySection = new Map<string, number>();
  const untitled = new Set<number>();
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== "assistant" || isTruncatedDraftMessage(message.content)) continue;
    if (!/<document(?:\s|>)/i.test(message.content)) {
      const paragraphs = message.content
        .trim()
        .split(/\n\s*\n/)
        .filter((paragraph) => paragraph.trim().length >= 120);
      const looksLikeDraft =
        message.content.trim().length >= 300 &&
        (paragraphs.length >= 2 || /(?:^|\n)#{1,6}\s+|\[\^\d+\]:/m.test(message.content));
      if (looksLikeDraft) untitled.add(index);
      continue;
    }
    const tags = Array.from(message.content.matchAll(/<document\b([^>]*)>/gi));
    let foundNamedSection = false;
    for (const tag of tags) {
      const attributes = tag[1] || "";
      const titleMatch = attributes.match(
        /\btitle\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i,
      );
      const title = (titleMatch?.[1] || titleMatch?.[2] || titleMatch?.[3] || "")
        .normalize("NFKC")
        .trim()
        .toLowerCase();
      if (!title) continue;
      foundNamedSection = true;
      latestBySection.set(title, index);
    }
    if (!foundNamedSection) untitled.add(index);
  }
  return Array.from(
    new Set(Array.from(latestBySection.values()).concat(Array.from(untitled))),
  ).sort(
    (left, right) => left - right,
  );
}

export function normalizeReaderMessages(
  messages: CompactedMessage[],
): Array<{ role: "user" | "assistant"; content: string }> {
  const normalized: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    const content = message.content.trim();
    if (!content) continue;
    if (normalized.length === 0 && message.role === "assistant") {
      normalized.push({
        role: "user",
        content: "[CONTINUATION CONTEXT] Resume from the saved assistant work below.",
      });
    }
    const previous = normalized[normalized.length - 1];
    if (previous?.role === message.role) {
      previous.content = `${previous.content}\n\n${content}`;
    } else {
      normalized.push({ role: message.role, content });
    }
  }
  return normalized;
}

function selectRelevantEarlierMessageIndices(
  messages: Array<{ role: string; content: unknown }>,
  endIndex: number,
  currentRequest: string,
  limit: number,
): Set<number> {
  if (!currentRequest.trim() || endIndex <= 0 || limit <= 0) return new Set();
  const requestTerms = lexicalTerms(currentRequest);
  if (requestTerms.size === 0) return new Set();

  const exchanges: Array<{ indices: number[]; newestIndex: number; content: string }> = [];
  let current: { indices: number[]; newestIndex: number; content: string } | null = null;
  for (let index = 0; index < endIndex; index += 1) {
    const message = messages[index];
    const normalized = normalizeContent(message.content);
    const synthetic = isSyntheticRetrievalMessage(normalized);
    const genuineUser = message.role === "user" && !synthetic;
    if (genuineUser || !current) {
      current = { indices: [], newestIndex: index, content: "" };
      exchanges.push(current);
    }
    // Old synthetic retrieval payloads are intentionally not rehydrated. Their
    // durable citations belong in the evidence archive instead.
    if (synthetic) continue;
    const stripped = stripToolResults(message.content);
    if (!stripped) continue;
    current.indices.push(index);
    current.newestIndex = index;
    current.content += `${stripped}\n`;
  }

  const ranked = exchanges
    .map((exchange) => {
      const matches = countLexicalMatches(exchange.content, requestTerms);
      const durableSignal =
        /\b(?:thesis|decid(?:e|ed)|must|never|exclude|include|citation|tone|format|revise|replace)\b/i.test(
          exchange.content,
        ) || /<document(?:\s|>)/i.test(exchange.content);
      return {
        exchange,
        matches,
        score: matches * 100_000 + (durableSignal ? 10_000 : 0) + exchange.newestIndex,
      };
    })
    .filter((candidate) => candidate.matches > 0 && candidate.exchange.indices.length > 0)
    .sort((left, right) => right.score - left.score || right.exchange.newestIndex - left.exchange.newestIndex)
    .slice(0, limit);

  return new Set(ranked.flatMap((candidate) => candidate.exchange.indices));
}

export function buildCompactedHistory(
  messages: Array<{ role: string; content: unknown }>,
  clipboardFormatted: string,
  compactionSummary: string | null,
  compactedAtTurn: number,
  recentTurnCount: number = 6,
  options: CompactedHistoryOptions = {},
): CompactedMessage[] {
  const result: CompactedMessage[] = [];

  if (clipboardFormatted && clipboardFormatted !== "[No evidence collected yet]") {
    result.push({
      role: "user",
      content: `[EVIDENCE CLIPBOARD - accumulated research]\n${clipboardFormatted}`,
    });
    result.push({
      role: "assistant",
      content: "I have the accumulated evidence clipboard. I'll reference it as needed.",
    });
  }

  if (compactionSummary) {
    result.push({
      role: "user",
      content: `[EARLIER CONVERSATION SUMMARY - turns 1 through ${compactedAtTurn}; NOT SOURCE EVIDENCE, NEVER CITE]\n${compactionSummary}`,
    });
    result.push({
      role: "assistant",
      content: "I understand the earlier conversation context and will continue from there.",
    });
  }

  let recentStartIndex = messages.length;
  if (recentTurnCount > 0) {
    let genuineUsersSeen = 0;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (
        message.role === "user" &&
        !isSyntheticRetrievalMessage(normalizeContent(message.content))
      ) {
        genuineUsersSeen += 1;
        recentStartIndex = index;
        if (genuineUsersSeen >= recentTurnCount) break;
      }
    }
  }
  const relevantEarlierIndices = compactionSummary
    ? selectRelevantEarlierMessageIndices(
        messages,
        recentStartIndex,
        options.currentRequest || "",
        Math.max(0, options.relevantEarlierTurnCount ?? 4),
      )
    : new Set<number>();
  const candidateMessages = compactionSummary
    ? messages.filter((_, index) => index >= recentStartIndex || relevantEarlierIndices.has(index))
    : messages;
  for (const message of candidateMessages) {
    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }

    const strippedContent = stripToolResults(message.content);
    if (!strippedContent) continue;
    result.push({
      role: message.role,
      content: strippedContent,
    });
  }

  return result;
}

export function getToolResponseLimit(sourceCount: number): number {
  if (sourceCount <= 5) return 5000;
  if (sourceCount <= 10) return 3000;
  if (sourceCount <= 20) return 1500;
  return 800;
}

export function truncateToolResult(result: string, limit: number): string {
  if (result.length <= limit) {
    return result;
  }

  const suffix = "\n\n[...truncated - use more specific queries for details]";
  const bodyLimit = Math.max(0, limit - suffix.length);
  const candidate = result.slice(0, bodyLimit);
  const boundaryCandidates = [
    candidate.lastIndexOf("\n\n"),
    candidate.lastIndexOf("\n"),
    candidate.lastIndexOf(". "),
  ];
  let boundary = Math.max(...boundaryCandidates);
  if (boundary < bodyLimit * 0.15) {
    boundary = Math.max(candidate.indexOf("\n"), 0);
  }
  let safeBody = candidate.slice(0, boundary > 0 ? boundary + 1 : 0).trimEnd();

  // Never retain half of a quoted finding. If the safe prefix has an unmatched
  // quote, drop back to the boundary before that quote instead of corrupting it.
  const quoteCount = (safeBody.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2 === 1) {
    const openingQuote = safeBody.lastIndexOf('"');
    const beforeQuote = safeBody.slice(0, openingQuote);
    const priorBoundary = Math.max(
      beforeQuote.lastIndexOf("\n\n"),
      beforeQuote.lastIndexOf("\n"),
      beforeQuote.lastIndexOf(". "),
    );
    safeBody = beforeQuote.slice(0, priorBoundary > 0 ? priorBoundary + 1 : 0).trimEnd();
  }

  return `${safeBody}${suffix}`;
}
