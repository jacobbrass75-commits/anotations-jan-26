import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { getAuthHeaders } from "@/lib/auth";
import type { Document, Annotation, SearchResult, AnnotationCategory, InsertAnnotation } from "@shared/schema";

export function useDocuments() {
  return useQuery<Document[]>({
    queryKey: ["/api/documents"],
  });
}

export function useDocument(id: string | null) {
  return useQuery<Document>({
    queryKey: ["/api/documents", id],
    enabled: !!id,
  });
}

export interface DocumentStatus {
  id: string;
  status: string;
  processingError: string | null;
  filename: string;
  chunkCount: number;
}

export interface DocumentSourceMeta {
  documentId: string;
  filename: string;
  available: boolean;
  mimeType: string;
  sourceUrl: string | null;
}

export function useDocumentStatus(id: string | null) {
  return useQuery<DocumentStatus>({
    queryKey: ["/api/documents", id, "status"],
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && (data.status === "ready" || data.status === "error")) {
        return false;
      }
      return 2000;
    },
    staleTime: 0,
  });
}

export function useDocumentSourceMeta(id: string | null) {
  return useQuery<DocumentSourceMeta>({
    queryKey: ["/api/documents", id, "source-meta"],
    enabled: !!id,
  });
}

export function useAnnotations(documentId: string | null) {
  return useQuery<Annotation[]>({
    queryKey: ["/api/documents", documentId, "annotations"],
    enabled: !!documentId,
  });
}

export function useUploadDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      file,
      ocrMode,
      ocrModel,
    }: {
      file: File;
      ocrMode: string;
      ocrModel?: string;
    }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("ocrMode", ocrMode);
      if (ocrModel) {
        formData.append("ocrModel", ocrModel);
      }

      const response = await fetch("/api/upload", {
        method: "POST",
        headers: { ...getAuthHeaders() },
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Upload failed");
      }

      return response.json() as Promise<Document>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents/meta"] });
    },
  });
}

export function useUploadDocumentGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      files,
      ocrMode,
      ocrModel,
    }: {
      files: File[];
      ocrMode: string;
      ocrModel?: string;
    }) => {
      const formData = new FormData();
      for (const file of files) {
        formData.append("files", file);
      }
      formData.append("ocrMode", ocrMode);
      if (ocrModel) {
        formData.append("ocrModel", ocrModel);
      }

      const response = await fetch("/api/upload-group", {
        method: "POST",
        headers: { ...getAuthHeaders() },
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error((error as any)?.message || "Upload failed");
      }

      return response.json() as Promise<Document>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents/meta"] });
    },
  });
}

export function useSetIntent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      documentId,
      intent,
      thoroughness = 'standard'
    }: {
      documentId: string;
      intent: string;
      thoroughness?: 'quick' | 'standard' | 'thorough' | 'exhaustive';
    }) => {
      return apiRequest("POST", `/api/documents/${documentId}/set-intent`, { intent, thoroughness });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents", variables.documentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents", variables.documentId, "annotations"] });
    },
  });
}

export function useAddAnnotation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (annotation: InsertAnnotation) => {
      return apiRequest("POST", `/api/documents/${annotation.documentId}/annotate`, annotation);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents", variables.documentId, "annotations"] });
    },
  });
}

export function useUpdateAnnotation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      annotationId,
      documentId,
      note,
      category,
    }: {
      annotationId: string;
      documentId: string;
      note: string;
      category: AnnotationCategory;
    }) => {
      return apiRequest("PUT", `/api/annotations/${annotationId}`, { note, category });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents", variables.documentId, "annotations"] });
    },
  });
}

export function useDeleteAnnotation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ annotationId, documentId }: { annotationId: string; documentId: string }) => {
      return apiRequest("DELETE", `/api/annotations/${annotationId}`);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents", variables.documentId, "annotations"] });
    },
  });
}

export function useSearchDocument() {
  return useMutation({
    mutationFn: async ({ documentId, query }: { documentId: string; query: string }) => {
      const response = await apiRequest("POST", `/api/documents/${documentId}/search`, { query });
      return response.json() as Promise<SearchResult[]>;
    },
  });
}
