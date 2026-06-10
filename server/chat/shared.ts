import type { CitationData } from "@shared/schema";

export function clipText(text: string | null | undefined, maxChars: number): string {
  if (!text) return "";
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars).trimEnd()}...`;
}

export function buildAuthorLabel(citationData: CitationData | null): string {
  if (!citationData?.authors?.length) return "Unknown Author";
  return citationData.authors
    .map((author) => `${author.firstName} ${author.lastName}`.trim())
    .filter(Boolean)
    .join(", ");
}
