import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "./auth";
import { getUserById, incrementAiBudgetUsage } from "./authStorage";
import { aiLimiter } from "./rateLimits";
import {
  OPENROUTER_WRITING_TEST_SETTINGS,
  OpenRouterWritingError,
  estimateWritingTestCostMicrodollars,
  getOpenRouterBudgetSnapshot,
  getOpenRouterWritingModel,
  listOpenRouterWritingModels,
  microdollarsToUsd,
  parseOpenRouterWritingTestRequest,
  runOpenRouterWritingTest,
} from "./openRouterWriting";
import { createLogger } from "./logger";

const logger = createLogger("openRouterWritingRoutes");

function serializeBudget(snapshot: ReturnType<typeof getOpenRouterBudgetSnapshot>) {
  return {
    tier: snapshot.tier,
    limitMicrodollars: snapshot.limitMicrodollars,
    usedMicrodollars: snapshot.usedMicrodollars,
    remainingMicrodollars: snapshot.remainingMicrodollars,
    limitUsd: microdollarsToUsd(snapshot.limitMicrodollars),
    usedUsd: microdollarsToUsd(snapshot.usedMicrodollars),
    remainingUsd: microdollarsToUsd(snapshot.remainingMicrodollars),
  };
}

export function registerOpenRouterWritingRoutes(app: Express): void {
  app.get("/api/write/test-models", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await getUserById(req.user!.userId);
      if (!user) return res.status(401).json({ message: "Authentication required" });

      const models = await listOpenRouterWritingModels();
      return res.json({
        generationSettings: OPENROUTER_WRITING_TEST_SETTINGS,
        budget: serializeBudget(getOpenRouterBudgetSnapshot(user)),
        models,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to list OpenRouter writing test models");
      if (error instanceof OpenRouterWritingError) {
        return res.status(error.status).json({ message: error.message });
      }
      return res.status(500).json({ message: "Failed to list writing test models" });
    }
  });

  app.post(
    "/api/write/test-models/run",
    requireAuth,
    aiLimiter,
    async (req: Request, res: Response) => {
      try {
        const parsed = parseOpenRouterWritingTestRequest(req.body ?? {});
        const user = await getUserById(req.user!.userId);
        if (!user) return res.status(401).json({ message: "Authentication required" });

        const budget = getOpenRouterBudgetSnapshot(user);
        if (budget.limitMicrodollars <= 0) {
          return res.status(403).json({
            message: "OpenRouter writing model tests require the Pro or Max plan",
            budget: serializeBudget(budget),
          });
        }

        const model = await getOpenRouterWritingModel(parsed.model);
        const estimatedCostMicrodollars = estimateWritingTestCostMicrodollars(
          model,
          parsed.prompt,
        );
        if (estimatedCostMicrodollars > budget.remainingMicrodollars) {
          return res.status(403).json({
            message: "OpenRouter writing model test budget exceeded",
            estimatedCostMicrodollars,
            estimatedCostUsd: microdollarsToUsd(estimatedCostMicrodollars),
            budget: serializeBudget(budget),
          });
        }

        const result = await runOpenRouterWritingTest({
          model,
          prompt: parsed.prompt,
        });
        await incrementAiBudgetUsage(user.id, result.costMicrodollars);

        const updatedUser = await getUserById(user.id);
        return res.json({
          ...result,
          costUsd: microdollarsToUsd(result.costMicrodollars),
          generationSettings: OPENROUTER_WRITING_TEST_SETTINGS,
          budget: updatedUser
            ? serializeBudget(getOpenRouterBudgetSnapshot(updatedUser))
            : serializeBudget(budget),
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            message: "Invalid writing model test request",
            issues: error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          });
        }
        if (error instanceof OpenRouterWritingError) {
          return res.status(error.status).json({ message: error.message });
        }

        logger.error({ err: error }, "OpenRouter writing model test failed");
        return res.status(500).json({ message: "Writing model test failed" });
      }
    },
  );
}
