import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getAuthHeaders } from "@/lib/auth";
import type { Project, Folder, ProjectDocument, ProjectAnnotation, InsertProject, InsertFolder, InsertProjectDocument, InsertProjectAnnotation, CitationData, SearchResult, PromptTemplate } from "@shared/schema";

export function useProjects() {
  return useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });
}

export function useProject(id: string) {
  return useQuery<Project>({
    queryKey: ["/api/projects", id],
    enabled: !!id,
  });
}

export function useCreateProject() {
  return useMutation({
    mutationFn: async (data: InsertProject) => {
      const res = await apiRequest("POST", "/api/projects", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
    },
  });
}

export function useUpdateProject() {
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertProject> }) => {
      const res = await apiRequest("PUT", `/api/projects/${id}`, data);
      return res.json();
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id] });
    },
  });
}

export function useDeleteProject() {
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/projects/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
    },
  });
}

export function useFolders(projectId: string) {
  return useQuery<Folder[]>({
    queryKey: ["/api/projects", projectId, "folders"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/folders`, {
        headers: { ...getAuthHeaders() },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch folders");
      return res.json();
    },
    enabled: !!projectId,
  });
}

export function useCreateFolder() {
  return useMutation({
    mutationFn: async ({ projectId, data }: { projectId: string; data: Omit<InsertFolder, "projectId"> }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/folders`, data);
      return res.json();
    },
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "folders"] });
    },
  });
}

export function useDeleteFolder() {
  return useMutation({
    mutationFn: async ({ id, projectId }: { id: string; projectId: string }) => {
      await apiRequest("DELETE", `/api/folders/${id}`);
      return projectId;
    },
    onSuccess: (projectId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "folders"] });
    },
  });
}

export function useProjectDocuments(projectId: string) {
  return useQuery<(ProjectDocument & { document: { id: string; filename: string; summary: string | null } })[]>({
    queryKey: ["/api/projects", projectId, "documents"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/documents`, {
        headers: { ...getAuthHeaders() },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch project documents");
      return res.json();
    },
    enabled: !!projectId,
  });
}

export function useAddDocumentToProject() {
  return useMutation({
    mutationFn: async ({ projectId, data }: { projectId: string; data: Omit<InsertProjectDocument, "projectId"> }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/documents`, data);
      return res.json();
    },
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "documents"] });
    },
  });
}

export function useRemoveDocumentFromProject() {
  return useMutation({
    mutationFn: async ({ id, projectId }: { id: string; projectId: string }) => {
      await apiRequest("DELETE", `/api/project-documents/${id}`);
      return projectId;
    },
    onSuccess: (projectId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "documents"] });
    },
  });
}

export function useUpdateProjectDocument() {
  return useMutation({
    mutationFn: async ({ id, projectId, data }: { id: string; projectId: string; data: Partial<{ projectContext: string; roleInProject: string; citationData: CitationData; folderId: string | null }> }) => {
      const res = await apiRequest("PUT", `/api/project-documents/${id}`, data);
      return { result: await res.json(), projectId };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", result.projectId, "documents"] });
    },
  });
}

