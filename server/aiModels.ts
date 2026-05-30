function readModelEnv(
  envName: string,
  fallback: string,
  aliases: Record<string, string> = {},
): string {
  const rawValue = process.env[envName]?.trim();
  if (!rawValue) return fallback;
  return aliases[rawValue] || rawValue;
}

export const ANTHROPIC_MODELS = {
  opus: readModelEnv("ANTHROPIC_OPUS_MODEL", "claude-opus-4-1-20250805"),
  sonnet: readModelEnv("ANTHROPIC_SONNET_MODEL", "claude-sonnet-4-20250514"),
  haiku: readModelEnv("ANTHROPIC_HAIKU_MODEL", "claude-3-5-haiku-20241022", {
    "claude-3-haiku-20241022": "claude-3-5-haiku-20241022",
  }),
} as const;
