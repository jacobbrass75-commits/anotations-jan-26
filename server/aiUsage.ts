import { incrementTokenUsage } from "./authStorage";

export type TokenUsageReporter = (tokens: number) => void;

interface ProviderUsage {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
}

export function getProviderUsageTokenTotal(response: { usage?: ProviderUsage | null } | null | undefined): number {
  const usage = response?.usage;
  if (!usage) return 0;

  if (Number.isFinite(usage.total_tokens)) {
    return Math.max(0, Math.floor(Number(usage.total_tokens)));
  }

  const openAiTotal = Number(usage.prompt_tokens || 0) + Number(usage.completion_tokens || 0);
  const anthropicTotal = Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0);
  return Math.max(0, Math.floor(openAiTotal + anthropicTotal));
}

export function reportProviderUsage(
  response: { usage?: ProviderUsage | null } | null | undefined,
  onTokenUsage?: TokenUsageReporter,
): void {
  const tokens = getProviderUsageTokenTotal(response);
  if (tokens > 0) {
    onTokenUsage?.(tokens);
  }
}

export function createTokenUsageAccumulator() {
  let totalTokens = 0;

  return {
    add(tokens: number): void {
      if (!Number.isFinite(tokens) || tokens <= 0) return;
      totalTokens += Math.floor(tokens);
    },
    total(): number {
      return totalTokens;
    },
    async flush(userId: string, source: string): Promise<void> {
      const tokens = totalTokens;
      totalTokens = 0;
      await recordUserTokenUsage(userId, tokens, source);
    },
  };
}

export async function recordUserTokenUsage(userId: string, tokens: number, source: string): Promise<void> {
  if (!Number.isFinite(tokens) || tokens <= 0) return;

  try {
    await incrementTokenUsage(userId, Math.floor(tokens));
  } catch (error) {
    console.warn("[aiUsage] failed to increment token usage", {
      userId,
      source,
      tokens,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
