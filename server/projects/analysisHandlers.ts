import { projectStorage } from "../projectStorage";
import { storage } from "../storage";
import {
  cosineSimilarity,
  getEmbeddingWithUsage,
  getMaxChunksForLevel,
  type ThoroughnessLevel,
} from "../openai";
import { processChunksWithPipelineV2 } from "../pipelineV2";
import { buildAnnotationSearchIndex } from "../contextGenerator";
import type { TokenUsageReporter } from "../aiUsage";
import type { Express, Request, Response } from "express";
import { checkTokenBudget, requireAuth } from "../auth";
import { aiLimiter } from "../rateLimits";
import { createTokenUsageAccumulator } from "../aiUsage";
import { generateAutoAnnotationPrompts } from "../openai";
import { processChunksWithMultiplePrompts } from "../pipelineV2";
import { batchProcess } from "../replit_integrations/batch/utils";
import { randomUUID } from "crypto";
import {
  batchAnalysisRequestSchema,
  type AnnotationCategory,
  type BatchAnalysisResponse,
  type BatchDocumentResult,
} from "@shared/schema";
import { verifyProjectDocumentOwnership, verifyProjectOwnership } from "./documentHandlers";
import { createLogger } from "../logger";

const logger = createLogger("projects/analysisHandlers");

export interface AnalysisConstraints {
  categories?: AnnotationCategory[];
  maxAnnotationsPerDoc?: number;
  minConfidence?: number;
  thoroughness?: ThoroughnessLevel;
}

