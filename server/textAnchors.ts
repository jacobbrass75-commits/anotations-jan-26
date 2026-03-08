export type TextMatchType =
  | "exact"
  | "case_insensitive"
  | "whitespace_insensitive"
  | "alphanumeric";

export interface TextRangeMatch {
  startPosition: number;
  endPosition: number;
  matchType: TextMatchType;
}

function buildIndexedText(text: string, mode: "whitespace" | "alphanumeric"): {
  normalized: string;
  rawPositions: number[];
} {
  const normalizedChars: string[] = [];
  const rawPositions: number[] = [];

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (mode === "whitespace" && /\s/.test(char)) continue;
    if (mode === "alphanumeric" && !/[a-z0-9]/i.test(char)) continue;
    normalizedChars.push(char.toLowerCase());
    rawPositions.push(i);
  }

  return {
    normalized: normalizedChars.join(""),
    rawPositions,
  };
}

function normalizeForEquality(text: string, mode: "whitespace" | "alphanumeric"): string {
  return buildIndexedText(text, mode).normalized;
}

export function textsLooselyEqual(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.toLowerCase() === right.toLowerCase()) return true;
  if (normalizeForEquality(left, "whitespace") === normalizeForEquality(right, "whitespace")) return true;
  return normalizeForEquality(left, "alphanumeric") === normalizeForEquality(right, "alphanumeric");
}

export function findTextRange(fullText: string, quote: string): TextRangeMatch | null {
  if (!fullText || !quote) return null;

  const directIndex = fullText.indexOf(quote);
  if (directIndex >= 0) {
    return {
      startPosition: directIndex,
      endPosition: directIndex + quote.length,
      matchType: "exact",
    };
  }

  const foldedText = fullText.toLowerCase();
  const foldedQuote = quote.toLowerCase();
  const insensitiveIndex = foldedText.indexOf(foldedQuote);
  if (insensitiveIndex >= 0) {
    return {
      startPosition: insensitiveIndex,
      endPosition: insensitiveIndex + quote.length,
      matchType: "case_insensitive",
    };
  }

  for (const mode of ["whitespace", "alphanumeric"] as const) {
    const indexedFullText = buildIndexedText(fullText, mode);
    const indexedQuote = buildIndexedText(quote, mode);
    if (!indexedQuote.normalized) continue;

    const normalizedIndex = indexedFullText.normalized.indexOf(indexedQuote.normalized);
    if (normalizedIndex < 0) continue;

    const startPosition = indexedFullText.rawPositions[normalizedIndex];
    const endPosition = indexedFullText.rawPositions[normalizedIndex + indexedQuote.normalized.length - 1] + 1;
    return {
      startPosition,
      endPosition,
      matchType: mode === "whitespace" ? "whitespace_insensitive" : "alphanumeric",
    };
  }

  return null;
}
