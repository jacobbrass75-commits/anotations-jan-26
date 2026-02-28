import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getAuthHeaders } from "@/lib/auth";
import { useProjectDocuments } from "@/hooks/useProjects";
import type { Conversation, Message } from "@shared/schema";

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

// --- Conversation queries (project-scoped) ---

export function useProjectConversations(projectId: string) {
  return useQuery<Conversation[]>({
    queryKey: ["/api/chat/conversations", { projectId }],
    queryFn: async () => {
      const res = await fetch(`/api/chat/conversations?projectId=${projectId}`, {
        headers: { ...getAuthHeaders() },
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!projectId,
  });
}

export function useWritingConversation(id: string | null) {
  return useQuery<ConversationWithMessages>({
    queryKey: ["/api/chat/conversations", id],
    queryFn: async () => {
      const res = await fetch(`/api/chat/conversations/${id}`, {
        headers: { ...getAuthHeaders() },
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!id,
  });
}

export function useCreateWritingConversation() {
  return useMutation({
    mutationFn: async (data: { projectId: string; selectedSourceIds?: string[] }) => {
      const res = await apiRequest("POST", "/api/chat/conversations", {
        projectId: data.projectId,
        selectedSourceIds: data.selectedSourceIds || [],
      });
      return res.json() as Promise<Conversation>;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations", { projectId: variables.projectId }] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    },
  });
}

export function useUpdateWritingConversation() {
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, any> }) => {
      const res = await apiRequest("PUT", `/api/chat/conversations/${id}`, data);
      return res.json() as Promise<Conversation>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    },
  });
}

export function useDeleteWritingConversation() {
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/chat/conversations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    },
  });
}

// --- Source selection ---

export function useUpdateSources() {
  return useMutation({
    mutationFn: async ({ conversationId, selectedSourceIds }: { conversationId: string; selectedSourceIds: string[] }) => {
      const res = await apiRequest("PUT", `/api/chat/conversations/${conversationId}/sources`, { selectedSourceIds });
      return res.json() as Promise<Conversation>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations", data.id] });
    },
  });
}

// --- Send message (SSE streaming) ---

export function useWritingSendMessage(conversationId: string | null) {
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  const send = useCallback(
    async (content: string) => {
      if (!conversationId) return;

      setIsStreaming(true);
      setStreamingText("");

      try {
        const response = await fetch(
          `/api/chat/conversations/${conversationId}/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getAuthHeaders() },
            body: JSON.stringify({ content }),
            credentials: "include",
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === "text") {
                  accumulated += data.text;
                  setStreamingText(accumulated);
                } else if (data.type === "done") {
                  queryClient.invalidateQueries({
                    queryKey: ["/api/chat/conversations", conversationId],
                  });
                  queryClient.invalidateQueries({
                    queryKey: ["/api/chat/conversations"],
                  });
                } else if (data.type === "error") {
                  console.error("Stream error:", data.error);
                }
              } catch {
                // Ignore malformed SSE
              }
            }
          }
        }
      } catch (error) {
        console.error("Send message error:", error);
      } finally {
        setIsStreaming(false);
        setStreamingText("");
      }
    },
    [conversationId]
  );

  return { send, streamingText, isStreaming };
}

// --- Compile paper ---

export function useCompilePaper(conversationId: string | null) {
  const [compiledContent, setCompiledContent] = useState("");
  const [isCompiling, setIsCompiling] = useState(false);
  const [savedPaper, setSavedPaper] = useState<{ documentId: string; filename: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const compile = useCallback(
    async (options?: { citationStyle?: string; tone?: string; noEnDashes?: boolean }) => {
      if (!conversationId) return;

      setIsCompiling(true);
      setCompiledContent("");
      setSavedPaper(null);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch(
          `/api/chat/conversations/${conversationId}/compile`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getAuthHeaders() },
            body: JSON.stringify(options || {}),
            credentials: "include",
            signal: controller.signal,
          }
        );

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === "text") {
                  accumulated += data.text;
                  setCompiledContent(accumulated);
                } else if (data.type === "done") {
                  if (data.savedPaper) {
                    setSavedPaper(data.savedPaper);
                  }
                } else if (data.type === "error") {
                  console.error("Compile error:", data.error);
                }
              } catch {
                // Ignore malformed SSE
              }
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") {
          console.error("Compile error:", error);
        }
      } finally {
        setIsCompiling(false);
        abortRef.current = null;
      }
    },
    [conversationId]
  );

  const cancelCompile = useCallback(() => {
    abortRef.current?.abort();
    setIsCompiling(false);
  }, []);

  const clearCompiled = useCallback(() => {
    setCompiledContent("");
    setSavedPaper(null);
  }, []);

  return { compile, cancelCompile, clearCompiled, compiledContent, isCompiling, savedPaper };
}

// --- Verify paper ---

export function useVerifyPaper(conversationId: string | null) {
  const [verifyReport, setVerifyReport] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  const verify = useCallback(
    async (compiledContent: string) => {
      if (!conversationId || !compiledContent) return;

      setIsVerifying(true);
      setVerifyReport("");

      try {
        const response = await fetch(
          `/api/chat/conversations/${conversationId}/verify`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getAuthHeaders() },
            body: JSON.stringify({ compiledContent }),
            credentials: "include",
          }
        );

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === "text") {
                  accumulated += data.text;
                  setVerifyReport(accumulated);
                } else if (data.type === "error") {
                  console.error("Verify error:", data.error);
                }
              } catch {
                // Ignore
              }
            }
          }
        }
      } catch (error) {
        console.error("Verify error:", error);
      } finally {
        setIsVerifying(false);
      }
    },
    [conversationId]
  );

  return { verify, verifyReport, isVerifying };
}
