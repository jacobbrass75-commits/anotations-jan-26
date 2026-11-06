import type { Express, Request, Response } from "express";
import { randomUUID } from "crypto";
import { checkTokenBudget, requireAuth } from "./auth";
import { aiLimiter } from "./rateLimits";
import { getUserById, incrementTokenUsage } from "./authStorage";
import { usageLedger } from "./db";
import { humanizeText, MAX_HUMANIZER_TEXT_LENGTH } from "./humanizer";
import { createLogger } from "./logger";
import type { WritingModelChoice } from "./planLimits";
import { resolveRequestedWritingModel } from "./writingModelChoice";

const logger = createLogger("humanizerRoutes");

const HUMANIZER_MAX_OUTPUT_TOKENS = 4096;

// Claude Opus 5.5: USD 4 / 20 per million input / output tokens.
function opusCostCents(inputTokens: number, outputTokens: number): number {
  return Math.ceil(
    ((Math.max(0, inputTokens) * 4 + Math.max(0, outputTokens) * 20) / 1_000_000) * 100,
  );
}

/** Humanizing with Opus counts against the same per-period Opus run cap as writing chat. */
async function reserveHumanizerOpusRun(
  req: Request,
  textLength: number,
): Promise<{ ok: true; requestId: string } | { ok: false; status: number; message: string }> {
  const user = await getUserById(req.user!.userId);
  if (!user) return { ok: false, status: 401, message: "Authentication required" };
  const requestId = `${user.id}:humanize:${req.header("x-request-id")?.trim() || randomUUID()}`;
  const reservation = usageLedger.reserve({
    userId: user.id,
    requestId,
    tier: user.tier,
    model: "opus",
    estimatedCostCents: opusCostCents(
      Math.ceil(textLength / 3) + 1_000,
      HUMANIZER_MAX_OUTPUT_TOKENS,
    ),
    billingPeriodStart: user.billingCycleStart,
    billingPeriodEnd: user.subscriptionCurrentPeriodEnd,
  });
  if (!reservation.ok) {
    if (reservation.reason === "conflict") {
      return {
        ok: false,
        status: 409,
        message: "This request ID was already used for another model",
      };
    }
    return {
      ok: false,
      status: 429,
      message:
        reservation.reason === "model_limit"
          ? "Your Claude Opus 5.5 runs for this period have been used. Switch to Claude Sonnet 5.5 or Claude Haiku 5.5."
          : "AI credit allowance reached for this period",
    };
  }
  if (reservation.idempotent) {
    return {
      ok: false,
      status: 409,
      message: "This request was already submitted. Send a new request ID to run it again.",
    };
  }
  return { ok: true, requestId };
}

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
  app.post(
    "/api/humanize",
    requireAuth,
    aiLimiter,
    checkTokenBudget,
    async (req: Request, res: Response) => {
      const startedAt = Date.now();
      let opusRequestId: string | null = null;
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
        if (
          temperature !== undefined &&
          (!Number.isFinite(temperature) || typeof temperature !== "number")
        ) {
          return res
            .status(400)
            .json({ error: "temperature must be a finite number when provided" });
        }

        // Explicit model choices are entitlement-checked before any provider call.
        let choice: WritingModelChoice | undefined;
        if (model !== undefined) {
          const requested = resolveRequestedWritingModel(model, req.user!.tier);
          if (!requested.ok) {
            return res.status(requested.status).json({ error: requested.message });
          }
          choice = requested.model;
        }

        if (choice === "opus") {
          const reservation = await reserveHumanizerOpusRun(req, text.length);
          if (!reservation.ok) {
            return res.status(reservation.status).json({ error: reservation.message });
          }
          opusRequestId = reservation.requestId;
        }

        const result = await humanizeText(text, {
          model: choice,
          temperature: typeof temperature === "number" ? temperature : undefined,
        });

        if (opusRequestId) {
          usageLedger.settle(
            opusRequestId,
            opusCostCents(result.inputTokens ?? 0, result.outputTokens ?? 0),
          );
          opusRequestId = null;
        }

        if (result.tokensUsed && result.tokensUsed > 0) {
          try {
            await incrementTokenUsage(req.user!.userId, result.tokensUsed);
          } catch (error) {
            logger.warn(
              {
                userId: req.user?.userId,
                error: error instanceof Error ? error.message : String(error),
              },
              "[Humanizer] Failed to increment token usage",
            );
          }
        }

        const durationMs = Date.now() - startedAt;
        logger.info(
          {
            userId: req.user?.userId,
            provider: result.provider,
            model: result.model,
            inputChars: text.length,
            outputChars: result.humanizedText.length,
            tokensUsed: result.tokensUsed ?? null,
            durationMs,
          },
          "[Humanizer] Request completed",
        );

        return res.json({
          humanizedText: result.humanizedText,
          provider: result.provider,
          model: result.model,
          tokensUsed: result.tokensUsed,
        });
      } catch (error) {
        if (opusRequestId) usageLedger.refund(opusRequestId);
        const message = error instanceof Error ? error.message : "Failed to humanize text";
        logger.error(
          {
            userId: req.user?.userId,
            error: message,
          },
          "[Humanizer] Request failed",
        );
        return res.status(getErrorStatus(message)).json({ error: message });
      }
    },
  );
}
