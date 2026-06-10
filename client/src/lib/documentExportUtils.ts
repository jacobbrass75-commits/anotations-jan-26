export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[>*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function toSafeFilename(value: string): string {
  return (
    value
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "generated-paper"
  );
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toPdfSafeText(value: string): string {
  return (
    value
      .replace(/\u00a0/g, " ")
      .replace(/[\u2000-\u200a\u202f\u205f\u3000]/g, " ")
      .replace(/[\u200b-\u200f\u2060\ufeff]/g, "")
      .replace(/[\u2010-\u2015\u2212]/g, "-")
      .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
      .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
      .replace(/\u2026/g, "...")
      .replace(/\u00ad/g, "")
      .replace(/\u2192/g, "->")
      .replace(/\u2190/g, "<-")
      .replace(/\u2264/g, "<=")
      .replace(/\u2265/g, ">=")
      .replace(/\u2260/g, "!=")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      // TODO(lint): Keep ASCII tab/newline/carriage-return while replacing other controls.
      // eslint-disable-next-line no-control-regex
      .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "?")
  );
}

export function getDocTypeLabel(filename: string): string {
  const name = filename.toLowerCase();
  if (name.endsWith(".pdf")) return "PDF";
  if (name.endsWith(".txt")) return "TXT";
  if (/\.(png|jpg|jpeg|webp|gif|bmp|tif|tiff|heic|heif)$/i.test(name)) return "IMAGE";
  return "DOC";
}
