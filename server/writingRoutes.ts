import type { Express, Request, Response } from "express";
import { projectStorage } from "./projectStorage";
import { storage } from "./storage";
import {
  runWritingPipeline,
  type WritingRequest,
  type AnnotationSource,
  type WritingSSEEvent,
} from "./writingPipeline";
import type { CitationData } from "@shared/schema";

export function registerWritingRoutes(app: Express): void {
  // POST /api/write - Start writing pipeline, stream results via SSE
  app.post("/api/write", async (req: Request, res: Response) => {
    try {
      const body = req.body as Partial<WritingRequest>;

      // Validate required fields
      if (!body.topic || typeof body.topic !== "string" || body.topic.trim().length === 0) {
        return res.status(400).json({ error: "Topic is required" });
      }

      const request: WritingRequest = {
        topic: body.topic.trim(),
        annotationIds: Array.isArray(body.annotationIds) ? body.annotationIds : [],
        projectId: body.projectId || undefined,
        citationStyle: body.citationStyle || "chicago",
        tone: body.tone || "academic",
        targetLength: body.targetLength || "medium",
        noEnDashes: body.noEnDashes ?? false,
        deepWrite: body.deepWrite ?? false,
      };

      // Fetch annotations with citation data
      const annotations: AnnotationSource[] = [];

      if (request.annotationIds.length > 0 && request.projectId) {
        // Get project documents for citation data
        const projectDocs = await projectStorage.getProjectDocumentsByProject(
          request.projectId
        );

        for (const annId of request.annotationIds) {
          // Try project annotations first
          const projectAnn = await projectStorage.getProjectAnnotation(annId);
          if (projectAnn) {
            const projDoc = projectDocs.find(
              (pd) => pd.id === projectAnn.projectDocumentId
            );
            const docFilename = projDoc?.document?.filename || "Unknown Source";
            const citationData = projDoc?.citationData as CitationData | null;

            annotations.push({
              id: projectAnn.id,
              highlightedText: projectAnn.highlightedText,
              note: projectAnn.note,
              category: projectAnn.category,
              citationData: citationData || null,
              documentFilename: docFilename,
            });
            continue;
          }

          // Fall back to legacy annotations
          const legacyAnn = await storage.getAnnotation(annId);
          if (legacyAnn) {
            const doc = await storage.getDocument(legacyAnn.documentId);
            annotations.push({
              id: legacyAnn.id,
              highlightedText: legacyAnn.highlightedText,
              note: legacyAnn.note,
              category: legacyAnn.category,
              citationData: null,
              documentFilename: doc?.filename || "Unknown Source",
            });
          }
        }
      }

      // Set up SSE response
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      // Helper to send SSE events
      const sendEvent = (event: WritingSSEEvent) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      // Handle client disconnect
      let aborted = false;
      req.on("close", () => {
        aborted = true;
      });

      // Run the pipeline
      await runWritingPipeline(request, annotations, (event) => {
        if (!aborted) {
          sendEvent(event);
        }
      });

      // End the stream
      if (!aborted) {
        res.write("data: [DONE]\n\n");
        res.end();
      }
    } catch (error) {
      console.error("Writing pipeline error:", error);
      // If headers haven't been sent yet, send a JSON error
      if (!res.headersSent) {
        res.status(500).json({
          error: error instanceof Error ? error.message : "Writing pipeline failed",
        });
      } else {
        // Headers already sent (SSE mode), send error event
        const errorEvent: WritingSSEEvent = {
          type: "error",
          error: error instanceof Error ? error.message : "Writing pipeline failed",
        };
        res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
        res.end();
      }
    }
  });

  // GET /api/write/history - Placeholder for future writing session history
  app.get("/api/write/history", async (_req: Request, res: Response) => {
    // Future: return list of previous writing sessions
    res.json([]);
  });
}
