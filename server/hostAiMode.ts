import type { NextFunction, Request, Response } from "express";
import { checkTokenBudget } from "./auth";

/**
 * "Host AI" mode: the caller (Claude or ChatGPT through the MCP connector) does
 * the reading, summarizing, and annotating with its own model, and ScholarMark
 * only stores what it sends. Requests in this mode must not trigger background
 * OpenAI/Anthropic calls such as auto-summaries, citation extraction, or
 * embeddings.
 */
export const HOST_AI_MODE_HEADER = "x-scholarmark-ai-mode";

export function isHostAiRequest(req: Request): boolean {
  const value = req.get(HOST_AI_MODE_HEADER);
  return typeof value === "string" && value.trim().toLowerCase() === "host";
}

/** Token budgets meter ScholarMark's own AI spend, so host-AI requests skip them. */
export async function checkTokenBudgetUnlessHostAi(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (isHostAiRequest(req)) {
    next();
    return;
  }
  await checkTokenBudget(req, res, next);
}
