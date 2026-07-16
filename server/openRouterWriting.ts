import { z } from "zod";
import type { User } from "@shared/schema";
import { normalizePlanTier, type PlanTier } from "./planLimits";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const MICRODOLLARS_PER_DOLLAR = 1_000_000;
const MODEL_CATALOG_CACHE_MS = 5 * 60 * 1000;

export const OPENROUTER_WRITING_TEST_SETTINGS = {
  temperature: 0.8,
  maxTokens: 800,
  systemPrompt: "You are a skilled prose writer.",
} as const;

export const OPENROUTER_WRITING_MODEL_IDS = [
  "deepseek/deepseek-v4-pro",
  "openai/gpt-5.6-sol",
] as const;

export type OpenRouterWritingModelId = (typeof OPENROUTER_WRITING_MODEL_IDS)[number];

export const PLAN_OPENROUTER_BUDGET_MICRODOLLARS: Record<PlanTier, number> = {
  // Value-model calls also remain subject to Starter's global $1.50 ledger ceiling.
  free: 0.5 * MICRODOLLARS_PER_DOLLAR,
  pro: 7 * MICRODOLLARS_PER_DOLLAR,
  max: 25 * MICRODOLLARS_PER_DOLLAR,
};

const STATIC_PRICING: Partial<
  Record<
    OpenRouterWritingModelId,
    { promptUsdPerToken: number; completionUsdPerToken: number; contextLength: number }
  >
> = {
  "deepseek/deepseek-v4-pro": {
    promptUsdPerToken: 0.000000435,
    completionUsdPerToken: 0.00000087,
    contextLength: 1_048_576,
  },
  "openai/gpt-5.6-sol": {
    promptUsdPerToken: 0.000005,
    completionUsdPerToken: 0.00003,
    contextLength: 1_050_000,
  },
};

const writingTestRequestSchema = z.object({
  model: z.enum(OPENROUTER_WRITING_MODEL_IDS),
  prompt: z.string().trim().min(10).max(20_000),
});

export type OpenRouterWritingTestRequest = z.infer<typeof writingTestRequestSchema>;

export interface OpenRouterModelInfo {
  id: OpenRouterWritingModelId;
  available: boolean;
  promptUsdPerToken: number | null;
  completionUsdPerToken: number | null;
  contextLength: number | null;
}

interface OpenRouterCatalogModel {
  id?: unknown;
  pricing?: {
    prompt?: unknown;
    completion?: unknown;
  } | null;
  context_length?: unknown;
}

interface OpenRouterCatalogCache {
  loadedAt: number;
  models: Map<string, OpenRouterModelInfo>;
}

export class OpenRouterWritingError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let catalogCache: OpenRouterCatalogCache | null = null;

function parsePrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseContextLength(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

function toModelInfo(model: OpenRouterCatalogModel): OpenRouterModelInfo | null {
  if (typeof model.id !== "string" || !isOpenRouterWritingModelId(model.id)) return null;

  const promptUsdPerToken = parsePrice(model.pricing?.prompt);
  const completionUsdPerToken = parsePrice(model.pricing?.completion);
  const fallback = STATIC_PRICING[model.id];

  return {
    id: model.id,
    available: true,
    promptUsdPerToken: promptUsdPerToken ?? fallback?.promptUsdPerToken ?? null,
    completionUsdPerToken: completionUsdPerToken ?? fallback?.completionUsdPerToken ?? null,
    contextLength: parseContextLength(model.context_length) ?? fallback?.contextLength ?? null,
  };
}

function staticModelInfo(id: OpenRouterWritingModelId): OpenRouterModelInfo {
  const pricing = STATIC_PRICING[id];
  return {
    id,
    available: false,
    promptUsdPerToken: pricing?.promptUsdPerToken ?? null,
    completionUsdPerToken: pricing?.completionUsdPerToken ?? null,
    contextLength: pricing?.contextLength ?? null,
  };
}

function mergeCatalogModels(
  catalogModels: OpenRouterCatalogModel[],
): Map<string, OpenRouterModelInfo> {
  const models = new Map<string, OpenRouterModelInfo>();
  for (const id of OPENROUTER_WRITING_MODEL_IDS) {
    models.set(id, staticModelInfo(id));
  }
  for (const model of catalogModels) {
    const info = toModelInfo(model);
    if (info) models.set(info.id, info);
  }
  return models;
}

async function fetchModelCatalog(): Promise<Map<string, OpenRouterModelInfo>> {
  const now = Date.now();
  if (catalogCache && now - catalogCache.loadedAt < MODEL_CATALOG_CACHE_MS) {
    return catalogCache.models;
  }

  const response = await fetch(OPENROUTER_MODELS_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new OpenRouterWritingError(
      503,
      `OpenRouter model catalog failed with ${response.status}`,
    );
  }

  const body = (await response.json()) as { data?: OpenRouterCatalogModel[] };
  const models = mergeCatalogModels(Array.isArray(body.data) ? body.data : []);
  catalogCache = { loadedAt: now, models };
  return models;
}

export function isOpenRouterWritingModelId(value: string): value is OpenRouterWritingModelId {
  return (OPENROUTER_WRITING_MODEL_IDS as readonly string[]).includes(value);
}

function requirePricing(model: OpenRouterModelInfo): {
  promptUsdPerToken: number;
  completionUsdPerToken: number;
} {
  if (model.promptUsdPerToken === null || model.completionUsdPerToken === null) {
    throw new OpenRouterWritingError(
      503,
      `OpenRouter pricing is not available for ${model.id}; refresh the model catalog before enabling it.`,
    );
  }

  return {
    promptUsdPerToken: model.promptUsdPerToken,
    completionUsdPerToken: model.completionUsdPerToken,
  };
}

export function parseOpenRouterWritingTestRequest(body: unknown): OpenRouterWritingTestRequest {
  return writingTestRequestSchema.parse(body);
}

export function getOpenRouterBudgetLimitMicrodollars(tier: string | null | undefined): number {
  return PLAN_OPENROUTER_BUDGET_MICRODOLLARS[normalizePlanTier(tier)];
}

export function getOpenRouterBudgetSnapshot(user: User): {
  tier: PlanTier;
  limitMicrodollars: number;
  usedMicrodollars: number;
  remainingMicrodollars: number;
} {
  const tier = normalizePlanTier(user.tier);
  const limitMicrodollars = PLAN_OPENROUTER_BUDGET_MICRODOLLARS[tier];
  const usedMicrodollars = Math.max(0, user.aiBudgetMicrodollarsUsed ?? 0);
  return {
    tier,
    limitMicrodollars,
    usedMicrodollars,
    remainingMicrodollars: Math.max(limitMicrodollars - usedMicrodollars, 0),
  };
}

export function microdollarsToUsd(microdollars: number): number {
  return Math.round((microdollars / MICRODOLLARS_PER_DOLLAR) * 1_000_000) / 1_000_000;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 3));
}

export function estimateWritingTestCostMicrodollars(
  model: OpenRouterModelInfo,
  prompt: string,
): number {
  const pricing = requirePricing(model);
  const promptTokens =
    estimateTokens(OPENROUTER_WRITING_TEST_SETTINGS.systemPrompt) + estimateTokens(prompt);
  return calculateCostMicrodollars({
    promptTokens,
    completionTokens: OPENROUTER_WRITING_TEST_SETTINGS.maxTokens,
    ...pricing,
  });
}

export function estimateOpenRouterMessagesCostMicrodollars(
  model: OpenRouterModelInfo,
  messages: OpenRouterChatMessage[],
  maxTokens: number,
): number {
  const pricing = requirePricing(model);
  const promptTokens = messages.reduce(
    (total, message) => total + estimateTokens(message.content),
    0,
  );
  return calculateCostMicrodollars({
    promptTokens,
    completionTokens: maxTokens,
    ...pricing,
  });
}

function calculateCostMicrodollars(input: {
  promptTokens: number;
  completionTokens: number;
  promptUsdPerToken: number;
  completionUsdPerToken: number;
}): number {
  const costUsd =
    input.promptTokens * input.promptUsdPerToken +
    input.completionTokens * input.completionUsdPerToken;
  return Math.max(1, Math.ceil(costUsd * MICRODOLLARS_PER_DOLLAR - 1e-6));
}

