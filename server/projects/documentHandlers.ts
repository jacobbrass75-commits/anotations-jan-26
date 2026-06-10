import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { hasTokenBudgetAvailable, requireAuth } from "../auth";
import { aiLimiter } from "../rateLimits";
import { projectStorage } from "../projectStorage";
import { buildAnnotationSearchIndex, generateRetrievalContext } from "../contextGenerator";
import { db } from "../db";
import { storage } from "../storage";
import { isSourceRole } from "../sourceRoles";
import { extractCitationMetadata } from "../openai";
import { createTokenUsageAccumulator } from "../aiUsage";
import {
  insertProjectDocumentSchema,
  insertProjectAnnotationSchema,
  citationDataSchema,
  batchAddDocumentsRequestSchema,
  projectDocuments,
  type BatchAddDocumentResult,
  type BatchAddDocumentsResponse,
} from "@shared/schema";
import { createLogger } from "../logger";

const logger = createLogger("projects/documentHandlers");

/** Verify the project belongs to the requesting user. Returns the project or sends 403/404. */
export async function verifyProjectOwnership(req: Request, res: Response, projectId: string) {
  const project = await projectStorage.getProject(projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return null;
  }
  if (project.userId !== req.user!.userId) {
    res.status(403).json({ error: "Access denied" });
    return null;
  }
  return project;
}

export async function verifyFolderOwnership(req: Request, res: Response, folderId: string) {
  const folder = await projectStorage.getFolder(folderId);
  if (!folder) {
    res.status(404).json({ error: "Folder not found" });
    return null;
  }

  const project = await verifyProjectOwnership(req, res, folder.projectId);
  if (!project) return null;

  return folder;
}

export async function verifyPromptTemplateOwnership(
  req: Request,
  res: Response,
  templateId: string,
) {
  const template = await projectStorage.getPromptTemplate(templateId);
  if (!template) {
    res.status(404).json({ error: "Template not found" });
    return null;
  }

  const project = await verifyProjectOwnership(req, res, template.projectId);
  if (!project) return null;

  return template;
}

export async function verifyDocumentOwnership(req: Request, res: Response, documentId: string) {
  const doc = await storage.getDocument(documentId);
  if (!doc || doc.userId !== req.user!.userId) {
    res.status(404).json({ error: "Document not found" });
    return null;
  }
  return doc;
}

/** Verify a project_document exists and belongs to the requesting user. */
export async function verifyProjectDocumentOwnership(
  req: Request,
  res: Response,
  projectDocumentId: string,
) {
  const projectDoc = await projectStorage.getProjectDocument(projectDocumentId);
  if (!projectDoc) {
    res.status(404).json({ error: "Project document not found" });
    return null;
  }

  const project = await verifyProjectOwnership(req, res, projectDoc.projectId);
  if (!project) {
    return null;
  }

  const doc = await storage.getDocument(projectDoc.documentId);
  if (!doc || doc.userId !== req.user!.userId) {
    res.status(404).json({ error: "Project document not found" });
    return null;
  }

  return projectDoc;
}

