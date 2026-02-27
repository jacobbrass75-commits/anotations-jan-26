import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { GlobalSearchResult, AnnotationCategory, CitationData, CitationStyle } from "@shared/schema";

interface SearchFilters {
  categories?: AnnotationCategory[];
  folderIds?: string[];
  documentIds?: string[];
}

interface SearchResponse {
  results: GlobalSearchResult[];
  totalResults: number;
  searchTime: number;
}

interface CitationResponse {
  footnote: string;
  bibliography: string;
  inlineCitation?: string;
  style?: CitationStyle;
}

export function useGlobalSearch() {
  return useMutation({
    mutationFn: async ({ projectId, query, filters, limit }: {
      projectId: string;
      query: string;
      filters?: SearchFilters;
      limit?: number
    }): Promise<SearchResponse> => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/search`, { query, filters, limit });
      return res.json();
    },
  });
}

export function useGenerateCitation() {
  return useMutation({
    mutationFn: async ({ citationData, style = "chicago", pageNumber, isSubsequent }: {
      citationData: CitationData;
      style?: CitationStyle;
      pageNumber?: string;
      isSubsequent?: boolean
    }): Promise<CitationResponse> => {
      const res = await apiRequest("POST", "/api/citations/generate", { citationData, style, pageNumber, isSubsequent });
      return res.json();
    },
  });
}