export async function analyzeProjectDocument(
  projectDocId: string,
  intent: string,
  constraints?: AnalysisConstraints,
  onTokenUsage?: TokenUsageReporter,
): Promise<{
  annotationsCreated: number;
  filename: string;
  chunksAnalyzed: number;
  totalChunks: number;
}> {
  const projectDoc = await projectStorage.getProjectDocument(projectDocId);
  if (!projectDoc) {
    throw new Error("Project document not found");
  }

  const doc = await storage.getDocument(projectDoc.documentId);
  if (!doc) {
    throw new Error("Document not found");
  }

  const project = await projectStorage.getProject(projectDoc.projectId);

  const fullIntent = project?.thesis
    ? `Project thesis: ${project.thesis}\n\nResearch focus: ${intent}`
    : intent;

  const chunks = await storage.getChunksForDocument(doc.id);
  if (chunks.length === 0) {
    throw new Error("No text chunks found for analysis");
  }

  const thoroughness = constraints?.thoroughness || "standard";
  const maxChunks = getMaxChunksForLevel(thoroughness);

  let topChunks: { text: string; startPosition: number; id: string }[];

  try {
    const intentEmbedding = await getEmbeddingWithUsage(fullIntent, onTokenUsage);

    const chunksWithEmbeddings = await Promise.all(
      chunks.map(async (chunk) => {
        if (!chunk.embedding) {
          try {
            const embedding = await getEmbeddingWithUsage(chunk.text, onTokenUsage);
            await storage.updateChunkEmbedding(chunk.id, embedding);
            return { ...chunk, embedding };
          } catch {
            return chunk;
          }
        }
        return chunk;
      }),
    );

    const rankedChunks = chunksWithEmbeddings
      .filter((c) => c.embedding)
      .map((chunk) => ({
        chunk,
        similarity: cosineSimilarity(chunk.embedding!, intentEmbedding),
      }))
      .sort((a, b) => b.similarity - a.similarity);

    const minSimilarity = thoroughness === "exhaustive" ? 0.1 : 0.3;

    topChunks = rankedChunks
      .filter(({ similarity }) => similarity >= minSimilarity)
      .slice(0, maxChunks)
      .map(({ chunk }) => ({
        text: chunk.text,
        startPosition: chunk.startPosition,
        id: chunk.id,
      }));

    if (topChunks.length === 0) {
      topChunks = chunks.slice(0, maxChunks).map((chunk) => ({
        text: chunk.text,
        startPosition: chunk.startPosition,
        id: chunk.id,
      }));
    }
  } catch (embeddingError) {
    logger.warn({ err: embeddingError }, "Embedding-based ranking failed, using document order:");
    topChunks = chunks.slice(0, maxChunks).map((chunk) => ({
      text: chunk.text,
      startPosition: chunk.startPosition,
      id: chunk.id,
    }));
  }

  logger.info(`Analyzing ${topChunks.length} of ${chunks.length} chunks (${thoroughness} mode)`);

  const existingAnnotations = await projectStorage.getProjectAnnotationsByDocument(projectDocId);
  const existingUserAnnotations = existingAnnotations.filter(
    (annotation) => !annotation.isAiGenerated,
  );
  const existingAnnotationPositions = existingUserAnnotations.map((a) => ({
    startPosition: a.startPosition,
    endPosition: a.endPosition,
    confidenceScore: a.confidenceScore,
  }));

  // Use V2 pipeline for improved annotation quality
  let pipelineAnnotations: Awaited<ReturnType<typeof processChunksWithPipelineV2>>;
  try {
    pipelineAnnotations = await processChunksWithPipelineV2(
      topChunks,
      fullIntent,
      doc.id,
      doc.fullText,
      existingAnnotationPositions,
      { onTokenUsage },
    );
  } catch (pipelineError) {
    logger.error(
      {
        projectDocumentId: projectDocId,
        documentId: doc.id,
        error: pipelineError instanceof Error ? pipelineError.message : String(pipelineError),
      },
      "[ProjectAnalyze] Pipeline failed",
    );
    throw new Error("AI pipeline failed while processing document chunks", {
      cause: pipelineError,
    });
  }

  if (constraints?.categories && constraints.categories.length > 0) {
    pipelineAnnotations = pipelineAnnotations.filter((ann) =>
      constraints.categories!.includes(ann.category as AnnotationCategory),
    );
  }

  if (constraints?.minConfidence) {
    pipelineAnnotations = pipelineAnnotations.filter(
      (ann) => ann.confidence >= constraints.minConfidence!,
    );
  }

  if (constraints?.maxAnnotationsPerDoc) {
    pipelineAnnotations = pipelineAnnotations.slice(0, constraints.maxAnnotationsPerDoc);
  }

  // Replace prior AI annotations for single-prompt runs while preserving manual/user annotations.
  const priorAiAnnotations = existingAnnotations.filter((annotation) => annotation.isAiGenerated);
  if (pipelineAnnotations.length > 0 && priorAiAnnotations.length > 0) {
    await Promise.all(
      priorAiAnnotations.map((annotation) => projectStorage.deleteProjectAnnotation(annotation.id)),
    );
  }

  for (const ann of pipelineAnnotations) {
    const created = await projectStorage.createProjectAnnotation({
      projectDocumentId: projectDocId,
      startPosition: ann.absoluteStart,
      endPosition: ann.absoluteEnd,
      highlightedText: ann.highlightText,
      category: ann.category as AnnotationCategory,
      note: ann.note,
      isAiGenerated: true,
      confidenceScore: ann.confidence,
    });

    buildAnnotationSearchIndex(ann.highlightText, ann.note, ann.category as AnnotationCategory)
      .then((searchIndex) => {
        projectStorage.updateProjectAnnotation(created.id, searchIndex);
      })
      .catch((err) => logger.warn({ err: err }, "Search indexing failed (non-blocking):"));
  }

  return {
    annotationsCreated: pipelineAnnotations.length,
    filename: doc.filename,
    chunksAnalyzed: topChunks.length,
    totalChunks: chunks.length,
  };
}

// Default color palette for multi-prompt analysis
const PROMPT_COLORS = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#22c55e", // green
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
];

function getDefaultPromptColor(index: number): string {
  return PROMPT_COLORS[index % PROMPT_COLORS.length];
}

