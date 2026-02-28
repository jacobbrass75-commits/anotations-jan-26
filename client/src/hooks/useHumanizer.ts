import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface HumanizeRequest {
  text: string;
  model?: string;
  temperature?: number;
}

interface HumanizeResponse {
  humanizedText: string;
  provider: "gemini" | "anthropic";
  model: string;
  tokensUsed?: number;
}

export function useHumanizeText() {
  return useMutation({
    mutationFn: async ({ text, model, temperature }: HumanizeRequest): Promise<HumanizeResponse> => {
      const response = await apiRequest("POST", "/api/humanize", { text, model, temperature });
      return response.json();
    },
  });
}
