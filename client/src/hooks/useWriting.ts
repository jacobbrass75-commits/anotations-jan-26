import { useState, useCallback, useRef } from "react";
import { getAuthHeaders } from "@/lib/auth";

// --- Types ---

export interface WritingRequest {
  topic: string;
  annotationIds: string[];
  sourceDocumentIds?: string[];
  projectId?: string;
  writingStyleId?: string | null;
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

function sanitizeWritingError(value: unknown, fallback = "Writing generation failed"): string {
  const raw = String(value || "").trim();
  const text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return fallback;
  if (/cloudflare|gateway timeout|error code: 52[024]|504|524/i.test(text)) {
    return "The writing request timed out before the final response arrived. Any completed sections were kept when available.";
  }
  return text.slice(0, 500);
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
    let completeReceived = false;
    let receivedSections: WritingSection[] = [];

    const recoverPartial = () => {
      if (completeReceived || receivedSections.length === 0) return false;
      const partial = [...receivedSections]
        .sort((a, b) => a.index - b.index)
        .map((section) => section.content.trim())
        .filter(Boolean)
        .join("\n\n");

      if (!partial) return false;
      setFullText(partial);
      setPhase("partial");
      setStatus("Partial draft recovered. Final polish did not complete.");
      return true;
    };

    try {
      const response = await fetch("/api/write", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(request),
        credentials: "include",
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        let message = errorText || response.statusText || `HTTP ${response.status}`;
        try {
          const parsed = JSON.parse(errorText);
          message = String(parsed.error || parsed.message || message);
        } catch {
          // Non-JSON errors, including proxy HTML pages, are sanitized below.
        }
        throw new Error(sanitizeWritingError(message, `HTTP ${response.status}`));
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
            recoverPartial();
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
                  const nextSection = {
                    index: event.index!,
                    title: event.title!,
                    content: event.content!,
                  };
                  receivedSections = [
                    ...receivedSections.filter((section) => section.index !== nextSection.index),
                    nextSection,
                  ];
                  setSections((prev) => [
                    ...prev.filter((section) => section.index !== nextSection.index),
                    nextSection,
                  ]);
                }
                break;
              case "complete":
                if (event.fullText) {
                  completeReceived = true;
                  setFullText(event.fullText);
                }
                setStatus("Complete");
                setPhase("complete");
                setIsGenerating(false);
                break;
              case "error":
                if (recoverPartial()) {
                  setError(null);
                } else {
                  setError(sanitizeWritingError(event.error || "Unknown error"));
                }
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

      recoverPartial();
      setIsGenerating(false);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // User cancelled
        return;
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      if (recoverPartial()) {
        setError(null);
      } else {
        setError(sanitizeWritingError(message));
      }
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
