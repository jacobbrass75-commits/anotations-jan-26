export interface WritingStreamStatus {
  phase: string;
  message: string;
  progress?: number;
}

export interface WritingStreamSnapshot {
  streamingText: string;
  streamingChatText: string;
  documentTitle: string;
  streamingDocumentText: string;
  isDocumentStreaming: boolean;
  isDocumentComplete: boolean;
  isStreaming: boolean;
  contextLoading: {
    level: number;
    documentId?: string;
  } | null;
  contextWarning: {
    id: number;
    message: string;
    available?: number;
  } | null;
  streamError: {
    id: number;
    message: string;
  } | null;
  streamStatus: WritingStreamStatus | null;
}

export function createEmptyWritingStreamSnapshot(): WritingStreamSnapshot {
  return {
    streamingText: "",
    streamingChatText: "",
    documentTitle: "",
    streamingDocumentText: "",
    isDocumentStreaming: false,
    isDocumentComplete: false,
    isStreaming: false,
    contextLoading: null,
    contextWarning: null,
    streamError: null,
    streamStatus: null,
  };
}

export function createStartingWritingStreamSnapshot(): WritingStreamSnapshot {
  return {
    ...createEmptyWritingStreamSnapshot(),
    isStreaming: true,
    streamStatus: {
      phase: "starting",
      message: "Starting writing request...",
      progress: 2,
    },
  };
}

export function completeWritingStreamSnapshot(
  snapshot: WritingStreamSnapshot,
): WritingStreamSnapshot {
  return {
    ...snapshot,
    isStreaming: false,
    isDocumentStreaming: false,
    contextLoading: null,
  };
}

export function stopWritingStreamSnapshot(snapshot: WritingStreamSnapshot): WritingStreamSnapshot {
  return {
    ...completeWritingStreamSnapshot(snapshot),
    isDocumentComplete: false,
    streamError: null,
    streamStatus: {
      phase: "stopped",
      message: "Stopped.",
      progress: snapshot.streamStatus?.progress,
    },
  };
}

export function selectWritingStreamSnapshot(
  streams: Record<string, WritingStreamSnapshot>,
  activeConversationId: string | null,
): WritingStreamSnapshot {
  if (!activeConversationId) return createEmptyWritingStreamSnapshot();
  return streams[activeConversationId] ?? createEmptyWritingStreamSnapshot();
}

export function getStreamingConversationIds(
  streams: Record<string, WritingStreamSnapshot>,
): string[] {
  return Object.entries(streams)
    .filter(([, snapshot]) => snapshot.isStreaming)
    .map(([conversationId]) => conversationId);
}
