import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { VoiceProfile } from "@shared/schema";

export interface WritingStyle {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  voiceProfile: VoiceProfile | null;
  samples: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WritingStyleInput {
  name: string;
  description?: string | null;
  samples: string[];
}

export function useWritingStyles() {
  return useQuery<WritingStyle[]>({
    queryKey: ["/api/writing-styles"],
  });
}

export function useCreateWritingStyle() {
  return useMutation({
    mutationFn: async (data: WritingStyleInput) => {
      const res = await apiRequest("POST", "/api/writing-styles", data);
      return res.json() as Promise<WritingStyle>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/writing-styles"] });
    },
  });
}

export function useUpdateWritingStyle() {
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<WritingStyleInput> & {
        voiceProfile?: VoiceProfile;
        reanalyze?: boolean;
      };
    }) => {
      const res = await apiRequest("PUT", `/api/writing-styles/${id}`, data);
      return res.json() as Promise<WritingStyle>;
    },
    onSuccess: (style) => {
      queryClient.invalidateQueries({ queryKey: ["/api/writing-styles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/writing-styles", style.id] });
    },
  });
}

export function useDeleteWritingStyle() {
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/writing-styles/${id}`);
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/writing-styles"] });
    },
  });
}
