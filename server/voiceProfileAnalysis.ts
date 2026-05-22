import Anthropic from "@anthropic-ai/sdk";
import { reportProviderUsage, type TokenUsageReporter } from "./aiUsage";
import { voiceProfileSchema, type VoiceProfile } from "@shared/schema";

export interface SampleValidationResult {
  ok: boolean;
  samples?: string[];
  error?: string;
}

const MIN_SAMPLE_COUNT = 2;
const MAX_SAMPLE_COUNT = 10;
const MIN_TOTAL_CHARS = 500;
const MAX_TOTAL_CHARS = 200_000;

export function validateWritingSamples(rawSamples: unknown): SampleValidationResult {
  if (!Array.isArray(rawSamples)) {
    return { ok: false, error: "Provide 2-10 writing samples" };
  }

  const samples = rawSamples
    .filter((sample): sample is string => typeof sample === "string")
    .map((sample) => sample.trim())
    .filter(Boolean);

  if (samples.length < MIN_SAMPLE_COUNT || samples.length > MAX_SAMPLE_COUNT) {
    return { ok: false, error: "Provide 2-10 writing samples" };
  }

  const totalLength = samples.reduce((sum, sample) => sum + sample.length, 0);
  if (totalLength < MIN_TOTAL_CHARS) {
    return {
      ok: false,
      error: "Writing samples are too short. Provide at least 500 characters total.",
    };
  }

  if (totalLength > MAX_TOTAL_CHARS) {
    return {
      ok: false,
      error: "Writing samples are too long. Keep total under 200,000 characters.",
    };
  }

  return { ok: true, samples };
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, maxItems);
}

function normalizeVoiceProfile(rawProfile: unknown): VoiceProfile {
  const profile = rawProfile && typeof rawProfile === "object"
    ? rawProfile as Record<string, unknown>
    : {};
  const vocabularyLevel = profile.vocabularyLevel === "academic" ||
    profile.vocabularyLevel === "conversational" ||
    profile.vocabularyLevel === "mixed"
    ? profile.vocabularyLevel
    : "mixed";

  return voiceProfileSchema.parse({
    avgSentenceLength: stringValue(profile.avgSentenceLength, "Not enough evidence to determine sentence rhythm."),
    vocabularyLevel,
    paragraphStructure: stringValue(profile.paragraphStructure, "Not enough evidence to determine paragraph structure."),
    toneMarkers: stringArray(profile.toneMarkers, 8),
    commonTransitions: stringArray(profile.commonTransitions, 12),
    evidenceIntroduction: stringValue(profile.evidenceIntroduction, "No consistent evidence-introduction pattern detected."),
    argumentStructure: stringValue(profile.argumentStructure, "Not enough evidence to determine argument structure."),
    hedgingStyle: stringValue(profile.hedgingStyle, "Not enough evidence to determine hedging style."),
    openingPattern: stringValue(profile.openingPattern, "No consistent opening pattern detected."),
    closingPattern: stringValue(profile.closingPattern, "No consistent closing pattern detected."),
    distinctivePhrases: stringArray(profile.distinctivePhrases, 10),
    avoidedPatterns: stringArray(profile.avoidedPatterns, 8),
    voiceSummary: stringValue(profile.voiceSummary, "A reusable writing style profile generated from the provided samples."),
  });
}

export async function analyzeVoiceProfileSamples(
  samples: string[],
  onTokenUsage?: TokenUsageReporter,
): Promise<VoiceProfile> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const samplesBlock = samples
    .map((sample, index) => `--- SAMPLE ${index + 1} ---\n${sample}\n`)
    .join("\n");

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: "You are a writing style analyst. You produce precise, actionable voice profiles that allow an AI to replicate a specific author's writing style. Focus on what makes this writer DISTINCTIVE; skip universal or obvious traits. For every observation, ground it in specific patterns from the text. Bad: \"Uses varied sentence length.\" Good: \"Alternates 8-12 word declarative sentences with 25-35 word complex sentences when building arguments.\"",
    messages: [{
      role: "user",
      content: `Analyze these writing samples from the same author. Extract a voice profile.

${samplesBlock}

Return ONLY valid JSON matching this exact schema:
{
  "avgSentenceLength": "specific description of sentence length patterns with word count ranges",
  "vocabularyLevel": "academic" | "conversational" | "mixed",
  "paragraphStructure": "how they build paragraphs; length, opening moves, internal logic",
  "toneMarkers": ["3-5 specific tone descriptors with examples"],
  "commonTransitions": ["5-8 transition phrases they actually use, quoted from text"],
  "evidenceIntroduction": "exactly how they set up quotes, citations, or evidence; with example patterns",
  "argumentStructure": "how they sequence and build claims; do they lead with thesis or build to it",
  "hedgingStyle": "certainty level; do they hedge, assert, qualify? with example phrases",
  "openingPattern": "how they typically start paragraphs or sections",
  "closingPattern": "how they conclude paragraphs or sections",
  "distinctivePhrases": ["3-6 verbal tics, signature expressions, or recurring word choices"],
  "avoidedPatterns": ["3-5 things this writer conspicuously never does"],
  "voiceSummary": "2-3 sentence overall description capturing the gestalt of this writer's voice"
}`,
    }],
  });
  reportProviderUsage(response, onTokenUsage);

  const text = response.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to parse voice profile from AI response");
  }

  return normalizeVoiceProfile(JSON.parse(jsonMatch[0]));
}
