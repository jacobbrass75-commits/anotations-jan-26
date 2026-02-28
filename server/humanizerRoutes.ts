import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { incrementTokenUsage } from "./authStorage";
import { humanizeText, MAX_HUMANIZER_TEXT_LENGTH } from "./humanizer";

function getErrorStatus(message: string): number {
  if (
    message.includes("Text is required") ||
    message.includes("character limit") ||
    message.includes("temperature")
  ) {
    return 400;
  }
  if (message.includes("No humanizer provider key configured")) {
    return 503;
  }
  return 500;
}

export function registerHumanizerRoutes(app: Express): void {
  app.post("/api/humanize", requireAuth, async (req: Request, res: Response) => {
    const startedAt = Date.now();
    try {
      const { text, model, temperature } = req.body ?? {};

      if (typeof text !== "string" || text.trim().length === 0) {
        return res.status(400).json({ error: "Text is required" });
      }
      if (text.length > MAX_HUMANIZER_TEXT_LENGTH) {
        return res.status(400).json({
          error: `Text must be ${MAX_HUMANIZER_TEXT_LENGTH} characters or fewer`,
        });
      }
      if (model !== undefined && (typeof model !== "string" || model.trim().length === 0)) {
        return res.status(400).json({ error: "model must be a non-empty string when provided" });
      }
      if (temperature !== undefined && (!Number.isFinite(temperature) || typeof temperature !== "number")) {
        return res.status(400).json({ error: "temperature must be a finite number when provided" });
      }

      const result = await humanizeText(text, {
        model: typeof model === "string" ? model.trim() : undefined,
        temperature: typeof temperature === "number" ? temperature : undefined,
      });

      if (result.tokensUsed && result.tokensUsed > 0) {
        incrementTokenUsage(req.user!.userId, result.tokensUsed).catch((error) => {
          console.warn("[Humanizer] Failed to increment token usage", {
            userId: req.user?.userId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }

      const durationMs = Date.now() - startedAt;
      console.log("[Humanizer] Request completed", {
        userId: req.user?.userId,
        provider: result.provider,
        model: result.model,
        inputChars: text.length,
        outputChars: result.humanizedText.length,
        tokensUsed: result.tokensUsed ?? null,
        durationMs,
      });

      return res.json({
        humanizedText: result.humanizedText,
        provider: result.provider,
        model: result.model,
        tokensUsed: result.tokensUsed,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to humanize text";
      console.error("[Humanizer] Request failed", {
        userId: req.user?.userId,
        error: message,
      });
      return res.status(getErrorStatus(message)).json({ error: message });
    }
  });
}
