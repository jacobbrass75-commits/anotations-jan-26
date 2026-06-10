import type { Express, Request, Response } from "express";
import { checkTokenBudget, requireAuth, requireTier } from "../auth";
import { aiLimiter } from "../rateLimits";
import { projectStorage } from "../projectStorage";
import { createTokenUsageAccumulator } from "../aiUsage";
import { analyzeVoiceProfileSamples, validateWritingSamples } from "../voiceProfileAnalysis";
import { verifyProjectOwnership } from "./documentHandlers";
import { createLogger } from "../logger";

const logger = createLogger("projects/voiceProfileHandlers");

export function registerVoiceProfileRoutes(app: Express): void {
  // === VOICE PROFILE ===

  /** Analyze writing samples and generate a voice profile */
  app.post(
    "/api/projects/:id/voice-profile/analyze",
    requireAuth,
    aiLimiter,
    requireTier("pro"),
    checkTokenBudget,
    async (req: Request, res: Response) => {
      const tokenUsage = createTokenUsageAccumulator();
      try {
        const project = await verifyProjectOwnership(req, res, req.params.id);
        if (!project) return;

        const validation = validateWritingSamples(req.body?.samples);
        if (!validation.ok || !validation.samples) {
          return res
            .status(400)
            .json({ error: validation.error || "Provide 2-10 writing samples" });
        }

        const samples = validation.samples;
        const voiceProfile = await analyzeVoiceProfileSamples(samples, tokenUsage.add);

        // Store both the profile and the original samples (for re-analysis later)
        await projectStorage.updateProject(req.params.id, {
          voiceProfile: JSON.stringify(voiceProfile),
          voiceProfileSamples: JSON.stringify(samples),
        } as any);

        await tokenUsage.flush(req.user!.userId, "voice_profile_analysis");
        res.json({ voiceProfile });
      } catch (error) {
        logger.error({ err: error }, "Error analyzing voice profile:");
        res.status(500).json({ error: "Failed to analyze writing style" });
      }
    },
  );

  /** Get the voice profile for a project */
  app.get("/api/projects/:id/voice-profile", requireAuth, async (req: Request, res: Response) => {
    try {
      const project = await verifyProjectOwnership(req, res, req.params.id);
      if (!project) return;

      const voiceProfile = (project as any).voiceProfile
        ? JSON.parse((project as any).voiceProfile)
        : null;
      const hasSamples = !!(project as any).voiceProfileSamples;

      res.json({ voiceProfile, hasSamples });
    } catch (error) {
      logger.error({ err: error }, "Error fetching voice profile:");
      res.status(500).json({ error: "Failed to fetch voice profile" });
    }
  });

  /** Update (manually edit) the voice profile */
  app.put("/api/projects/:id/voice-profile", requireAuth, async (req: Request, res: Response) => {
    try {
      const project = await verifyProjectOwnership(req, res, req.params.id);
      if (!project) return;

      const { voiceProfile } = req.body;
      if (!voiceProfile || typeof voiceProfile !== "object") {
        return res.status(400).json({ error: "Invalid voice profile" });
      }

      await projectStorage.updateProject(req.params.id, {
        voiceProfile: JSON.stringify(voiceProfile),
      } as any);

      res.json({ voiceProfile });
    } catch (error) {
      logger.error({ err: error }, "Error updating voice profile:");
      res.status(500).json({ error: "Failed to update voice profile" });
    }
  });

  /** Delete the voice profile */
  app.delete(
    "/api/projects/:id/voice-profile",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const project = await verifyProjectOwnership(req, res, req.params.id);
        if (!project) return;

        await projectStorage.updateProject(req.params.id, {
          voiceProfile: null,
          voiceProfileSamples: null,
        } as any);

        res.json({ success: true });
      } catch (error) {
        logger.error({ err: error }, "Error deleting voice profile:");
        res.status(500).json({ error: "Failed to delete voice profile" });
      }
    },
  );
}
