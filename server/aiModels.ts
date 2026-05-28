export const ANTHROPIC_MODELS = {
  opus: process.env.ANTHROPIC_OPUS_MODEL || "claude-opus-4-1-20250805",
  sonnet: process.env.ANTHROPIC_SONNET_MODEL || "claude-sonnet-4-20250514",
  haiku: process.env.ANTHROPIC_HAIKU_MODEL || "claude-3-5-haiku-20241022",
} as const;

