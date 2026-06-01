import Anthropic from "@anthropic-ai/sdk";
import { reportProviderUsage, type TokenUsageReporter } from "./aiUsage";
import { voiceProfileSchema, type VoiceProfile } from "@shared/schema";
import { ANTHROPIC_MODELS } from "./aiModels";

export interface SampleValidationResult {
  ok: boolean;
  samples?: string[];
  error?: string;
}

const MIN_SAMPLE_COUNT = 2;
const MAX_SAMPLE_COUNT = 20;
const MIN_TOTAL_CHARS = 500;
const MAX_TOTAL_CHARS = 500_000;
const VOICE_PROFILE_CHUNK_CHAR_BUDGET = 50_000;
const CHUNK_ANALYSIS_CONCURRENCY = 2;
const CHUNK_PROFILE_MAX_TOKENS = 3072;
const FINAL_PROFILE_MAX_TOKENS = 4096;

export function validateWritingSamples(rawSamples: unknown): SampleValidationResult {
  if (!Array.isArray(rawSamples)) {
    return { ok: false, error: "Provide 2-20 writing samples" };
  }

  const samples = rawSamples
    .filter((sample): sample is string => typeof sample === "string")
    .map((sample) => sample.trim())
    .filter(Boolean);

  if (samples.length < MIN_SAMPLE_COUNT || samples.length > MAX_SAMPLE_COUNT) {
    return { ok: false, error: "Provide 2-20 writing samples" };
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
      error: "Writing samples are too long. Keep total under 500,000 characters.",
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

function splitTextIntoChunks(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let index = 0;
  const safeMaxChars = Math.max(1, maxChars);

  while (index < text.length) {
    chunks.push(text.slice(index, index + safeMaxChars));
    index += safeMaxChars;
  }

  return chunks;
}

function buildChunkInputs(samples: string[]): string[] {
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentLength = 0;
  const sampleBudget = Math.max(1, VOICE_PROFILE_CHUNK_CHAR_BUDGET - 120);

  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex++) {
    const sample = samples[sampleIndex];
    const sampleParts = splitTextIntoChunks(sample, sampleBudget);

    for (let partIndex = 0; partIndex < sampleParts.length; partIndex++) {
      const header = `--- SAMPLE ${sampleIndex + 1} (${partIndex + 1}) ---\n`;
      const chunkText = `${header}${sampleParts[partIndex]}`;
      const hasCurrent = currentChunk.length > 0;
      const nextLength = currentLength + chunkText.length + (hasCurrent ? 2 : 0);

      if (hasCurrent && nextLength > VOICE_PROFILE_CHUNK_CHAR_BUDGET) {
        chunks.push(currentChunk.join("\n\n"));
        currentChunk = [chunkText];
        currentLength = chunkText.length;
        continue;
      }

      currentChunk.push(chunkText);
      currentLength = hasCurrent ? currentLength + chunkText.length + 2 : chunkText.length;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join("\n\n"));
  }

  return chunks;
}

function extractJsonFromResponse(content: Array<{ type: string; text?: string }>): string {
  const text = content
    .filter((block): block is { type: string; text: string } =>
      block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to parse voice profile from AI response");
  }
  return jsonMatch[0];
}

const ANALYSIS_SYSTEM_PROMPT = `You are a writing style analyst. You produce precise, actionable voice profiles that allow an AI to replicate a specific author's writing style. Focus on what makes this writer DISTINCTIVE; skip universal or obvious traits. For every observation, ground it in specific patterns from the text. Bad: "Uses varied sentence length." Good: "Alternates 8-12 word declarative sentences with 25-35 word complex sentences when building arguments."`;

const VOICE_PROFILE_SCHEMA_PROMPT = `Return ONLY valid JSON matching this exact schema:
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
}`;

const ANALYSIS_USER_PROMPT = `Analyze these writing samples from the same author. Extract a voice profile for this chunk.

SAMPLE BLOCK:
{SAMPLES}

${VOICE_PROFILE_SCHEMA_PROMPT}`;

const SYNTHESIS_USER_PROMPT = `You are merging partial voice profiles extracted from separate chunks of a user's writing sample library.

Your job is to sift through the partial profiles and produce one stable, reusable voice profile. Prefer traits that recur across chunks or are unusually distinctive. Do not simply copy the longest partial answer. Remove generic observations, resolve contradictions by describing when a trait appears, and keep only phrases/transitions that appear in the evidence.

PARTIAL VOICE PROFILES:
{PARTIALS}

${VOICE_PROFILE_SCHEMA_PROMPT}`;

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }));

  return results;
}

async function analyzeSampleChunk(
  client: Anthropic,
  chunkText: string,
  onTokenUsage?: TokenUsageReporter,
  model = ANTHROPIC_MODELS.sonnet,
  maxTokens = FINAL_PROFILE_MAX_TOKENS,
): Promise<VoiceProfile> {
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: ANALYSIS_SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: ANALYSIS_USER_PROMPT.replace("{SAMPLES}", chunkText),
    }],
  });
  reportProviderUsage(response, onTokenUsage);

  return normalizeVoiceProfile(JSON.parse(extractJsonFromResponse(response.content)));
}

async function synthesizeVoiceProfile(
  client: Anthropic,
  partialProfiles: VoiceProfile[],
  onTokenUsage?: TokenUsageReporter,
): Promise<VoiceProfile> {
  const response = await client.messages.create({
    model: ANTHROPIC_MODELS.sonnet,
    max_tokens: FINAL_PROFILE_MAX_TOKENS,
    system: ANALYSIS_SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: SYNTHESIS_USER_PROMPT.replace(
        "{PARTIALS}",
        partialProfiles.map((profile, index) =>
          `--- PARTIAL PROFILE ${index + 1} ---\n${JSON.stringify(profile, null, 2)}`,
        ).join("\n\n"),
      ),
    }],
  });
  reportProviderUsage(response, onTokenUsage);

  return normalizeVoiceProfile(JSON.parse(extractJsonFromResponse(response.content)));
}

export async function analyzeVoiceProfileSamples(
  samples: string[],
  onTokenUsage?: TokenUsageReporter,
): Promise<VoiceProfile> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const chunks = buildChunkInputs(samples);

  if (chunks.length === 1) {
    return analyzeSampleChunk(client, chunks[0], onTokenUsage);
  }

  const partialProfiles = await mapWithConcurrency(
    chunks,
    CHUNK_ANALYSIS_CONCURRENCY,
    (chunkText) => analyzeSampleChunk(
      client,
      chunkText,
      onTokenUsage,
      ANTHROPIC_MODELS.haiku,
      CHUNK_PROFILE_MAX_TOKENS,
    ),
  );

  return synthesizeVoiceProfile(client, partialProfiles, onTokenUsage);
}