export function registerProjectDocumentRoutes(app: Express): void {
  // === PROJECT DOCUMENTS ===

  app.post(
    "/api/projects/:projectId/documents",
    requireAuth,
    aiLimiter,
    async (req: Request, res: Response) => {
      try {
        const project = await verifyProjectOwnership(req, res, req.params.projectId);
        if (!project) return;
        const validated = insertProjectDocumentSchema.parse({
          ...req.body,
          projectId: req.params.projectId,
        });
        const doc = await verifyDocumentOwnership(req, res, validated.documentId);
        if (!doc) return;
        if (validated.folderId) {
          const folder = await verifyFolderOwnership(req, res, validated.folderId);
          if (!folder) return;
          if (folder.projectId !== req.params.projectId) {
            return res.status(400).json({ error: "Folder must belong to the selected project" });
          }
        }

        const projectDoc = await projectStorage.addDocumentToProject(validated);

        // Context and citation generation - don't block document addition
        try {
          if (doc && project && (await hasTokenBudgetAvailable(req))) {
            const tokenUsage = createTokenUsageAccumulator();
            // Generate retrieval context
            let retrievalContext = "";
            try {
              retrievalContext = await generateRetrievalContext(
                doc.summary || "",
                doc.mainArguments || [],
                doc.keyConcepts || [],
                project.thesis || "",
                validated.roleInProject || "",
                tokenUsage.add,
              );

              // Auto-extract citation metadata using AI
              let citationData = null;
              try {
                citationData = await extractCitationMetadata(
                  doc.fullText,
                  undefined,
                  tokenUsage.add,
                );
                logger.info(`[Citation] Auto-extracted citation for ${doc.filename}`);
              } catch (citationError) {
                logger.warn({ err: citationError }, "Citation extraction failed (non-blocking):");
              }

              await projectStorage.updateProjectDocument(projectDoc.id, {
                retrievalContext,
                ...(citationData && { citationData }),
              });
            } finally {
              await tokenUsage.flush(req.user!.userId, "project_document_context");
            }
          }
        } catch (contextError) {
          logger.warn({ err: contextError }, "Context generation failed (non-blocking):");
        }

        res.status(201).json(projectDoc);
      } catch (error) {
        logger.error({ err: error }, "Error adding document to project:");
        res.status(400).json({ error: "Failed to add document to project" });
      }
    },
  );

  app.get(
    "/api/projects/:projectId/documents",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const project = await verifyProjectOwnership(req, res, req.params.projectId);
        if (!project) return;
        const documents = await projectStorage.getProjectDocumentsByProject(req.params.projectId);
        res.json(documents);
      } catch (error) {
        logger.error({ err: error }, "Error fetching project documents:");
        res.status(500).json({ error: "Failed to fetch project documents" });
      }
    },
  );

  app.post(
    "/api/projects/:projectId/documents/batch",
    requireAuth,
    aiLimiter,
    async (req: Request, res: Response) => {
      try {
        const validated = batchAddDocumentsRequestSchema.parse(req.body);
        const { documentIds, folderId } = validated;
        const projectId = req.params.projectId;

        const project = await verifyProjectOwnership(req, res, projectId);
        if (!project) {
          return;
        }
        if (folderId) {
          const folder = await verifyFolderOwnership(req, res, folderId);
          if (!folder) return;
          if (folder.projectId !== projectId) {
            return res.status(400).json({ error: "Folder must belong to the selected project" });
          }
        }

        const existingDocs = await projectStorage.getProjectDocumentsByProject(projectId);
        const existingDocIds = new Set(existingDocs.map((d) => d.documentId));
        const canGenerateContext = await hasTokenBudgetAvailable(req);

        const results: BatchAddDocumentResult[] = [];
        let added = 0;
        let alreadyExists = 0;
        let failed = 0;

        for (const documentId of documentIds) {
          try {
            const doc = await storage.getDocument(documentId);
            if (!doc || doc.userId !== req.user!.userId) {
              results.push({
                documentId,
                filename: "Unknown",
                status: "failed",
                error: "Document not found",
              });
              failed++;
              continue;
            }

            if (existingDocIds.has(documentId)) {
              results.push({
                documentId,
                filename: doc.filename,
                status: "already_exists",
              });
              alreadyExists++;
              continue;
            }

            const projectDoc = await projectStorage.addDocumentToProject({
              projectId,
              documentId,
              folderId: folderId || null,
            });

            results.push({
              documentId,
              filename: doc.filename,
              status: "added",
              projectDocumentId: projectDoc.id,
            });
            added++;
            existingDocIds.add(documentId);

            if (canGenerateContext) {
              const tokenUsage = createTokenUsageAccumulator();
              generateRetrievalContext(
                doc.summary || "",
                doc.mainArguments || [],
                doc.keyConcepts || [],
                project.thesis || "",
                "",
                tokenUsage.add,
              )
                .then(async (retrievalContext) => {
                  await projectStorage.updateProjectDocument(projectDoc.id, { retrievalContext });
                  await tokenUsage.flush(req.user!.userId, "project_batch_document_context");
                })
                .catch(async (err) => {
                  await tokenUsage.flush(req.user!.userId, "project_batch_document_context");
                  logger.warn({ err: err }, "Context generation failed (non-blocking):");
                });
            }
          } catch (error) {
            results.push({
              documentId,
              filename: "Unknown",
              status: "failed",
              error: error instanceof Error ? error.message : "Unknown error",
            });
            failed++;
          }
        }

        const response: BatchAddDocumentsResponse = {
          totalRequested: documentIds.length,
          added,
          alreadyExists,
          failed,
          results,
        };

        res.status(201).json(response);
      } catch (error) {
        logger.error({ err: error }, "Error in batch add documents:");
        res.status(400).json({ error: "Failed to add documents" });
      }
    },
  );

  app.get("/api/project-documents/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectDoc = await verifyProjectDocumentOwnership(req, res, req.params.id);
      if (!projectDoc) return;
      res.json(projectDoc);
    } catch (error) {
      logger.error({ err: error }, "Error fetching project document:");
      res.status(500).json({ error: "Failed to fetch project document" });
    }
  });

  app.put("/api/project-documents/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectDoc = await verifyProjectDocumentOwnership(req, res, req.params.id);
      if (!projectDoc) return;
      const { sourceRole, ...otherFields } = req.body ?? {};
      const {
        id: _ignoredId,
        projectId: _ignoredProjectId,
        documentId: _ignoredDocumentId,
        folderId,
        ...safeProjectDocumentUpdates
      } = otherFields;

      if (folderId !== undefined && folderId !== null && folderId !== "") {
        const folder = await verifyFolderOwnership(req, res, folderId);
        if (!folder) return;
        if (folder.projectId !== projectDoc.projectId) {
          return res.status(400).json({ error: "Folder must belong to the selected project" });
        }
      }

      if (sourceRole !== undefined && sourceRole !== null && !isSourceRole(sourceRole)) {
        return res.status(400).json({ error: "Invalid sourceRole" });
      }

      let updated =
        Object.keys(safeProjectDocumentUpdates).length > 0 || folderId !== undefined
          ? await projectStorage.updateProjectDocument(req.params.id, {
              ...safeProjectDocumentUpdates,
              ...(folderId !== undefined ? { folderId: folderId || null } : {}),
            })
          : await projectStorage.getProjectDocument(req.params.id);

      if (sourceRole && isSourceRole(sourceRole)) {
        const [sourceRoleUpdated] = await db
          .update(projectDocuments)
          .set({ sourceRole })
          .where(eq(projectDocuments.id, req.params.id))
          .returning();
        updated = sourceRoleUpdated;
      }

      if (!updated) {
        return res.status(404).json({ error: "Project document not found" });
      }
      res.json(updated);
    } catch (error) {
      logger.error({ err: error }, "Error updating project document:");
      res.status(500).json({ error: "Failed to update project document" });
    }
  });

  app.delete("/api/project-documents/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectDoc = await verifyProjectDocumentOwnership(req, res, req.params.id);
      if (!projectDoc) return;
      await projectStorage.removeDocumentFromProject(req.params.id);
      res.status(204).send();
    } catch (error) {
      logger.error({ err: error }, "Error removing document from project:");
      res.status(500).json({ error: "Failed to remove document from project" });
    }
  });

  app.put("/api/project-documents/:id/move", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectDoc = await verifyProjectDocumentOwnership(req, res, req.params.id);
      if (!projectDoc) return;
      const { folderId } = req.body;
      if (folderId) {
        const folder = await verifyFolderOwnership(req, res, folderId);
        if (!folder) return;
        if (folder.projectId !== projectDoc.projectId) {
          return res.status(400).json({ error: "Folder must belong to the selected project" });
        }
      }
      const updated = await projectStorage.updateProjectDocument(req.params.id, {
        folderId: folderId || null,
      });
      if (!updated) {
        return res.status(404).json({ error: "Project document not found" });
      }
      res.json(updated);
    } catch (error) {
      logger.error({ err: error }, "Error moving project document:");
      res.status(500).json({ error: "Failed to move project document" });
    }
  });

  app.put(
    "/api/project-documents/:id/citation",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const projectDoc = await verifyProjectDocumentOwnership(req, res, req.params.id);
        if (!projectDoc) return;
        const citationData = citationDataSchema.parse(req.body);
        const updated = await projectStorage.updateProjectDocument(req.params.id, {
          citationData,
        });
        if (!updated) {
          return res.status(404).json({ error: "Project document not found" });
        }
        res.json(updated);
      } catch (error) {
        logger.error({ err: error }, "Error updating citation data:");
        res.status(400).json({ error: "Failed to update citation data" });
      }
    },
  );

  // === PROJECT ANNOTATIONS ===

  app.post(
    "/api/project-documents/:id/annotations",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const projectDoc = await verifyProjectDocumentOwnership(req, res, req.params.id);
        if (!projectDoc) return;
        const validated = insertProjectAnnotationSchema.parse({
          ...req.body,
          projectDocumentId: req.params.id,
        });

        const annotation = await projectStorage.createProjectAnnotation(validated);

        // Search indexing is optional - don't block annotation creation
        try {
          const searchIndex = await buildAnnotationSearchIndex(
            validated.highlightedText,
            validated.note || null,
            validated.category,
          );
          await projectStorage.updateProjectAnnotation(annotation.id, searchIndex);
        } catch (indexError) {
          logger.warn({ err: indexError }, "Search indexing failed (non-blocking):");
        }

        res.status(201).json(annotation);
      } catch (error) {
        logger.error({ err: error }, "Error creating project annotation:");
        res.status(400).json({ error: "Failed to create annotation" });
      }
    },
  );

  app.get(
    "/api/project-documents/:id/annotations",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const projectDoc = await verifyProjectDocumentOwnership(req, res, req.params.id);
        if (!projectDoc) return;
        const annotations = await projectStorage.getProjectAnnotationsByDocument(req.params.id);
        res.json(annotations);
      } catch (error) {
        logger.error({ err: error }, "Error fetching project annotations:");
        res.status(500).json({ error: "Failed to fetch annotations" });
      }
    },
  );

  app.put("/api/project-annotations/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const annotation = await projectStorage.getProjectAnnotation(req.params.id);
      if (!annotation) {
        return res.status(404).json({ error: "Annotation not found" });
      }

      const projectDoc = await verifyProjectDocumentOwnership(
        req,
        res,
        annotation.projectDocumentId,
      );
      if (!projectDoc) return;

      const updated = await projectStorage.updateProjectAnnotation(req.params.id, req.body);
      if (!updated) {
        return res.status(404).json({ error: "Annotation not found" });
      }
      res.json(updated);
    } catch (error) {
      logger.error({ err: error }, "Error updating project annotation:");
      res.status(500).json({ error: "Failed to update annotation" });
    }
  });

  app.delete("/api/project-annotations/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const annotation = await projectStorage.getProjectAnnotation(req.params.id);
      if (!annotation) {
        return res.status(404).json({ error: "Annotation not found" });
      }

      const projectDoc = await verifyProjectDocumentOwnership(
        req,
        res,
        annotation.projectDocumentId,
      );
      if (!projectDoc) return;

      await projectStorage.deleteProjectAnnotation(req.params.id);
      res.status(204).send();
    } catch (error) {
      logger.error({ err: error }, "Error deleting project annotation:");
      res.status(500).json({ error: "Failed to delete annotation" });
    }
  });

  // === STATE PERSISTENCE ===

  app.put(
    "/api/project-documents/:id/view-state",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const projectDoc = await verifyProjectDocumentOwnership(req, res, req.params.id);
        if (!projectDoc) return;

        const { scrollPosition } = req.body;
        const updated = await projectStorage.updateProjectDocument(req.params.id, {
          lastViewedAt: new Date(),
          scrollPosition: scrollPosition || 0,
        });
        if (!updated) {
          return res.status(404).json({ error: "Project document not found" });
        }
        res.json(updated);
      } catch (error) {
        logger.error({ err: error }, "Error updating view state:");
        res.status(500).json({ error: "Failed to update view state" });
      }
    },
  );
}
