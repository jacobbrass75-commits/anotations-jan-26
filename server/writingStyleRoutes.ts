import type { Express, Request, Response } from "express";
import { checkTokenBudget, requireAuth, requireTier } from "./auth";
import { aiLimiter } from "./rateLimits";
import { createTokenUsageAccumulator } from "./aiUsage";
import { writingStyleStorage } from "./writingStyleStorage";
import { analyzeVoiceProfileSamples, validateWritingSamples } from "./voiceProfileAnalysis";
import { voiceProfileSchema, type VoiceProfile, type WritingStyle } from "@shared/schema";
import { createLogger } from "./logger";

const logger = createLogger("writingStyleRoutes");

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > 80) return null;
  return name;
}

function normalizeDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const description = value.trim();
  return description ? description.slice(0, 1000) : null;
}

function parseStoredVoiceProfile(value: string): VoiceProfile | null {
  try {
    return voiceProfileSchema.parse(JSON.parse(value));
  } catch {
    return null;
  }
}

function normalizeStoredSamples(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter((sample): sample is string => typeof sample === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((sample): sample is string => typeof sample === "string")
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function toWritingStyleResponse(style: WritingStyle) {
  return {
    ...style,
    voiceProfile: parseStoredVoiceProfile(style.voiceProfile),
    samples: normalizeStoredSamples(style.samples),
  };
}

async function getOwnedWritingStyleOr404(
  req: Request,
  res: Response,
): Promise<WritingStyle | null> {
  const style = await writingStyleStorage.getWritingStyleForUser(req.params.id, req.user!.userId);
  if (!style) {
    res.status(404).json({ message: "Writing style not found" });
    return null;
  }
  return style;
}

export function registerWritingStyleRoutes(app: Express): void {
  app.get(
    "/api/writing-styles",
    requireAuth,
    requireTier("pro"),
    async (req: Request, res: Response) => {
      try {
        const styles = await writingStyleStorage.getWritingStylesForUser(req.user!.userId);
        res.json(styles.map(toWritingStyleResponse));
      } catch (error) {
        logger.error({ err: error }, "Error listing writing styles:");
        res.status(500).json({ message: "Failed to list writing styles" });
      }
    },
  );

  app.post(
    "/api/writing-styles",
    requireAuth,
    aiLimiter,
    requireTier("pro"),
    checkTokenBudget,
    async (req: Request, res: Response) => {
      const tokenUsage = createTokenUsageAccumulator();
      try {
        const name = normalizeName(req.body?.name);
        if (!name) {
          return res
            .status(400)
            .json({ message: "Name is required and must be 80 characters or less" });
        }

        const existing = await writingStyleStorage.getWritingStyleByNameForUser(
          name,
          req.user!.userId,
        );
        if (existing) {
          return res.status(409).json({ message: "A writing style with this name already exists" });
        }

        const validation = validateWritingSamples(req.body?.samples);
        if (!validation.ok || !validation.samples) {
          return res
            .status(400)
            .json({ message: validation.error || "Provide 2-10 writing samples" });
        }

        const voiceProfile = await analyzeVoiceProfileSamples(validation.samples, tokenUsage.add);
        const created = await writingStyleStorage.createWritingStyle({
          userId: req.user!.userId,
          name,
          description: normalizeDescription(req.body?.description),
          voiceProfile: JSON.stringify(voiceProfile),
          samples: validation.samples,
        });

        await tokenUsage.flush(req.user!.userId, "writing_style_analysis");
        res.status(201).json(toWritingStyleResponse(created));
      } catch (error) {
        logger.error({ err: error }, "Error creating writing style:");
        res.status(500).json({ message: "Failed to create writing style" });
      }
    },
  );

  app.get(
    "/api/writing-styles/:id",
    requireAuth,
    requireTier("pro"),
    async (req: Request, res: Response) => {
      try {
        const style = await getOwnedWritingStyleOr404(req, res);
        if (!style) return;
        res.json(toWritingStyleResponse(style));
      } catch (error) {
        logger.error({ err: error }, "Error fetching writing style:");
        res.status(500).json({ message: "Failed to fetch writing style" });
      }
    },
  );

  app.put(
    "/api/writing-styles/:id",
    requireAuth,
    aiLimiter,
    requireTier("pro"),
    checkTokenBudget,
    async (req: Request, res: Response) => {
      const tokenUsage = createTokenUsageAccumulator();
      try {
        const existing = await getOwnedWritingStyleOr404(req, res);
        if (!existing) return;

        const updates: Partial<{
          name: string;
          description: string | null;
          voiceProfile: string;
          samples: string[];
        }> = {};

        if (req.body?.name !== undefined) {
          const name = normalizeName(req.body.name);
          if (!name) {
            return res
              .status(400)
              .json({ message: "Name is required and must be 80 characters or less" });
          }
          if (name !== existing.name) {
            const duplicate = await writingStyleStorage.getWritingStyleByNameForUser(
              name,
              req.user!.userId,
            );
            if (duplicate) {
              return res
                .status(409)
                .json({ message: "A writing style with this name already exists" });
            }
          }
          updates.name = name;
        }

        if (req.body?.description !== undefined) {
          updates.description = normalizeDescription(req.body.description);
        }

        if (req.body?.voiceProfile !== undefined) {
          const parsed = voiceProfileSchema.safeParse(req.body.voiceProfile);
          if (!parsed.success) {
            return res.status(400).json({ message: "Invalid voice profile" });
          }
          updates.voiceProfile = JSON.stringify(parsed.data);
        }

        if (req.body?.reanalyze === true) {
          const validation = validateWritingSamples(req.body?.samples);
          if (!validation.ok || !validation.samples) {
            return res
              .status(400)
              .json({ message: validation.error || "Provide 2-10 writing samples" });
          }
          const voiceProfile = await analyzeVoiceProfileSamples(validation.samples, tokenUsage.add);
          updates.voiceProfile = JSON.stringify(voiceProfile);
          updates.samples = validation.samples;
        }

        const updated = await writingStyleStorage.updateWritingStyle(existing.id, updates);
        await tokenUsage.flush(req.user!.userId, "writing_style_update");
        res.json(toWritingStyleResponse(updated || existing));
      } catch (error) {
        logger.error({ err: error }, "Error updating writing style:");
        res.status(500).json({ message: "Failed to update writing style" });
      }
    },
  );

  app.delete(
    "/api/writing-styles/:id",
    requireAuth,
    requireTier("pro"),
    async (req: Request, res: Response) => {
      try {
        const style = await getOwnedWritingStyleOr404(req, res);
        if (!style) return;
        await writingStyleStorage.deleteWritingStyle(style.id);
        res.json({ success: true });
      } catch (error) {
        logger.error({ err: error }, "Error deleting writing style:");
        res.status(500).json({ message: "Failed to delete writing style" });
      }
    },
  );
}