export function registerProjectAnalysisRoutes(app: Express): void {
  // === AI ANALYSIS ===

  app.post(
    "/api/project-documents/:id/analyze",
    requireAuth,
    aiLimiter,
    checkTokenBudget,
    async (req: Request, res: Response) => {
      const tokenUsage = createTokenUsageAccumulator();
      try {
        const { intent, thoroughness } = req.body;
        if (!intent || typeof intent !== "string") {
          return res.status(400).json({ error: "Research intent is required" });
        }

        const projectDoc = await verifyProjectDocumentOwnership(req, res, req.params.id);
        if (!projectDoc) return;

        const validThoroughness = ["quick", "standard", "thorough", "exhaustive"].includes(
          thoroughness,
        )
          ? (thoroughness as ThoroughnessLevel)
          : "standard";

        const startTime = Date.now();
        logger.info(
          {
            projectDocumentId: req.params.id,
            projectId: projectDoc.projectId,
            documentId: projectDoc.documentId,
            userId: req.user?.userId,
            thoroughness: validThoroughness,
          },
          "[ProjectAnalyze] Starting single-prompt analysis",
        );

        const result = await analyzeProjectDocument(
          req.params.id,
          intent,
          { thoroughness: validThoroughness },
          tokenUsage.add,
        );
        const finalAnnotations = await projectStorage.getProjectAnnotationsByDocument(
          req.params.id,
        );

        logger.info(
          {
            projectDocumentId: req.params.id,
            chunksAnalyzed: result.chunksAnalyzed,
            totalChunks: result.totalChunks,
            annotationsCreated: result.annotationsCreated,
            totalAnnotationsOnDocument: finalAnnotations.length,
            durationMs: Date.now() - startTime,
          },
          "[ProjectAnalyze] Completed single-prompt analysis",
        );

        await tokenUsage.flush(req.user!.userId, "project_document_analysis");
        res.json({
          annotations: finalAnnotations,
          stats: {
            chunksAnalyzed: result.chunksAnalyzed,
            totalChunks: result.totalChunks,
            annotationsCreated: result.annotationsCreated,
            coverage: Math.round((result.chunksAnalyzed / result.totalChunks) * 100),
          },
        });
      } catch (error) {
        logger.error({ err: error }, "Error analyzing project document:");
        res
          .status(500)
          .json({ error: error instanceof Error ? error.message : "Failed to analyze document" });
      }
    },
  );

  app.post(
    "/api/project-documents/:id/auto-analyze",
    requireAuth,
    aiLimiter,
    checkTokenBudget,
    async (req: Request, res: Response) => {
      const tokenUsage = createTokenUsageAccumulator();
      try {
        const projectDoc = await verifyProjectDocumentOwnership(req, res, req.params.id);
        if (!projectDoc) return;

        const doc = await storage.getDocument(projectDoc.documentId);
        if (!doc) {
          return res.status(404).json({ error: "Document not found" });
        }

        const chunks = await storage.getChunksForDocument(doc.id);
        if (chunks.length === 0) {
          return res.status(400).json({ error: "No text chunks found for analysis yet" });
        }

        const project = await projectStorage.getProject(projectDoc.projectId);
        const prompts = await generateAutoAnnotationPrompts(
          {
            projectName: project?.name,
            projectThesis: project?.thesis,
            projectScope: project?.scope,
            projectDomain: project?.description,
            sourceTitle: doc.filename,
            sourceSummary: doc.summary,
            sourceSample: chunks
              .slice(0, 6)
              .map((chunk) => chunk.text)
              .join("\n\n"),
          },
          tokenUsage.add,
        );

        const intent = [
          "Auto-generate project-aware annotations for this source.",
          "Use the following six annotation prompts as priorities:",
          ...prompts.map((prompt, index) => `${index + 1}. ${prompt}`),
        ].join("\n");

        const startTime = Date.now();
        const result = await analyzeProjectDocument(
          req.params.id,
          intent,
          { thoroughness: "quick", maxAnnotationsPerDoc: 18 },
          tokenUsage.add,
        );
        const finalAnnotations = await projectStorage.getProjectAnnotationsByDocument(
          req.params.id,
        );

        await tokenUsage.flush(req.user!.userId, "project_document_auto_analysis");
        res.json({
          prompts,
          annotations: finalAnnotations,
          stats: {
            chunksAnalyzed: result.chunksAnalyzed,
            totalChunks: result.totalChunks,
            annotationsCreated: result.annotationsCreated,
            coverage: Math.round((result.chunksAnalyzed / result.totalChunks) * 100),
            durationMs: Date.now() - startTime,
          },
        });
      } catch (error) {
        logger.error({ err: error }, "Error auto-analyzing project document:");
        res.status(500).json({
          error: error instanceof Error ? error.message : "Failed to auto-analyze document",
        });
      }
    },
  );

  // Multi-prompt parallel analysis
  app.post(
    "/api/project-documents/:id/analyze-multi",
    requireAuth,
    aiLimiter,
    checkTokenBudget,
    async (req: Request, res: Response) => {
      const tokenUsage = createTokenUsageAccumulator();
      try {
        const { prompts, thoroughness } = req.body;

        if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
          return res.status(400).json({ error: "At least one prompt is required" });
        }

        // Validate prompts structure
        for (const prompt of prompts) {
          if (!prompt.text || typeof prompt.text !== "string") {
            return res.status(400).json({ error: "Each prompt must have a text field" });
          }
        }

        const validThoroughness = ["quick", "standard", "thorough", "exhaustive"].includes(
          thoroughness,
        )
          ? (thoroughness as ThoroughnessLevel)
          : "standard";

        const projectDocId = req.params.id;
        const projectDoc = await verifyProjectDocumentOwnership(req, res, projectDocId);
        if (!projectDoc) return;

        const doc = await storage.getDocument(projectDoc.documentId);
        if (!doc) {
          return res.status(404).json({ error: "Document not found" });
        }

        const project = await projectStorage.getProject(projectDoc.projectId);
        const chunks = await storage.getChunksForDocument(doc.id);

        if (chunks.length === 0) {
          return res.status(400).json({ error: "No text chunks found for analysis" });
        }

        // Rank chunks by similarity (using first prompt for ranking, or document order)
        const maxChunks = getMaxChunksForLevel(validThoroughness);
        let topChunks: { text: string; startPosition: number; id: string }[];

        try {
          const firstPromptIntent = project?.thesis
            ? `Project thesis: ${project.thesis}\n\nResearch focus: ${prompts[0].text}`
            : prompts[0].text;
          const intentEmbedding = await getEmbeddingWithUsage(firstPromptIntent, tokenUsage.add);

          const chunksWithEmbeddings = await Promise.all(
            chunks.map(async (chunk) => {
              if (!chunk.embedding) {
                try {
                  const embedding = await getEmbeddingWithUsage(chunk.text, tokenUsage.add);
                  await storage.updateChunkEmbedding(chunk.id, embedding);
                  return { ...chunk, embedding };
                } catch {
                  return chunk;
                }
              }
              return chunk;
            }),
          );

          const rankedChunks = chunksWithEmbeddings
            .filter((c) => c.embedding)
            .map((chunk) => ({
              chunk,
              similarity: cosineSimilarity(chunk.embedding!, intentEmbedding),
            }))
            .sort((a, b) => b.similarity - a.similarity);

          const minSimilarity = validThoroughness === "exhaustive" ? 0.1 : 0.3;
          topChunks = rankedChunks
            .filter(({ similarity }) => similarity >= minSimilarity)
            .slice(0, maxChunks)
            .map(({ chunk }) => ({
              text: chunk.text,
              startPosition: chunk.startPosition,
              id: chunk.id,
            }));

          if (topChunks.length === 0) {
            topChunks = chunks.slice(0, maxChunks).map((chunk) => ({
              text: chunk.text,
              startPosition: chunk.startPosition,
              id: chunk.id,
            }));
          }
        } catch {
          topChunks = chunks.slice(0, maxChunks).map((chunk) => ({
            text: chunk.text,
            startPosition: chunk.startPosition,
            id: chunk.id,
          }));
        }

        // Keep both user and prior AI annotations so analyses can accumulate over time.
        const existingAnnotations =
          await projectStorage.getProjectAnnotationsByDocument(projectDocId);
        const existingAnnotationPositions = existingAnnotations.map((a) => ({
          startPosition: a.startPosition,
          endPosition: a.endPosition,
          confidenceScore: a.confidenceScore,
        }));

        // Ensure prompt indices continue across runs so prior prompt groups remain distinct.
        const maxExistingPromptIndex = existingAnnotations.reduce((max, ann) => {
          if (ann.promptIndex == null) return max;
          return ann.promptIndex > max ? ann.promptIndex : max;
        }, -1);
        const promptIndexBase = maxExistingPromptIndex + 1;

        // Prepare prompts with colors and indices
        const promptsWithMeta = prompts.map(
          (p: { text: string; color?: string }, localIndex: number) => ({
            text: project?.thesis
              ? `Project thesis: ${project.thesis}\n\nResearch focus: ${p.text}`
              : p.text,
            color: p.color || getDefaultPromptColor(promptIndexBase + localIndex),
            index: promptIndexBase + localIndex,
            localIndex,
          }),
        );

        // Generate analysis run ID
        const analysisRunId = randomUUID();

        const startTime = Date.now();
        logger.info(
          `Multi-prompt analysis: ${prompts.length} prompts on ${topChunks.length} chunks`,
        );
        logger.info(
          {
            analysisRunId,
            projectDocumentId: projectDocId,
            projectId: projectDoc.projectId,
            documentId: projectDoc.documentId,
            promptCount: prompts.length,
            chunksAnalyzed: topChunks.length,
            totalChunks: chunks.length,
            userId: req.user?.userId,
            thoroughness: validThoroughness,
          },
          "[ProjectAnalyze] Starting multi-prompt analysis",
        );

        // Run all prompts in parallel
        const resultsMap = await processChunksWithMultiplePrompts(
          topChunks,
          promptsWithMeta,
          doc.id,
          doc.fullText,
          existingAnnotationPositions,
          { onTokenUsage: tokenUsage.add },
        );

        // Create annotations with prompt metadata
        const results: Array<{
          promptIndex: number;
          promptText: string;
          annotationsCreated: number;
        }> = [];
        let totalAnnotations = 0;

        for (const [promptIndex, annotations] of Array.from(resultsMap.entries())) {
          const promptMeta = promptsWithMeta.find((p) => p.index === promptIndex);
          if (!promptMeta) continue;
          const originalPrompt = prompts[promptMeta.localIndex];
          let created = 0;

          for (const ann of annotations) {
            const createdAnnotation = await projectStorage.createProjectAnnotation({
              projectDocumentId: projectDocId,
              startPosition: ann.absoluteStart,
              endPosition: ann.absoluteEnd,
              highlightedText: ann.highlightText,
              category: ann.category as AnnotationCategory,
              note: ann.note,
              isAiGenerated: true,
              confidenceScore: ann.confidence,
              promptText: originalPrompt.text,
              promptIndex,
              promptColor: promptMeta.color,
              analysisRunId,
            });
            created++;

            buildAnnotationSearchIndex(
              ann.highlightText,
              ann.note,
              ann.category as AnnotationCategory,
            )
              .then((searchIndex) => {
                projectStorage.updateProjectAnnotation(createdAnnotation.id, searchIndex);
              })
              .catch((err) => logger.warn({ err: err }, "Search indexing failed (non-blocking):"));
          }

          results.push({
            promptIndex,
            promptText: originalPrompt.text,
            annotationsCreated: created,
          });
          totalAnnotations += created;
        }

        const finalAnnotations = await projectStorage.getProjectAnnotationsByDocument(projectDocId);
        logger.info(
          {
            analysisRunId,
            projectDocumentId: projectDocId,
            promptCount: prompts.length,
            totalAnnotationsCreated: totalAnnotations,
            totalAnnotationsOnDocument: finalAnnotations.length,
            durationMs: Date.now() - startTime,
          },
          "[ProjectAnalyze] Completed multi-prompt analysis",
        );

        await tokenUsage.flush(req.user!.userId, "project_document_multi_analysis");
        res.json({
          analysisRunId,
          results,
          totalAnnotations,
          annotations: finalAnnotations,
          stats: {
            chunksAnalyzed: topChunks.length,
            totalChunks: chunks.length,
            coverage: Math.round((topChunks.length / chunks.length) * 100),
          },
        });
      } catch (error) {
        logger.error({ err: error }, "Error in multi-prompt analysis:");
        res
          .status(500)
          .json({ error: error instanceof Error ? error.message : "Failed to analyze document" });
      }
    },
  );

  app.post(
    "/api/projects/:projectId/batch-analyze",
    requireAuth,
    aiLimiter,
    checkTokenBudget,
    async (req: Request, res: Response) => {
      const tokenUsage = createTokenUsageAccumulator();
      try {
        const validated = batchAnalysisRequestSchema.parse(req.body);
        const { projectDocumentIds, intent, thoroughness, constraints } = validated;

        const startTime = Date.now();
        const jobId = crypto.randomUUID();

        const project = await verifyProjectOwnership(req, res, req.params.projectId);
        if (!project) return;

        const allowedProjectDocumentIds = new Set<string>();
        for (const projectDocumentId of projectDocumentIds) {
          const projectDoc = await projectStorage.getProjectDocument(projectDocumentId);
          const doc = projectDoc ? await storage.getDocument(projectDoc.documentId) : null;
          if (projectDoc?.projectId === req.params.projectId && doc?.userId === req.user!.userId) {
            allowedProjectDocumentIds.add(projectDocumentId);
          }
        }

        const results: BatchDocumentResult[] = projectDocumentIds.map((id) => ({
          projectDocumentId: id,
          filename: "",
          status: "pending" as const,
          annotationsCreated: 0,
        }));

        await batchProcess(
          projectDocumentIds,
          async (docId, index) => {
            try {
              if (!allowedProjectDocumentIds.has(docId)) {
                throw new Error("Project document not found");
              }
              const result = await analyzeProjectDocument(
                docId,
                intent,
                {
                  ...constraints,
                  thoroughness: thoroughness as ThoroughnessLevel,
                },
                tokenUsage.add,
              );
              results[index] = {
                projectDocumentId: docId,
                filename: result.filename,
                status: "completed",
                annotationsCreated: result.annotationsCreated,
              };
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : "Unknown error";
              results[index] = {
                projectDocumentId: docId,
                filename: results[index].filename || "Unknown",
                status: "failed",
                annotationsCreated: 0,
                error: errorMsg,
              };
            }
          },
          { concurrency: 2 },
        );

        const successfulDocs = results.filter((r) => r.status === "completed").length;
        const failedDocs = results.filter((r) => r.status === "failed").length;
        const totalAnnotations = results.reduce((sum, r) => sum + r.annotationsCreated, 0);

        const response: BatchAnalysisResponse = {
          jobId,
          status: failedDocs === 0 ? "completed" : successfulDocs === 0 ? "failed" : "partial",
          totalDocuments: projectDocumentIds.length,
          successfulDocuments: successfulDocs,
          failedDocuments: failedDocs,
          totalAnnotationsCreated: totalAnnotations,
          totalTimeMs: Date.now() - startTime,
          results,
        };

        await tokenUsage.flush(req.user!.userId, "project_batch_analysis");
        res.json(response);
      } catch (error) {
        logger.error({ err: error }, "Error in batch analysis:");
        res.status(500).json({ error: "Failed to process batch analysis" });
      }
    },
  );
}
