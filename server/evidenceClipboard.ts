import { ANTHROPIC_MODELS } from "./aiModels";

export interface EvidenceItem {
  type: "direct_quote" | "paraphrase" | "data_point" | "finding";
  text: string;
  citedInTurn: number;
  location?: string;
  /** User- or workflow-pinned evidence receives the highest retention priority. */
  pinned?: boolean;
}

export interface EvidenceClipboard {
  version: number;
  collectedAt: number;
  thesis: string;
  evidence: Array<{
    sourceId: string;
    sourceTitle: string;
    items: EvidenceItem[];
  }>;
  styleProfile?: {
    sentenceLength: string;
    vocabulary: string;
    tone: string;
    transitions: string[];
  };
  writingProgress: Array<{
    section: string;
    status: "drafted" | "revised" | "final";
    turnNumber: number;
  }>;
  tokenEstimate: number;
}

interface AnthropicLike {
  messages: {
    create: (...args: any[]) => Promise<{
      content: Array<{ type: string; text?: string }>;
    }>;
  };
}

const CLIPBOARD_VERSION = 1;
export const DEFAULT_CLIPBOARD_TOKEN_BUDGET = Math.max(
  2_000,
  parseInt(process.env.CLIPBOARD_TOKEN_BUDGET || "12000", 10) || 12_000,
);
export const DEFAULT_CLIPBOARD_ITEM_LIMIT = Math.max(
  20,
  parseInt(process.env.CLIPBOARD_ITEM_LIMIT || "120", 10) || 120,
);
const MAX_WRITING_PROGRESS_ITEMS = 40;

export interface ClipboardRetentionDiagnostics {
  tokenBudget: number;
  inputItems: number;
  outputItems: number;
  evictedItems: number;
  evictedPinnedItems: number;
  tokenEstimate: number;
}
const STATUS_ORDER: Record<"drafted" | "revised" | "final", number> = {
  drafted: 1,
  revised: 2,
  final: 3,
};

