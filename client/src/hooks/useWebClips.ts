import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { WebClip } from "@shared/schema";

export interface WebClipFilters {
  projectId?: string;
  sourceUrl?: string;
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
  sort?: "newest" | "oldest" | "site";
}

function buildQueryString(filters: WebClipFilters = {}): string {
  const params = new URLSearchParams();

  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.sourceUrl) params.set("sourceUrl", filters.sourceUrl);
  if (filters.category) params.set("category", filters.category);
  if (filters.search) params.set("search", filters.search);
  if (typeof filters.limit === "number") params.set("limit", String(filters.limit));
  if (typeof filters.offset === "number") params.set("offset", String(filters.offset));
  if (filters.sort) params.set("sort", filters.sort);

  const query = params.toString();
  return query ? `?${query}` : "";
}

export function useWebClips(filters: WebClipFilters = {}) {
  return useQuery<WebClip[]>({
    queryKey: ["/api/web-clips", filters],
    queryFn: async () => {
      const res = await fetch(`/api/web-clips${buildQueryString(filters)}`);
      if (!res.ok) throw new Error("Failed to fetch web clips");
      return res.json();
    },
  });
}

export function useWebClip(id: string | null) {
  return useQuery<WebClip>({
    queryKey: ["/api/web-clips", id],
    queryFn: async () => {
      const res = await fetch(`/api/web-clips/${id}`);
      if (!res.ok) throw new Error("Failed to fetch web clip");
      return res.json();
    },
    enabled: Boolean(id),
  });
}

export function useCreateWebClip() {
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/web-clips", payload);
      return res.json() as Promise<WebClip>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/web-clips"] });
    },
  });
}

export function useUpdateWebClip() {
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PUT", `/api/web-clips/${id}`, data);
      return res.json() as Promise<WebClip>;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/web-clips"] });
      queryClient.invalidateQueries({ queryKey: ["/api/web-clips", id] });
    },
  });
}

export function useDeleteWebClip() {
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/web-clips/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/web-clips"] });
    },
  });
}

export function usePromoteWebClip() {
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: { projectId: string; projectDocumentId?: string; category?: string; note?: string };
    }) => {
      const res = await apiRequest("POST", `/api/web-clips/${id}/promote`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/web-clips"] });
    },
  });
}
