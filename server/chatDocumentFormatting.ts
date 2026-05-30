function normalizeDocumentTitle(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "Draft";
}

function escapeDocumentTitle(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inferDocumentTitleFromMarkdown(value: string): string {
  const heading = value.match(/^\s{0,3}#{1,2}\s+(.+?)\s*#*\s*$/m);
  if (heading?.[1]) {
    return normalizeDocumentTitle(heading[1].replace(/\*\*/g, "").trim()).slice(0, 140);
  }
  return "Draft";
}

function shouldWrapGeneratedDocument(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 1800 || /<document\b/i.test(trimmed)) {
    return false;
  }

  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount < 300) return false;

  return (
    /^\s{0,3}#{1,3}\s+/m.test(trimmed) ||
    /\[\^\d+\]/.test(trimmed) ||
    /\b(?:introduction|conclusion|bibliography|references)\b/i.test(trimmed)
  );
}

export function wrapGeneratedDocumentIfNeeded(value: string): string {
  if (!shouldWrapGeneratedDocument(value)) return value;
  const title = escapeDocumentTitle(inferDocumentTitleFromMarkdown(value));
  return `<document title="${title}">\n\n${value.trim()}\n\n</document>`;
}
