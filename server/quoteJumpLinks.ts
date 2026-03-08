export interface QuoteJumpTarget {
  quote: string;
  jumpPath: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFlexibleQuotePattern(quote: string): string {
  return escapeRegExp(quote.trim()).replace(/\s+/g, "\\s+");
}

function isAlreadyLinked(fullText: string, offset: number, length: number): boolean {
  const before = fullText.slice(Math.max(0, offset - 1), offset);
  const after = fullText.slice(offset + length, offset + length + 2);
  return before === "[" && after === "](";
}

function wrapQuotedOccurrences(markdown: string, target: QuoteJumpTarget): { text: string; replacements: number } {
  if (!target.quote.trim() || !target.jumpPath.trim()) {
    return { text: markdown, replacements: 0 };
  }

  const pattern = buildFlexibleQuotePattern(target.quote);
  const quotedPatterns = [
    new RegExp(`(")(${pattern})(")`, "g"),
    new RegExp(`(“)(${pattern})(”)`, "g"),
    new RegExp(`(')(${pattern})(')`, "g"),
    new RegExp(`(‘)(${pattern})(’)`, "g"),
  ];

  let replacements = 0;
  let nextText = markdown;

  for (const regex of quotedPatterns) {
    nextText = nextText.replace(regex, (match, open, inner, close, offset, fullText) => {
      const numericOffset = typeof offset === "number" ? offset : 0;
      if (isAlreadyLinked(fullText, numericOffset, match.length)) {
        return match;
      }
      replacements += 1;
      return `[${open}${inner}${close}](${target.jumpPath})`;
    });
  }

  return { text: nextText, replacements };
}

export function dedupeQuoteJumpTargets(targets: QuoteJumpTarget[]): QuoteJumpTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const quote = target.quote.trim();
    const jumpPath = target.jumpPath.trim();
    if (!quote || !jumpPath) return false;
    const key = `${quote}::${jumpPath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function applyJumpLinksToMarkdown(markdown: string, targets: QuoteJumpTarget[]): string {
  let result = markdown;
  const sortedTargets = dedupeQuoteJumpTargets(targets).sort((left, right) => right.quote.length - left.quote.length);

  for (const target of sortedTargets) {
    const linked = wrapQuotedOccurrences(result, target);
    result = linked.text;
  }

  return result;
}
