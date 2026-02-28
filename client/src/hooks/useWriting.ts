import { useState, useCallback, useRef } from "react";

// --- Types ---

export interface WritingRequest {
  topic: string;
  annotationIds: string[];
  sourceDocumentIds?: string[];
  projectId?: string;
  citationStyle: "mla" | "apa" | "chicago";
  tone: "academic" | "casual" | "ap_style";
  targetLength: "short" | "medium" | "long";
  noEnDashes: boolean;
  deepWrite: boolean;
}

export interface WritingPlanSection {
  title: string;
  description: string;
  sourceIds: string[];
  targetWords: number;
}

export interface WritingPlan {
  thesis: string;
  sections: WritingPlanSection[];
  bibliography: string[];
}

export interface WritingSection {
  index: number;
  title: string;
  content: string;
}

export interface SavedPaper {
  documentId: string;
  projectDocumentId: string;
  filename: string;
  savedAt: number;
}

interface SSEEvent {
  type: "status" | "plan" | "section" | "complete" | "error" | "saved";
  phase?: string;
  message?: string;
  plan?: WritingPlan;
  index?: number;
  title?: string;
  content?: string;
  fullText?: string;
  usage?: { inputTokens: number; outputTokens: number };
  error?: string;
  savedPaper?: SavedPaper;
}

export function useWritingPipeline() {
  const [status, setStatus] = useState<string>("");
  const [phase, setPhase] = useState<string>("");
  const [plan, setPlan] = useState<WritingPlan | null>(null);
  const [sections, setSections] = useState<WritingSection[]>([]);
  const [fullText, setFullText] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedPaper, setSavedPaper] = useState<SavedPaper | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setStatus("");
    setPhase("");
    setPlan(null);
    setSections([]);
    setFullText("");
    setIsGenerating(false);
    setError(null);
    setSavedPaper(null);
  }, []);

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
    setStatus("Cancelled");
  }, []);

  const generate = useCallback(async (request: WritingRequest) => {
    // Reset state
    setStatus("Starting...");
    setPhase("");
    setPlan(null);
    setSections([]);
    setFullText("");
    setIsGenerating(true);
    setError(null);
    setSavedPaper(null);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await fetch("/api/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        credentials: "include",
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      // Read SSE stream
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6); // Remove "data: " prefix
          if (data === "[DONE]") {
            setIsGenerating(false);
            return;
          }

          try {
            const event: SSEEvent = JSON.parse(data);

            switch (event.type) {
              case "status":
                setStatus(event.message || "");
                if (event.phase) setPhase(event.phase);
                break;
              case "plan":
                if (event.plan) setPlan(event.plan);
                break;
              case "section":
                if (event.index !== undefined && event.title && event.content) {
                  setSections((prev) => [
                    ...prev,
                    {
                      index: event.index!,
                      title: event.title!,
                      content: event.content!,
                    },
                  ]);
                }
                break;
              case "complete":
                if (event.fullText) setFullText(event.fullText);
                setStatus("Complete");
                setPhase("complete");
                setIsGenerating(false);
                break;
              case "error":
                setError(event.error || "Unknown error");
                setIsGenerating(false);
                break;
              case "saved":
                if (event.savedPaper) {
                  setSavedPaper(event.savedPaper);
                }
                if (event.message) {
                  setStatus(event.message);
                }
                break;
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      setIsGenerating(false);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // User cancelled
        return;
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      setIsGenerating(false);
    } finally {
      abortControllerRef.current = null;
    }
  }, []);

  return {
    generate,
    cancel,
    reset,
    status,
    phase,
    plan,
    sections,
    fullText,
    isGenerating,
    error,
    savedPaper,
  };
}
