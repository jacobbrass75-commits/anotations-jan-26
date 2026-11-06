import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "fs/promises";
import { join } from "path";
import { createLogger } from "./logger";
import type { WritingModelChoice } from "./planLimits";
import { anthropicModelForChoice, parseWritingModelChoice } from "./writingModelChoice";

const logger = createLogger("humanizer");

export interface HumanizeOptions {
  /** An entitlement-checked in-app choice. When set, the request runs on that Claude model. */
  model?: WritingModelChoice;
  /** Applies to the Gemini path only; Claude 5.5 models reject sampling parameters. */
  temperature?: number;
}

export interface HumanizeResult {
  humanizedText: string;
  provider: "gemini" | "anthropic";
  model: string;
  tokensUsed?: number;
  inputTokens?: number;
  outputTokens?: number;
}

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_TEMPERATURE = 0.7;
const MAX_ANTHROPIC_TOKENS = 4096;
const PROMPT_FILE_PATH = join(process.cwd(), "prompts", "humanizer.txt");
const FALLBACK_PROMPT = `System: You rewrite content to sound more human and natural.

Rules:
1. Use simple, everyday language. Avoid jargon.
2. Replace formal transitions with basic connectors like but, so, and, also.
3. Keep each sentence focused on a single idea.
4. Mix short and moderate sentence lengths for natural rhythm.
5. Use active voice throughout.
6. Never use colons or semicolons.
7. Never use dashes.
8. Do not use rhetorical questions or what-if phrasing.
9. Use natural phrasing for examples instead of formal list language.
10. Add occasional minor grammar quirks so the writing feels human.
11. Vary sentence lengths noticeably across the full response.
12. Return only the rewritten text.`;

export const MAX_HUMANIZER_TEXT_LENGTH = 50_000;

let cachedPromptTemplate: string | null = null;

function normalizeTemperature(value?: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TEMPERATURE;
  const safeValue = Number(value);
  if (safeValue < 0) return 0;
  if (safeValue > 1) return 1;
  return safeValue;
}

async function loadPromptTemplate(): Promise<string> {
  if (cachedPromptTemplate) {
    return cachedPromptTemplate;
  }

  try {
    const file = await readFile(PROMPT_FILE_PATH, "utf-8");
    const trimmed = file.trim();
    cachedPromptTemplate = trimmed.length > 0 ? trimmed : FALLBACK_PROMPT;
  } catch (error) {
    logger.warn("[Humanizer] Prompt file missing, using fallback template");
    cachedPromptTemplate = FALLBACK_PROMPT;
  }

  return cachedPromptTemplate;
}

function buildUserPrompt(template: string, text: string): string {
  return `${template}

Text to rewrite:
"""
${text}
"""`;
}

async function humanizeWithGemini(
  text: string,
  promptTemplate: string,
  options: HumanizeOptions,
): Promise<HumanizeResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  // Gemini is a backend humanizer provider, not an end-user model choice.
  const model = process.env.GEMINI_HUMANIZER_MODEL || DEFAULT_GEMINI_MODEL;
  const temperature = normalizeTemperature(options.temperature);
  const userPrompt = buildUserPrompt(promptTemplate, text);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature,
        },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Gemini request failed (${response.status}): ${errorText || "Unknown provider error"}`,
    );
  }

  const data = (await response.json()) as GeminiGenerateResponse;
  const humanizedText = (data.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || "")
    .join("")
    .trim();

  if (!humanizedText) {
    throw new Error("Gemini returned empty output");
  }

  const usage = data.usageMetadata;
  const tokenSum = (usage?.promptTokenCount || 0) + (usage?.candidatesTokenCount || 0);
  const tokensUsed = usage?.totalTokenCount ?? (tokenSum > 0 ? tokenSum : undefined);

  return {
    humanizedText,
    provider: "gemini",
    model,
    tokensUsed,
  };
}

async function humanizeWithAnthropic(
  text: string,
  promptTemplate: string,
  options: HumanizeOptions,
): Promise<HumanizeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const model = anthropicModelForChoice(options.model ?? defaultAnthropicHumanizerChoice());
  const userPrompt = buildUserPrompt(promptTemplate, text);

  const anthropic = new Anthropic({ apiKey });
  // No temperature/top_p/top_k: Claude 5.5 models reject sampling parameters. Low effort
  // keeps adaptive thinking from consuming the rewrite's output budget.
  const message = await anthropic.messages.create({
    model,
    max_tokens: MAX_ANTHROPIC_TOKENS,
    output_config: { effort: "low" },
    system: "You rewrite content to sound more human and natural. Return only the rewritten text.",
    messages: [{ role: "user", content: userPrompt }],
  });

  const humanizedParts: string[] = [];
  for (const block of message.content) {
    if (block.type === "text") {
      humanizedParts.push(block.text);
    }
  }
  const humanizedText = humanizedParts.join("").trim();

  if (!humanizedText) {
    throw new Error("Anthropic returned empty output");
  }

  const inputTokens = message.usage?.input_tokens || 0;
  const outputTokens = message.usage?.output_tokens || 0;
  const tokensUsed = inputTokens + outputTokens || undefined;

  return {
    humanizedText,
    provider: "anthropic",
    model,
    tokensUsed,
    inputTokens,
    outputTokens,
  };
}

/**
 * The implicit Claude fallback never uses Opus: it runs without a tier check, so an
 * operator override naming Opus (or an unknown ID) resolves to Sonnet.
 */
function defaultAnthropicHumanizerChoice(): WritingModelChoice {
  const configured = parseWritingModelChoice(process.env.HUMANIZER_ANTHROPIC_MODEL);
  return configured === "haiku" ? "haiku" : "sonnet";
}

export async function humanizeText(
  text: string,
  options: HumanizeOptions = {},
): Promise<HumanizeResult> {
  const normalizedText = text.trim();
  if (!normalizedText) {
    throw new Error("Text is required");
  }
  if (normalizedText.length > MAX_HUMANIZER_TEXT_LENGTH) {
    throw new Error(`Text exceeds ${MAX_HUMANIZER_TEXT_LENGTH} character limit`);
  }

  const promptTemplate = await loadPromptTemplate();
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);

  if (!hasGemini && !hasAnthropic) {
    throw new Error(
      "No humanizer provider key configured. Set GEMINI_API_KEY or ANTHROPIC_API_KEY.",
    );
  }

  // An explicit Claude choice runs on that model rather than on the Gemini default.
  if (options.model) {
    if (!hasAnthropic) {
      throw new Error(
        "No humanizer provider key configured for Claude models. Set ANTHROPIC_API_KEY.",
      );
    }
    return humanizeWithAnthropic(normalizedText, promptTemplate, options);
  }

  if (hasGemini) {
    try {
      return await humanizeWithGemini(normalizedText, promptTemplate, options);
    } catch (error) {
      if (!hasAnthropic) {
        throw error;
      }
      logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        "[Humanizer] Gemini failed, falling back to Anthropic",
      );
    }
  }

  return humanizeWithAnthropic(normalizedText, promptTemplate, options);
}