export function useProjectAnnotations(projectDocumentId: string) {
  return useQuery<ProjectAnnotation[]>({
    queryKey: ["/api/project-documents", projectDocumentId, "annotations"],
    queryFn: async () => {
      const res = await fetch(`/api/project-documents/${projectDocumentId}/annotations`, {
        headers: { ...getAuthHeaders() },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch annotations");
      return res.json();
    },
    enabled: !!projectDocumentId,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useCreateProjectAnnotation() {
  return useMutation({
    mutationFn: async ({ projectDocumentId, data }: { projectDocumentId: string; data: Omit<InsertProjectAnnotation, "projectDocumentId"> }) => {
      const res = await apiRequest("POST", `/api/project-documents/${projectDocumentId}/annotations`, data);
      return res.json();
    },
    onSuccess: (_, { projectDocumentId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/project-documents", projectDocumentId, "annotations"] });
    },
  });
}

export function useDeleteProjectAnnotation() {
  return useMutation({
    mutationFn: async ({ id, projectDocumentId }: { id: string; projectDocumentId: string }) => {
      await apiRequest("DELETE", `/api/project-annotations/${id}`);
      return projectDocumentId;
    },
    onSuccess: (projectDocumentId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/project-documents", projectDocumentId, "annotations"] });
    },
  });
}

export function useAnalyzeProjectDocument() {
  return useMutation({
    mutationFn: async ({
      projectDocumentId,
      intent,
      thoroughness = 'standard'
    }: {
      projectDocumentId: string;
      intent: string;
      thoroughness?: 'quick' | 'standard' | 'thorough' | 'exhaustive';
    }) => {
      const res = await apiRequest("POST", `/api/project-documents/${projectDocumentId}/analyze`, {
        intent,
        thoroughness
      });
      const data = await res.json();
      return { ...data, projectDocumentId };
    },
    onSuccess: ({ projectDocumentId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/project-documents", projectDocumentId, "annotations"] });
    },
  });
}

export function useSearchProjectDocument() {
  return useMutation({
    mutationFn: async ({
      projectDocumentId,
      query,
    }: {
      projectDocumentId: string;
      query: string;
    }): Promise<SearchResult[]> => {
      const res = await apiRequest("POST", `/api/project-documents/${projectDocumentId}/search`, { query });
      return res.json();
    },
  });
}

export function useBatchAnalyze() {
  return useMutation({
    mutationFn: async ({
      projectId,
      projectDocumentIds,
      intent,
      thoroughness = 'standard',
      constraints,
    }: {
      projectId: string;
      projectDocumentIds: string[];
      intent: string;
      thoroughness?: 'quick' | 'standard' | 'thorough' | 'exhaustive';
      constraints?: {
        categories?: string[];
        maxAnnotationsPerDoc?: number;
        minConfidence?: number;
      };
    }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/batch-analyze`, {
        projectDocumentIds,
        intent,
        thoroughness,
        constraints,
      });
      return res.json();
    },
    onSuccess: (data, { projectDocumentIds }) => {
      projectDocumentIds.forEach(id => {
        queryClient.invalidateQueries({
          queryKey: ["/api/project-documents", id, "annotations"]
        });
      });
    },
  });
}

export function useBatchAddDocuments() {
  return useMutation({
    mutationFn: async ({
      projectId,
      documentIds,
      folderId,
    }: {
      projectId: string;
      documentIds: string[];
      folderId?: string | null;
    }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/documents/batch`, {
        documentIds,
        folderId,
      });
      return res.json();
    },
    onSuccess: (data, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "documents"] });
    },
  });
}

// Multi-prompt analysis
export function useAnalyzeMultiPrompt() {
  return useMutation({
    mutationFn: async ({
      projectDocumentId,
      prompts,
      thoroughness = "standard",
    }: {
      projectDocumentId: string;
      prompts: Array<{ text: string; color: string }>;
      thoroughness?: "quick" | "standard" | "thorough" | "exhaustive";
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/project-documents/${projectDocumentId}/analyze-multi`,
        { prompts, thoroughness }
      );
      const data = await res.json();
      return { ...data, projectDocumentId };
    },
    onSuccess: ({ projectDocumentId }) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/project-documents", projectDocumentId, "annotations"],
      });
    },
  });
}

// Prompt Templates
export function usePromptTemplates(projectId: string) {
  return useQuery<PromptTemplate[]>({
    queryKey: ["/api/projects", projectId, "prompt-templates"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/prompt-templates`, {
        headers: { ...getAuthHeaders() },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch prompt templates");
      return res.json();
    },
    enabled: !!projectId,
  });
}

export function useCreatePromptTemplate() {
  return useMutation({
    mutationFn: async ({
      projectId,
      name,
      prompts,
    }: {
      projectId: string;
      name: string;
      prompts: Array<{ text: string; color: string }>;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/projects/${projectId}/prompt-templates`,
        { name, prompts }
      );
      return res.json();
    },
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/projects", projectId, "prompt-templates"],
      });
    },
  });
}

export function useDeletePromptTemplate() {
  return useMutation({
    mutationFn: async ({ id, projectId }: { id: string; projectId: string }) => {
      await apiRequest("DELETE", `/api/prompt-templates/${id}`);
      return projectId;
    },
    onSuccess: (projectId) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/projects", projectId, "prompt-templates"],
      });
    },
  });
}
