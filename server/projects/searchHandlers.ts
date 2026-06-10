import type { Express, Request, Response } from "express";
import { checkTokenBudget, requireAuth } from "../auth";
import { aiLimiter } from "../rateLimits";
import { globalSearch, searchProjectDocument } from "../projectSearch";
import { createTokenUsageAccumulator } from "../aiUsage";
import { verifyProjectDocumentOwnership, verifyProjectOwnership } from "./documentHandlers";

export function registerProjectSearchRoutes(app: Express): void {
  // === SEARCH ===

  app.post("/api/projects/:projectId/search", requireAuth, async (req: Request, res: Response) => {
    try {
      const { query, filters, limit } = req.body;

      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "Query is required" });
      }

      const project = await verifyProjectOwnership(req, res, req.params.projectId);
      if (!project) return;
      const results = await globalSearch(req.params.projectId, query, filters, limit);
      res.json(results);
    } catch (error) {
      console.error("Error performing search:", error);
      res.status(500).json({ error: "Failed to perform search" });
    }
  });

  // Search within a single project document
  app.post(
    "/api/project-documents/:id/search",
    requireAuth,
    aiLimiter,
    checkTokenBudget,
    async (req: Request, res: Response) => {
      const tokenUsage = createTokenUsageAccumulator();
      try {
        const { query } = req.body;

        if (!query || typeof query !== "string") {
          return res.status(400).json({ error: "Query is required" });
        }

        const projectDoc = await verifyProjectDocumentOwnership(req, res, req.params.id);
        if (!projectDoc) return;

        const results = await searchProjectDocument(req.params.id, query, tokenUsage.add);
        await tokenUsage.flush(req.user!.userId, "project_document_search");
        res.json(results);
      } catch (error) {
        console.error("Error searching project document:", error);
        res
          .status(500)
          .json({ error: error instanceof Error ? error.message : "Failed to search document" });
      }
    },
  );
}