function clampString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEvidenceText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(new RegExp("[^\\p{L}\\p{N}\\s]", "gu"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordSet(text: string): Set<string> {
  const words = normalizeEvidenceText(text).split(" ").filter(Boolean);
  const terms = [...words];
  for (const word of words) {
    if (!/[^\x00-\x7f]/.test(word)) continue;
    const characters = Array.from(word);
    for (let index = 0; index < characters.length - 1; index += 1) {
      terms.push(`${characters[index]}${characters[index + 1]}`);
    }
  }
  return new Set(terms);
}

function similarityScore(left: string, right: string): number {
  const normalizedLeft = normalizeEvidenceText(left);
  const normalizedRight = normalizeEvidenceText(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  if (
    normalizedLeft.length > 24 &&
    normalizedRight.length > 24 &&
    (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))
  ) {
    return 0.95;
  }

  const leftWords = wordSet(left);
  const rightWords = wordSet(right);
  const intersection = Array.from(leftWords).filter((word) => rightWords.has(word)).length;
  const union = new Set([...Array.from(leftWords), ...Array.from(rightWords)]).size;
  return union === 0 ? 0 : intersection / union;
}

function isEvidenceItem(value: unknown): value is EvidenceItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<EvidenceItem>;
  return (
    (item.type === "direct_quote" ||
      item.type === "paraphrase" ||
      item.type === "data_point" ||
      item.type === "finding") &&
    typeof item.text === "string"
  );
}

function computeTokenEstimate(clipboard: EvidenceClipboard): number {
  const json = JSON.stringify({ ...clipboard, tokenEstimate: 0 });
  return Math.ceil(json.length / 4);
}

function withTokenEstimate(clipboard: EvidenceClipboard): EvidenceClipboard {
  return {
    ...clipboard,
    tokenEstimate: computeTokenEstimate(clipboard),
  };
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function normalizeClipboard(value: Partial<EvidenceClipboard> | null): EvidenceClipboard {
  const normalized: EvidenceClipboard = {
    version: CLIPBOARD_VERSION,
    collectedAt: typeof value?.collectedAt === "number" ? value.collectedAt : Date.now(),
    thesis: clampString(value?.thesis),
    evidence: Array.isArray(value?.evidence)
      ? value.evidence
          .map((source) => {
            const sourceId = clampString(source?.sourceId);
            const sourceTitle = clampString(source?.sourceTitle);
            const items = Array.isArray(source?.items)
              ? source.items
                  .filter(isEvidenceItem)
                  .map((item) => ({
                    type: item.type,
                    text: clampString(item.text),
                    citedInTurn: typeof item.citedInTurn === "number" ? item.citedInTurn : 0,
                    ...(clampString(item.location) ? { location: clampString(item.location) } : {}),
                    ...(item.pinned === true ? { pinned: true } : {}),
                  }))
                  .filter((item) => item.text.length > 0)
              : [];

            if (!sourceId || !sourceTitle || items.length === 0) {
              return null;
            }

            return { sourceId, sourceTitle, items };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null)
      : [],
    styleProfile: value?.styleProfile
      ? {
          sentenceLength: clampString(value.styleProfile.sentenceLength),
          vocabulary: clampString(value.styleProfile.vocabulary),
          tone: clampString(value.styleProfile.tone),
          transitions: Array.isArray(value.styleProfile.transitions)
            ? value.styleProfile.transitions
                .map((transition) => clampString(transition))
                .filter(Boolean)
                .slice(0, 8)
            : [],
        }
      : undefined,
    writingProgress: Array.isArray(value?.writingProgress)
      ? value.writingProgress
          .map((progress) => {
            const section = clampString(progress?.section);
            const status = progress?.status;
            const turnNumber = typeof progress?.turnNumber === "number" ? progress.turnNumber : 0;

            if (!section) return null;
            if (status !== "drafted" && status !== "revised" && status !== "final") {
              return null;
            }

            return { section, status, turnNumber };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null)
      : [],
    tokenEstimate: typeof value?.tokenEstimate === "number" ? value.tokenEstimate : 0,
  };

  return withTokenEstimate(normalized);
}

export function createEmptyClipboard(thesis = ""): EvidenceClipboard {
  return withTokenEstimate({
    version: CLIPBOARD_VERSION,
    collectedAt: Date.now(),
    thesis: thesis.trim(),
    evidence: [],
    writingProgress: [],
    tokenEstimate: 0,
  });
}

export function serializeClipboard(clipboard: EvidenceClipboard): string {
  return JSON.stringify(withTokenEstimate(clipboard));
}

export function deserializeClipboard(json: string | null): EvidenceClipboard {
  if (!json) return createEmptyClipboard();
  return normalizeClipboard(safeJsonParse<Partial<EvidenceClipboard>>(json));
}

function isDuplicateItem(existing: EvidenceItem, incoming: EvidenceItem): boolean {
  if (existing.type !== incoming.type) return false;
  if (existing.location && incoming.location && existing.location === incoming.location) {
    return similarityScore(existing.text, incoming.text) >= 0.8;
  }
  return similarityScore(existing.text, incoming.text) >= 0.88;
}

export function mergeEvidence(
  clipboard: EvidenceClipboard,
  newEvidence: Array<{ sourceId: string; sourceTitle: string; items: EvidenceItem[] }>,
  turnNumber: number,
): EvidenceClipboard {
  const next = deserializeClipboard(serializeClipboard(clipboard));

  for (const incomingSource of newEvidence) {
    const sourceId = clampString(incomingSource?.sourceId);
    const sourceTitle = clampString(incomingSource?.sourceTitle);
    const incomingItems = Array.isArray(incomingSource?.items)
      ? incomingSource.items
          .filter(isEvidenceItem)
          .map((item) => ({
            type: item.type,
            text: clampString(item.text),
            citedInTurn: turnNumber,
            ...(clampString(item.location) ? { location: clampString(item.location) } : {}),
            ...(item.pinned === true ? { pinned: true } : {}),
          }))
          .filter((item) => item.text.length > 0)
      : [];

    if (!sourceId || !sourceTitle || incomingItems.length === 0) {
      continue;
    }

    const existingSource = next.evidence.find((source) => source.sourceId === sourceId);
    if (!existingSource) {
      next.evidence.push({
        sourceId,
        sourceTitle,
        items: incomingItems,
      });
      continue;
    }

    existingSource.sourceTitle = sourceTitle;

    for (const item of incomingItems) {
      const duplicate = existingSource.items.find((existingItem) =>
        isDuplicateItem(existingItem, item),
      );
      if (!duplicate) {
        existingSource.items.push(item);
        continue;
      }

      if (!duplicate.location && item.location) {
        duplicate.location = item.location;
      }
      if (item.citedInTurn > duplicate.citedInTurn) {
        duplicate.citedInTurn = item.citedInTurn;
      }
      if (item.pinned) {
        duplicate.pinned = true;
      }
    }
  }

  next.collectedAt = Date.now();
  return withTokenEstimate(next);
}

export function updateProgress(
  clipboard: EvidenceClipboard,
  sections: Array<{ section: string; status: "drafted" | "revised" | "final" }>,
  turnNumber: number,
): EvidenceClipboard {
  const next = deserializeClipboard(serializeClipboard(clipboard));

  for (const sectionUpdate of sections) {
    const section = clampString(sectionUpdate?.section);
    const status = sectionUpdate?.status;
    if (!section) continue;
    if (status !== "drafted" && status !== "revised" && status !== "final") continue;

    const key = section.toLowerCase();
    const existing = next.writingProgress.find((item) => item.section.toLowerCase() === key);
    if (!existing) {
      next.writingProgress.push({ section, status, turnNumber });
      continue;
    }

    if (STATUS_ORDER[status] >= STATUS_ORDER[existing.status]) {
      existing.status = status;
    }
    existing.turnNumber = Math.max(existing.turnNumber, turnNumber);
  }

  next.collectedAt = Date.now();
  return withTokenEstimate(next);
}

function lexicalOverlap(left: string, right: string): number {
  if (!left.trim() || !right.trim()) return 0;
  const leftWords = wordSet(left);
  const rightWords = wordSet(right);
  let matches = 0;
  for (const word of Array.from(leftWords)) {
    if ((word.length > 2 || /[^\x00-\x7f]/.test(word)) && rightWords.has(word)) matches += 1;
  }
  return matches;
}

/**
 * Select whole evidence items so direct quotes are never clipped or silently
 * altered. Pinned items, exact quotes, located evidence, and recently used
 * evidence win space in that order. The original source/item order is retained.
 */
export function boundEvidenceClipboard(
  clipboard: EvidenceClipboard,
  options: { tokenBudget?: number; itemLimit?: number; query?: string } = {},
): { clipboard: EvidenceClipboard; diagnostics: ClipboardRetentionDiagnostics } {
  const tokenBudget = Math.max(1, options.tokenBudget ?? DEFAULT_CLIPBOARD_TOKEN_BUDGET);
  const itemLimit = Math.max(1, options.itemLimit ?? DEFAULT_CLIPBOARD_ITEM_LIMIT);
  const normalized = deserializeClipboard(serializeClipboard(clipboard));
  const candidates = normalized.evidence.flatMap((source, sourceIndex) =>
    source.items.map((item, itemIndex) => ({
      source,
      sourceIndex,
      item,
      itemIndex,
      key: `${sourceIndex}:${itemIndex}`,
      priority:
        (item.pinned ? 1_000_000_000 : 0) +
        (item.type === "direct_quote" ? 10_000_000 : 0) +
        lexicalOverlap(
          `${source.sourceTitle} ${source.sourceId} ${item.location || ""} ${item.text}`,
          options.query || "",
        ) *
          2_000_000 +
        (item.location ? 1_000_000 : 0) +
        Math.max(0, item.citedInTurn) * 1_000 -
        sourceIndex * 10 -
        itemIndex,
    })),
  );

  const base: EvidenceClipboard = withTokenEstimate({
    ...normalized,
    thesis: normalized.thesis.slice(0, 2_000),
    evidence: [],
    writingProgress: [...normalized.writingProgress]
      .sort((left, right) => right.turnNumber - left.turnNumber)
      .slice(0, MAX_WRITING_PROGRESS_ITEMS)
      .sort((left, right) => left.turnNumber - right.turnNumber),
    tokenEstimate: 0,
  });
  const selected = new Set<string>();
  let retained = base;

  for (const candidate of [...candidates].sort(
    (left, right) => right.priority - left.priority || left.sourceIndex - right.sourceIndex,
  )) {
    if (selected.size >= itemLimit) break;
    const proposedSelected = new Set(Array.from(selected)).add(candidate.key);
    const proposed = withTokenEstimate({
      ...base,
      evidence: normalized.evidence
        .map((source, sourceIndex) => ({
          ...source,
          items: source.items.filter((_, itemIndex) =>
            proposedSelected.has(`${sourceIndex}:${itemIndex}`),
          ),
        }))
        .filter((source) => source.items.length > 0),
      tokenEstimate: 0,
    });
    if (proposed.tokenEstimate > tokenBudget) continue;
    selected.add(candidate.key);
    retained = proposed;
  }

  // Extremely large ancillary metadata should not defeat the hard clipboard
  // budget. Evidence text itself is never truncated.
  if (retained.tokenEstimate > tokenBudget) {
    retained = withTokenEstimate({
      ...retained,
      styleProfile: undefined,
      writingProgress: [],
      tokenEstimate: 0,
    });
  }

  const evictedPinnedItems = candidates.filter(
    (candidate) => candidate.item.pinned && !selected.has(candidate.key),
  ).length;
  return {
    clipboard: retained,
    diagnostics: {
      tokenBudget,
      inputItems: candidates.length,
      outputItems: selected.size,
      evictedItems: candidates.length - selected.size,
      evictedPinnedItems,
      tokenEstimate: retained.tokenEstimate,
    },
  };
}

/**
 * Keep the recoverable evidence archive lossless while the query-aware prompt
 * view stays small. Prompt eviction must never permanently delete evidence
 * that a later writing turn may need.
 */
export function preserveStoredEvidenceClipboard(
  clipboard: EvidenceClipboard,
): { clipboard: EvidenceClipboard; diagnostics: ClipboardRetentionDiagnostics } {
  const normalized = deserializeClipboard(serializeClipboard(clipboard));
  const itemCount = normalized.evidence.reduce((total, source) => total + source.items.length, 0);
  return {
    clipboard: normalized,
    diagnostics: {
      tokenBudget: Number.MAX_SAFE_INTEGER,
      inputItems: itemCount,
      outputItems: itemCount,
      evictedItems: 0,
      evictedPinnedItems: 0,
      tokenEstimate: normalized.tokenEstimate,
    },
  };
}

export function formatClipboardForPrompt(
  clipboard: EvidenceClipboard,
  options: { tokenBudget?: number; itemLimit?: number; query?: string } = {},
): string {
  const bounded = boundEvidenceClipboard(clipboard, options).clipboard;
  if (bounded.evidence.length === 0) return "[No evidence collected yet]";

  let output = `## Accumulated Evidence (${bounded.evidence.reduce((count, source) => count + source.items.length, 0)} items from ${bounded.evidence.length} sources)\n`;

  for (const source of bounded.evidence) {
    output += `\n### ${source.sourceTitle}\n`;
    for (const item of source.items) {
      const prefix = item.type === "direct_quote" ? `"${item.text}"` : item.text;
      output += `- [${item.type}] ${prefix}${item.location ? ` (${item.location})` : ""}\n`;
    }
  }

  if (bounded.writingProgress.length > 0) {
    output += `\n## Writing Progress\n`;
    for (const progress of bounded.writingProgress) {
      output += `- ${progress.section}: ${progress.status} (turn ${progress.turnNumber})\n`;
    }
  }

  return output;
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsGroundedSourceId(availableEvidence: string, sourceId: string): boolean {
  const id = clampString(sourceId);
  if (!id || id.length > 200) return false;
  const escaped = escapeRegex(id);
  return new RegExp(
    `(?:\\[SOURCE\\s+|\\(source:\\s*|Document:\\s*)${escaped}(?=[\\]\\s,);]|$)`,
    "i",
  ).test(availableEvidence);
}

function termCoverage(claim: string, corpus: string): number {
  const claimTerms = Array.from(wordSet(claim)).filter(
    (term) => term.length > 2 || /[^\x00-\x7f]/.test(term),
  );
  if (claimTerms.length === 0) return 0;
  const corpusTerms = wordSet(corpus);
  const matched = claimTerms.filter((term) => corpusTerms.has(term)).length;
  return matched / claimTerms.length;
}

/**
 * Model extraction is advisory, never authoritative. Only known source IDs are
 * accepted; direct quotes must occur verbatim in both the supplied evidence and
 * the saved assistant response, while paraphrases need strong lexical grounding
 * in both. This prevents a second model call from poisoning durable memory.
 */
export function validateExtractedEvidence(
  extracted: Array<{ sourceId: string; sourceTitle: string; items: EvidenceItem[] }>,
  availableEvidence: string,
  assistantResponse: string,
): Array<{ sourceId: string; sourceTitle: string; items: EvidenceItem[] }> {
  if (!Array.isArray(extracted)) return [];
  return extracted.flatMap((source) => {
    const sourceId = clampString(source?.sourceId);
    const sourceTitle = clampString(source?.sourceTitle);
    if (!sourceId || !sourceTitle || !containsGroundedSourceId(availableEvidence, sourceId)) {
      return [];
    }
    const items = Array.isArray(source?.items)
      ? source.items.filter(isEvidenceItem).filter((item) => {
          const text = clampString(item.text);
          if (!text || text.length > 8_000) return false;
          if (item.type === "direct_quote") {
            return availableEvidence.includes(text) && assistantResponse.includes(text);
          }
          return (
            termCoverage(text, availableEvidence) >= 0.55 &&
            termCoverage(text, assistantResponse) >= 0.55
          );
        })
      : [];
    return items.length > 0 ? [{ sourceId, sourceTitle, items }] : [];
  });
}

export async function extractUsedEvidence(
  anthropic: AnthropicLike,
  assistantResponse: string,
  availableEvidence: string,
  currentClipboard: EvidenceClipboard,
  turnNumber: number,
): Promise<EvidenceClipboard> {
  const response = await anthropic.messages.create(
    {
      model: ANTHROPIC_MODELS.haiku,
      max_tokens: 2048,
      system: `Extract evidence that was actually used in the assistant's response. Return JSON with:
{
  "newEvidence": [{ "sourceId": "...", "sourceTitle": "...", "items": [{ "type": "direct_quote"|"paraphrase"|"data_point"|"finding", "text": "...", "location": "..." }] }],
  "sectionsWorkedOn": [{ "section": "...", "status": "drafted"|"revised"|"final" }]
}
Only include evidence that was clearly cited or referenced. Be precise.`,
      messages: [
        {
          role: "user",
          content: `Evidence available:\n${availableEvidence}\n\nAssistant wrote:\n${assistantResponse}\n\nWhat was actually used?`,
        },
      ],
    },
    { timeout: 8_000, maxRetries: 0 },
  );

  const text = extractText(response)
    .replace(/^```json\s*/i, "")
    .replace(/\s*```$/i, "");
  const parsed =
    safeJsonParse<{
      newEvidence?: Array<{ sourceId: string; sourceTitle: string; items: EvidenceItem[] }>;
      sectionsWorkedOn?: Array<{ section: string; status: "drafted" | "revised" | "final" }>;
    }>(text) || {};

  const groundedEvidence = validateExtractedEvidence(
    parsed.newEvidence || [],
    availableEvidence,
    assistantResponse,
  );
  let updated = mergeEvidence(currentClipboard, groundedEvidence, turnNumber);
  if (parsed.sectionsWorkedOn?.length) {
    updated = updateProgress(updated, parsed.sectionsWorkedOn, turnNumber);
  }

  updated.collectedAt = Date.now();
  return preserveStoredEvidenceClipboard(withTokenEstimate(updated)).clipboard;
}
