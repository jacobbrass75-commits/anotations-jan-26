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
  fable: readModelEnv("ANTHROPIC_FABLE_MODEL", "claude-fable-5"),
  opus: readModelEnv("ANTHROPIC_OPUS_MODEL", "claude-opus-4-6", {
    "claude-opus-4-1-20250805": "claude-opus-4-6",
    "claude-opus-4-20250514": "claude-opus-4-6",
  }),
  sonnet: readModelEnv("ANTHROPIC_SONNET_MODEL", "claude-sonnet-4-6", {
    "claude-sonnet-4-20250514": "claude-sonnet-4-6",
    "claude-sonnet-4-5-20250929": "claude-sonnet-4-6",
  }),
  haiku: readModelEnv("ANTHROPIC_HAIKU_MODEL", "claude-haiku-4-5-20251001", {
    "claude-3-haiku-20241022": "claude-haiku-4-5-20251001",
    "claude-3-5-haiku-20241022": "claude-haiku-4-5-20251001",
  }),
} as const;
