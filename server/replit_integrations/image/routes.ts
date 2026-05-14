import type { Express, Request, Response } from "express";
import { checkTokenBudget, requireAuth, requireTier } from "../../auth";
import { openai } from "./client";

const ALLOWED_IMAGE_SIZES = new Set(["1024x1024", "512x512", "256x256"]);
const IMAGE_RATE_LIMIT_WINDOW_MS = 60_000;
const IMAGE_RATE_LIMIT_MAX = 10;
const imageRateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function checkImageRateLimit(userId: string): boolean {
  const now = Date.now();
  const current = imageRateLimitBuckets.get(userId);
  if (!current || current.resetAt <= now) {
    imageRateLimitBuckets.set(userId, { count: 1, resetAt: now + IMAGE_RATE_LIMIT_WINDOW_MS });
    return true;
  }
  current.count += 1;
  return current.count <= IMAGE_RATE_LIMIT_MAX;
}

export function registerImageRoutes(app: Express): void {
  app.post("/api/generate-image", requireAuth, requireTier("pro"), checkTokenBudget, async (req: Request, res: Response) => {
    try {
      const { prompt, size = "1024x1024" } = req.body;
      const normalizedPrompt = typeof prompt === "string" ? prompt.trim() : "";
      const normalizedSize = typeof size === "string" ? size : "1024x1024";

      if (!normalizedPrompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }
      if (normalizedPrompt.length > 4000) {
        return res.status(400).json({ error: "Prompt must be 4000 characters or fewer" });
      }
      if (!ALLOWED_IMAGE_SIZES.has(normalizedSize)) {
        return res.status(400).json({ error: "Unsupported image size" });
      }
      if (!checkImageRateLimit(req.user!.userId)) {
        return res.status(429).json({ error: "Image generation rate limit exceeded" });
      }
      if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
        return res.status(503).json({ error: "Image generation is not configured" });
      }

      const response = await openai.images.generate({
        model: "gpt-image-1",
        prompt: normalizedPrompt,
        n: 1,
        size: normalizedSize as "1024x1024" | "512x512" | "256x256",
      });

      if (!response.data?.[0]) {
        return res.status(500).json({ error: "No image data returned from API" });
      }
      const imageData = response.data[0];
      res.json({
        url: imageData.url,
        b64_json: imageData.b64_json,
      });
    } catch (error) {
      console.error("Image generation failed:", {
        userId: req.user?.userId,
        message: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: "Failed to generate image" });
    }
  });
}
