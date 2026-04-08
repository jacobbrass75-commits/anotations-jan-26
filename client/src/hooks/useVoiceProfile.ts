import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";

export interface VoiceProfile {
  avgSentenceLength: string;
  vocabularyLevel: "academic" | "conversational" | "mixed";
  paragraphStructure: string;
  toneMarkers: string[];
  commonTransitions: string[];
  evidenceIntroduction: string;
  argumentStructure: string;
  hedgingStyle: string;
  openingPattern: string;
  closingPattern: string;
  distinctivePhrases: string[];
  avoidedPatterns: string[];
  voiceSummary: string;
}

export function useVoiceProfile(projectId: string) {
  return useQuery<{ voiceProfile: VoiceProfile | null; hasSamples: boolean }>({
    queryKey: ["/api/projects", projectId, "voice-profile"],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/projects/${projectId}/voice-profile`);
      return res.json();
    },
  });
}

export function useAnalyzeVoiceProfile() {
  return useMutation({
    mutationFn: async ({ projectId, samples }: { projectId: string; samples: string[] }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/voice-profile/analyze`, { samples });
      return res.json() as Promise<{ voiceProfile: VoiceProfile }>;
    },
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "voice-profile"] });
    },
  });
}

export function useUpdateVoiceProfile() {
  return useMutation({
    mutationFn: async ({ projectId, voiceProfile }: { projectId: string; voiceProfile: VoiceProfile }) => {
      const res = await apiRequest("PUT", `/api/projects/${projectId}/voice-profile`, { voiceProfile });
      return res.json();
    },
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "voice-profile"] });
    },
  });
}

export function useDeleteVoiceProfile() {
  return useMutation({
    mutationFn: async (projectId: string) => {
      await apiRequest("DELETE", `/api/projects/${projectId}/voice-profile`);
    },
    onSuccess: (_, projectId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "voice-profile"] });
    },
  });
}
