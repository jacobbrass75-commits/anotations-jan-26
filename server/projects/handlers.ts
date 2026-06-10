import type { Express, Request, Response } from "express";
import { hasTokenBudgetAvailable, requireAuth } from "../auth";
import { aiLimiter } from "../rateLimits";
import { projectStorage } from "../projectStorage";
import { generateProjectContextSummary } from "../contextGenerator";
import { createTokenUsageAccumulator } from "../aiUsage";
import { registerProjectAnalysisRoutes } from "./analysisHandlers";
import { registerCitationRoutes } from "./citationHandlers";
import {
  verifyFolderOwnership,
  verifyProjectOwnership,
  verifyPromptTemplateOwnership,
  registerProjectDocumentRoutes,
} from "./documentHandlers";
import { registerProjectSearchRoutes } from "./searchHandlers";
import { registerVoiceProfileRoutes } from "./voiceProfileHandlers";
import { insertProjectSchema, insertFolderSchema } from "@shared/schema";

const updateProjectSchema = insertProjectSchema
  .omit({ userId: true })
  .pick({
    name: true,
    description: true,
    thesis: true,
    scope: true,
    voiceProfile: true,
    voiceProfileSamples: true,
  })
  .partial()
  .strict();

export function registerProjectRoutes(app: Express): void {
  // === PROJECTS ===

  app.post("/api/projects", requireAuth, aiLimiter, async (req: Request, res: Response) => {
    try {
      const validated = insertProjectSchema.parse(req.body);
      const thesis = typeof validated.thesis === "string" ? validated.thesis : "";
      const scope = typeof validated.scope === "string" ? validated.scope : "";
      const shouldGenerateContext = Boolean(thesis && scope);
      const canGenerateContext = shouldGenerateContext && (await hasTokenBudgetAvailable(req));

      const project = await projectStorage.createProject({
        ...validated,
        userId: req.user!.userId,
      } as any);

      // Context generation is optional - don't block project creation
      if (canGenerateContext) {
        const tokenUsage = createTokenUsageAccumulator();
        try {
          const contextSummary = await generateProjectContextSummary(
            thesis,
            scope,
            [],
            tokenUsage.add,
          );
          // Embeddings may not be available, store context summary without embedding
          await projectStorage.updateProject(project.id, { contextSummary });
        } catch (contextError) {
          console.warn("Context generation failed (non-blocking):", contextError);
        } finally {
          await tokenUsage.flush(req.user!.userId, "project_context_create");
        }
      }

      res.status(201).json(project);
    } catch (error) {
      console.error("Error creating project:", error);
      res.status(400).json({ error: "Failed to create project" });
    }
  });

  app.get("/api/projects", requireAuth, async (req: Request, res: Response) => {
    try {
      const projects = await projectStorage.getAllProjects(req.user!.userId);
      res.json(projects);
    } catch (error) {
      console.error("Error fetching projects:", error);
      res.status(500).json({ error: "Failed to fetch projects" });
    }
  });

  app.get("/api/projects/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const project = await verifyProjectOwnership(req, res, req.params.id);
      if (!project) return;
      res.json(project);
    } catch (error) {
      console.error("Error fetching project:", error);
      res.status(500).json({ error: "Failed to fetch project" });
    }
  });

  app.put("/api/projects/:id", requireAuth, aiLimiter, async (req: Request, res: Response) => {
    try {
      const project = await verifyProjectOwnership(req, res, req.params.id);
      if (!project) return;
      const parsedProjectUpdates = updateProjectSchema.safeParse(req.body ?? {});
      if (!parsedProjectUpdates.success) {
        return res.status(400).json({ error: "Invalid project update" });
      }
      const safeProjectUpdates = parsedProjectUpdates.data;
      const shouldGenerateContext = Boolean(safeProjectUpdates.thesis || safeProjectUpdates.scope);
      const canGenerateContext = shouldGenerateContext && (await hasTokenBudgetAvailable(req));

      const updated = await projectStorage.updateProject(req.params.id, safeProjectUpdates);
      if (!updated) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Context generation is optional - don't block project update
      if (canGenerateContext) {
        const tokenUsage = createTokenUsageAccumulator();
        try {
          const projectDocs = await projectStorage.getProjectDocumentsByProject(req.params.id);
          const docContexts = projectDocs
            .map((pd) => pd.retrievalContext)
            .filter((c): c is string => !!c);

          const contextSummary = await generateProjectContextSummary(
            updated.thesis || "",
            updated.scope || "",
            docContexts,
            tokenUsage.add,
          );
          await projectStorage.updateProject(req.params.id, { contextSummary });
        } catch (contextError) {
          console.warn("Context generation failed (non-blocking):", contextError);
        } finally {
          await tokenUsage.flush(req.user!.userId, "project_context_update");
        }
      }

      res.json(updated);
    } catch (error) {
      console.error("Error updating project:", error);
      res.status(500).json({ error: "Failed to update project" });
    }
  });

  app.delete("/api/projects/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const project = await verifyProjectOwnership(req, res, req.params.id);
      if (!project) return;
      await projectStorage.deleteProject(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting project:", error);
      res.status(500).json({ error: "Failed to delete project" });
    }
  });

  // === PROMPT TEMPLATES ===

  app.post(
    "/api/projects/:projectId/prompt-templates",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { name, prompts } = req.body;
        if (!name || typeof name !== "string") {
          return res.status(400).json({ error: "Template name is required" });
        }
        if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
          return res.status(400).json({ error: "At least one prompt is required" });
        }
        const project = await verifyProjectOwnership(req, res, req.params.projectId);
        if (!project) return;

        const template = await projectStorage.createPromptTemplate({
          projectId: req.params.projectId,
          name,
          prompts,
        });
        res.status(201).json(template);
      } catch (error) {
        console.error("Error creating prompt template:", error);
        res.status(500).json({ error: "Failed to create prompt template" });
      }
    },
  );

  app.get(
    "/api/projects/:projectId/prompt-templates",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const project = await verifyProjectOwnership(req, res, req.params.projectId);
        if (!project) return;
        const templates = await projectStorage.getPromptTemplatesByProject(req.params.projectId);
        res.json(templates);
      } catch (error) {
        console.error("Error fetching prompt templates:", error);
        res.status(500).json({ error: "Failed to fetch prompt templates" });
      }
    },
  );

  app.put("/api/prompt-templates/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { name, prompts } = req.body;
      const template = await verifyPromptTemplateOwnership(req, res, req.params.id);
      if (!template) return;
      const updated = await projectStorage.updatePromptTemplate(req.params.id, {
        ...(name && { name }),
        ...(prompts && { prompts }),
      });
      if (!updated) {
        return res.status(404).json({ error: "Template not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating prompt template:", error);
      res.status(500).json({ error: "Failed to update prompt template" });
    }
  });

  app.delete("/api/prompt-templates/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const template = await verifyPromptTemplateOwnership(req, res, req.params.id);
      if (!template) return;
      await projectStorage.deletePromptTemplate(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting prompt template:", error);
      res.status(500).json({ error: "Failed to delete prompt template" });
    }
  });

  // === FOLDERS ===

  app.post("/api/projects/:projectId/folders", requireAuth, async (req: Request, res: Response) => {
    try {
      const project = await verifyProjectOwnership(req, res, req.params.projectId);
      if (!project) return;
      const validated = insertFolderSchema.parse({
        ...req.body,
        projectId: req.params.projectId,
      });
      const folder = await projectStorage.createFolder(validated);
      res.status(201).json(folder);
    } catch (error) {
      console.error("Error creating folder:", error);
      res.status(400).json({ error: "Failed to create folder" });
    }
  });

  app.get("/api/projects/:projectId/folders", requireAuth, async (req: Request, res: Response) => {
    try {
      const project = await verifyProjectOwnership(req, res, req.params.projectId);
      if (!project) return;
      const folders = await projectStorage.getFoldersByProject(req.params.projectId);
      res.json(folders);
    } catch (error) {
      console.error("Error fetching folders:", error);
      res.status(500).json({ error: "Failed to fetch folders" });
    }
  });

  app.put("/api/folders/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const folder = await verifyFolderOwnership(req, res, req.params.id);
      if (!folder) return;
      const {
        id: _ignoredId,
        projectId: _ignoredProjectId,
        parentFolderId,
        ...safeFolderUpdates
      } = req.body ?? {};
      if (parentFolderId) {
        const parentFolder = await verifyFolderOwnership(req, res, parentFolderId);
        if (!parentFolder) return;
        if (parentFolder.projectId !== folder.projectId) {
          return res.status(400).json({ error: "Parent folder must belong to the same project" });
        }
      }
      const updated = await projectStorage.updateFolder(req.params.id, {
        ...safeFolderUpdates,
        ...(parentFolderId !== undefined ? { parentFolderId: parentFolderId || null } : {}),
      });
      if (!updated) {
        return res.status(404).json({ error: "Folder not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating folder:", error);
      res.status(500).json({ error: "Failed to update folder" });
    }
  });

  app.delete("/api/folders/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const folder = await verifyFolderOwnership(req, res, req.params.id);
      if (!folder) return;
      await projectStorage.deleteFolder(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting folder:", error);
      res.status(500).json({ error: "Failed to delete folder" });
    }
  });

  app.put("/api/folders/:id/move", requireAuth, async (req: Request, res: Response) => {
    try {
      const { parentFolderId } = req.body;
      const folder = await verifyFolderOwnership(req, res, req.params.id);
      if (!folder) return;
      if (parentFolderId) {
        const parentFolder = await verifyFolderOwnership(req, res, parentFolderId);
        if (!parentFolder) return;
        if (parentFolder.projectId !== folder.projectId) {
          return res.status(400).json({ error: "Parent folder must belong to the same project" });
        }
      }
      const updated = await projectStorage.moveFolder(req.params.id, parentFolderId || null);
      if (!updated) {
        return res.status(404).json({ error: "Folder not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error moving folder:", error);
      res.status(500).json({ error: "Failed to move folder" });
    }
  });

  registerProjectDocumentRoutes(app);
  registerProjectAnalysisRoutes(app);
  registerProjectSearchRoutes(app);
  registerCitationRoutes(app);
  registerVoiceProfileRoutes(app);
}