export async function listOpenRouterWritingModels(): Promise<OpenRouterModelInfo[]> {
  const catalog = await fetchModelCatalog();
  return OPENROUTER_WRITING_MODEL_IDS.map((id) => catalog.get(id) ?? staticModelInfo(id));
}

export async function getOpenRouterWritingModel(
  modelId: OpenRouterWritingModelId,
): Promise<OpenRouterModelInfo> {
  const catalog = await fetchModelCatalog();
  return catalog.get(modelId) ?? staticModelInfo(modelId);
}

export async function runOpenRouterWritingTest(input: {
  model: OpenRouterModelInfo;
  prompt: string;
}): Promise<{
  id: string | null;
  model: OpenRouterWritingModelId;
  output: string;
  finishReason: string | null;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  costMicrodollars: number;
}> {
  return runOpenRouterChatCompletion({
    model: input.model,
    messages: [
      { role: "system", content: OPENROUTER_WRITING_TEST_SETTINGS.systemPrompt },
      { role: "user", content: input.prompt },
    ],
    maxTokens: OPENROUTER_WRITING_TEST_SETTINGS.maxTokens,
    temperature: OPENROUTER_WRITING_TEST_SETTINGS.temperature,
    title: "ScholarMark Writing Model Test",
    timeoutMs: 45_000,
  });
}

export type OpenRouterChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function runOpenRouterChatCompletion(input: {
  model: OpenRouterModelInfo;
  messages: OpenRouterChatMessage[];
  maxTokens: number;
  temperature?: number;
  title?: string;
  timeoutMs?: number;
}): Promise<{
  id: string | null;
  model: OpenRouterWritingModelId;
  output: string;
  finishReason: string | null;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  costMicrodollars: number;
}> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new OpenRouterWritingError(503, "OPENROUTER_API_KEY is not configured");
  }
  if (!input.model.available) {
    throw new OpenRouterWritingError(
      404,
      `${input.model.id} is not available in the OpenRouter catalog right now`,
    );
  }
  const pricing = requirePricing(input.model);

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "http-referer": process.env.APP_BASE_URL || "https://app.scholarmark.ai",
      "x-openrouter-title": input.title || "ScholarMark Writing",
    },
    body: JSON.stringify({
      model: input.model.id,
      messages: input.messages,
      temperature: input.temperature ?? OPENROUTER_WRITING_TEST_SETTINGS.temperature,
      max_tokens: input.maxTokens,
    }),
    signal: AbortSignal.timeout(input.timeoutMs ?? 60_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new OpenRouterWritingError(
      response.status >= 400 && response.status < 500 ? response.status : 502,
      `OpenRouter request failed with ${response.status}: ${body.slice(0, 300)}`,
    );
  }

  const body = (await response.json()) as {
    id?: unknown;
    choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
    usage?: {
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
      total_tokens?: unknown;
      cost?: unknown;
    };
  };

  const output = body.choices
    ?.map((choice) => (typeof choice.message?.content === "string" ? choice.message.content : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (!output) {
    throw new OpenRouterWritingError(502, "OpenRouter returned an empty writing response");
  }

  const promptTokens = parseUsageToken(body.usage?.prompt_tokens);
  const completionTokens = parseUsageToken(body.usage?.completion_tokens);
  const totalTokens = parseUsageToken(body.usage?.total_tokens) || promptTokens + completionTokens;
  const responseCostUsd = parsePrice(body.usage?.cost);
  const costMicrodollars =
    responseCostUsd !== null
      ? Math.max(1, Math.ceil(responseCostUsd * MICRODOLLARS_PER_DOLLAR - 1e-6))
      : calculateCostMicrodollars({ promptTokens, completionTokens, ...pricing });

  return {
    id: typeof body.id === "string" ? body.id : null,
    model: input.model.id,
    output,
    finishReason:
      typeof body.choices?.[0]?.finish_reason === "string" ? body.choices[0].finish_reason : null,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens,
    },
    costMicrodollars,
  };
}

function parseUsageToken(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}
