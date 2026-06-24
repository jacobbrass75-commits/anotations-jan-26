import { describe, expect, it } from "vitest";
import {
  completeWritingStreamSnapshot,
  createEmptyWritingStreamSnapshot,
  createStartingWritingStreamSnapshot,
  getStreamingConversationIds,
  selectWritingStreamSnapshot,
  stopWritingStreamSnapshot,
} from "../../client/src/lib/writingStreamState";

describe("writing stream state", () => {
  it("keeps a background conversation stream from blocking the active conversation", () => {
    const streams = {
      conversationA: createStartingWritingStreamSnapshot(),
    };

    expect(getStreamingConversationIds(streams)).toEqual(["conversationA"]);
    expect(selectWritingStreamSnapshot(streams, "conversationA").isStreaming).toBe(true);
    expect(selectWritingStreamSnapshot(streams, "conversationB")).toEqual(
      createEmptyWritingStreamSnapshot(),
    );
  });

  it("stops an active stream without erasing partial output", () => {
    const stopped = stopWritingStreamSnapshot({
      ...createStartingWritingStreamSnapshot(),
      streamingChatText: "Partial draft",
      streamingText: "Partial draft",
      streamStatus: {
        phase: "drafting",
        message: "Writing the draft...",
        progress: 50,
      },
    });

    expect(stopped.isStreaming).toBe(false);
    expect(stopped.streamingChatText).toBe("Partial draft");
    expect(stopped.streamStatus).toEqual({
      phase: "stopped",
      message: "Stopped.",
      progress: 50,
    });
  });

  it("marks a stream complete while preserving finished document content", () => {
    const completed = completeWritingStreamSnapshot({
      ...createStartingWritingStreamSnapshot(),
      documentTitle: "Essay draft",
      streamingDocumentText: "Final document",
      isDocumentStreaming: true,
      isDocumentComplete: true,
    });

    expect(completed.isStreaming).toBe(false);
    expect(completed.isDocumentStreaming).toBe(false);
    expect(completed.streamingDocumentText).toBe("Final document");
  });
});
