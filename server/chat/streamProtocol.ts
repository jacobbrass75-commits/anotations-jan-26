export const TOOL_REQUEST_REGEX = /<(chunk_request|context_request)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
const STREAM_TAG_PREFIXES = [
  "<document",
  "</document",
  "<chunk_request",
  "</chunk_request",
  "<context_request",
  "</context_request",
];

export type ToolRequestType = "chunk_request" | "context_request";
export type WritingStreamEventType =
  | "chat_text"
  | "document_start"
  | "document_text"
  | "document_end"
  | "writing_status"
  | "done"
  | "error";

export interface ToolRequest {
  type: ToolRequestType;
  annotationId?: string;
  documentId: string;
  reason: string;
  rawTag: string;
}

export interface StreamTurnResult {
  fullText: string;
  usage: { input_tokens?: number; output_tokens?: number };
  toolRequests: ToolRequest[];
  stopReason?: string | null;
}

function normalizeTitle(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "Draft";
}

function matchOpenDocumentTag(tagText: string): string | null {
  const match = tagText.match(/^<document\s+title="([^"]*)"\s*>$/i);
  if (!match) return null;
  return normalizeTitle(match[1] || "");
}

function isCloseDocumentTag(tagText: string): boolean {
  return /^<\/document\s*>$/i.test(tagText);
}

function matchOpenToolTag(tagText: string): ToolRequestType | null {
  if (/^<chunk_request\b[^>]*>$/i.test(tagText)) return "chunk_request";
  if (/^<context_request\b[^>]*>$/i.test(tagText)) return "context_request";
  return null;
}

function isCloseToolTag(tagText: string, type: ToolRequestType): boolean {
  return new RegExp(`^<\\/${type}\\s*>$`, "i").test(tagText);
}

function looksLikeKnownTagPrefix(value: string): boolean {
  const lower = value.toLowerCase();
  return STREAM_TAG_PREFIXES.some((prefix) => prefix.startsWith(lower));
}

export function createDocumentStreamParser(
  emit: (event: { type: WritingStreamEventType; [key: string]: unknown }) => void,
) {
  let inDocument = false;
  let activeToolTag: ToolRequestType | null = null;
  let tagMode = false;
  let tagBuffer = "";
  let chatBuffer = "";
  let documentBuffer = "";
  let activeDocumentTitle = "";

  const flushChat = () => {
    if (!chatBuffer) return;
    emit({ type: "chat_text", text: chatBuffer });
    chatBuffer = "";
  };

  const flushDocument = () => {
    if (!documentBuffer) return;
    emit({ type: "document_text", text: documentBuffer });
    documentBuffer = "";
  };

  const appendVisible = (text: string) => {
    if (!text || activeToolTag) return;
    if (inDocument) {
      documentBuffer += text;
      return;
    }
    chatBuffer += text;
  };

  const processCompletedTag = (tagText: string) => {
    const openToolTag = matchOpenToolTag(tagText);
    if (!activeToolTag && openToolTag) {
      if (inDocument) {
        flushDocument();
      } else {
        flushChat();
      }
      activeToolTag = openToolTag;
      return;
    }

    if (activeToolTag) {
      if (isCloseToolTag(tagText, activeToolTag)) {
        activeToolTag = null;
      }
      return;
    }

    const openTitle = matchOpenDocumentTag(tagText);
    if (!inDocument && openTitle) {
      flushChat();
      activeDocumentTitle = openTitle;
      emit({ type: "document_start", title: activeDocumentTitle });
      inDocument = true;
      return;
    }

    if (inDocument && isCloseDocumentTag(tagText)) {
      flushDocument();
      emit({ type: "document_end", title: activeDocumentTitle || "Draft" });
      activeDocumentTitle = "";
      inDocument = false;
      return;
    }

    appendVisible(tagText);
  };

  const pushText = (chunk: string) => {
    for (const ch of chunk) {
      if (!tagMode) {
        if (ch === "<") {
          tagMode = true;
          tagBuffer = "<";
        } else {
          appendVisible(ch);
        }
        continue;
      }

      tagBuffer += ch;
      if (ch === ">") {
        processCompletedTag(tagBuffer);
        tagBuffer = "";
        tagMode = false;
        continue;
      }

      if (tagBuffer.length > 220 || !looksLikeKnownTagPrefix(tagBuffer)) {
        appendVisible(tagBuffer);
        tagBuffer = "";
        tagMode = false;
      }
    }
  };

  const finish = (options: { finalizeDocument?: boolean } = {}) => {
    const finalizeDocument = options.finalizeDocument ?? true;

    if (tagMode && tagBuffer) {
      appendVisible(tagBuffer);
      tagBuffer = "";
      tagMode = false;
    }

    flushChat();
    flushDocument();

    if (inDocument) {
      if (finalizeDocument) {
        emit({ type: "document_end", title: activeDocumentTitle || "Draft" });
      }
      inDocument = false;
      activeDocumentTitle = "";
    }

    activeToolTag = null;
  };

  return { pushText, finish };
}

function parseToolRequestAttributes(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z_]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(attrText)) !== null) {
    attrs[match[1].toLowerCase()] = match[2];
  }

  return attrs;
}

export function extractToolRequestsFromText(text: string): ToolRequest[] {
  const requests: ToolRequest[] = [];
  let match: RegExpExecArray | null;

  while ((match = TOOL_REQUEST_REGEX.exec(text)) !== null) {
    const type = String(match[1] || "").toLowerCase() as ToolRequestType;
    if (type !== "chunk_request" && type !== "context_request") continue;

    const attrs = parseToolRequestAttributes(match[2] || "");
    const documentId = attrs.document_id?.trim();
    if (!documentId) continue;

    const reason = (match[3] || "").trim();
    const annotationId = attrs.annotation_id?.trim();

    requests.push({
      type,
      annotationId: annotationId || undefined,
      documentId,
      reason,
      rawTag: match[0],
    });
  }

  return requests;
}

export function createToolRequestParser(onToolRequest: (request: ToolRequest) => void) {
  let buffer = "";

  const pushText = (chunk: string) => {
    buffer += chunk;
  };

  const finish = () => {
    const requests = extractToolRequestsFromText(buffer);
    for (const request of requests) {
      onToolRequest(request);
    }
    buffer = "";
  };

  return { pushText, finish };
}
