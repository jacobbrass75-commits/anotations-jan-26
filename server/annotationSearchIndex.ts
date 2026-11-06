/**
 * Keyword search text for a project annotation: its category tag, highlighted text, and
 * note. Every index writer stores exactly this string in `searchableContent`, and the
 * search embedding is computed from it, so a stored index is current only while it still
 * equals the text built from the annotation's current fields.
 */
export function buildAnnotationSearchText(
  highlightedText: string,
  note: string | null | undefined,
  category: string,
  documentContext?: string,
): string {
  return `[${category}] ${highlightedText} ${note || ""} ${documentContext?.slice(0, 100) || ""}`.trim();
}

/** The search text for an annotation as it is now, regardless of what was persisted. */
export function currentAnnotationSearchText(annotation: {
  highlightedText: string;
  note: string | null;
  category: string;
}): string {
  return buildAnnotationSearchText(
    annotation.highlightedText,
    annotation.note,
    annotation.category,
  );
}

/**
 * True when the stored index (and so the embedding built from it) still describes the
 * annotation. Rows edited before edits re-indexed, or whose index write lost a race,
 * return false.
 */
export function isAnnotationSearchIndexCurrent(annotation: {
  highlightedText: string;
  note: string | null;
  category: string;
  searchableContent: string | null;
}): boolean {
  return annotation.searchableContent === currentAnnotationSearchText(annotation);
}
