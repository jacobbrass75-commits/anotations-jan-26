import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import path from "path";
import multer from "multer";
import { storage } from "./storage";
import { extractTextFromTxt } from "./chunker";
import {
  saveTempPdf,
  extractPdfScreenshots,
  runOcr,
  cleanupTempFiles,
} from "./ocrBridge";
import { analyzePdfDifficulty, chooseOcrModel } from "./visionAnalysis";
import {
  getEmbedding,
  analyzeChunkForIntent,
  generateDocumentSummary,
  searchDocument,
  findHighlightPosition,
  cosineSimilarity,
  PIPELINE_CONFIG,
  getMaxChunksForLevel,
  type ThoroughnessLevel,
} from "./openai";
// V2 Pipeline - improved annotation system
import {
  processChunksWithPipelineV2,
  chunkTextV2,
  clearDocumentContextCacheV2,
  PIPELINE_V2_CONFIG,
} from "./pipelineV2";
import { registerProjectRoutes } from "./projectRoutes";
import type { AnnotationCategory, InsertAnnotation } from "@shared/schema";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["application/pdf", "text/plain"];
    const allowedExtensions = [".pdf", ".txt"];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf("."));
    
    if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and TXT files are allowed"));
    }
  },
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Upload document
  app.post("/api/upload", upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const file = req.file;
      let fullText: string;

      // Extract text based on file type
      if (file.mimetype === "application/pdf" || file.originalname.endsWith(".pdf")) {
        // OCR pipeline: save temp file → screenshots → vision analysis → OCR
        let tempPdfPath: string | undefined;
        let screenshotPaths: string[] = [];
        let screenshotDir: string | undefined;

        try {
          // 1. Save buffer to temp file
          tempPdfPath = await saveTempPdf(file.buffer);

          // 2. Extract screenshots for vision analysis (page 0 + middle page)
          // Extract page 0 first to learn total page count, then include middle page
          const page0Result = await extractPdfScreenshots(tempPdfPath, [0]);
          const totalPages = page0Result.total_pages;
          const middlePage = Math.floor(totalPages / 2);

          let screenshotResult: typeof page0Result;
          if (middlePage > 0) {
            // Clean up initial single-page screenshots before re-extracting
            if (page0Result.screenshots.length > 0) {
              await cleanupTempFiles(path.dirname(page0Result.screenshots[0]));
            }
            // Re-extract with both pages in one call
            screenshotResult = await extractPdfScreenshots(tempPdfPath, [0, middlePage]);
          } else {
            screenshotResult = page0Result;
          }
          screenshotPaths = screenshotResult.screenshots;
          if (screenshotPaths.length > 0) {
            screenshotDir = path.dirname(screenshotPaths[0]);
          }

          // 3. GPT-4o vision analysis to determine difficulty
          const analysis = await analyzePdfDifficulty(screenshotPaths);
          console.log(`PDF analysis: difficulty=${analysis.difficulty}, handwriting=${analysis.handwritingType}`);

          // 4. Choose and run OCR model based on analysis
          let model = chooseOcrModel(analysis);
          console.log(`Selected OCR model: ${model}`);

          let ocrResult = await runOcr(tempPdfPath, model);
          fullText = ocrResult.full_text;

          // 5. Fallback: if PP-OCRv5 produces very little text, retry with VL
          if (model === "ppocr" && fullText.replace(/\s/g, "").length < 50) {
            console.log("PP-OCRv5 produced minimal text, retrying with PaddleOCR-VL");
            ocrResult = await runOcr(tempPdfPath, "vl");
            fullText = ocrResult.full_text;
          }

          // Clean up whitespace
          fullText = fullText.replace(/\s+/g, " ").trim();
        } finally {
          // 6. Always clean up temp files
          const cleanupPaths: string[] = [];
          if (tempPdfPath) {
            cleanupPaths.push(tempPdfPath, path.dirname(tempPdfPath));
          }
          if (screenshotDir) {
            cleanupPaths.push(screenshotDir);
          }
          await cleanupTempFiles(...cleanupPaths);
        }
      } else {
        fullText = extractTextFromTxt(file.buffer.toString("utf-8"));
      }

      if (!fullText || fullText.length < 10) {
        return res.status(400).json({ message: "Could not extract text from file" });
      }

      // Create document
      const doc = await storage.createDocument({
        filename: file.originalname,
        fullText,
      });

      // Chunk the text using V2 chunking (with noise filtering and larger chunks)
      const chunks = chunkTextV2(fullText);

      // Store chunks (don't generate embeddings yet - do it during analysis)
      for (const chunk of chunks) {
        await storage.createChunk({
          documentId: doc.id,
          text: chunk.text,
          startPosition: chunk.originalStartPosition,
          endPosition: chunk.originalStartPosition + chunk.text.length,
        });
      }

      // Update document with chunk count
      await storage.updateDocument(doc.id, { chunkCount: chunks.length });

      // Generate summary in background
      generateDocumentSummary(fullText).then(async (summaryData) => {
        await storage.updateDocument(doc.id, {
          summary: summaryData.summary,
          mainArguments: summaryData.mainArguments,
          keyConcepts: summaryData.keyConcepts,
        });
      });

      const updatedDoc = await storage.getDocument(doc.id);
      res.json(updatedDoc);
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ message: error instanceof Error ? error.message : "Upload failed" });
    }
  });

  // Get all documents
  app.get("/api/documents", async (req: Request, res: Response) => {
    try {
      const docs = await storage.getAllDocuments();
      res.json(docs);
    } catch (error) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ message: "Failed to fetch documents" });
    }
  });

  // Get single document
  app.get("/api/documents/:id", async (req: Request, res: Response) => {
    try {
      const doc = await storage.getDocument(req.params.id);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }
      res.json(doc);
    } catch (error) {
      console.error("Error fetching document:", error);
      res.status(500).json({ message: "Failed to fetch document" });
    }
  });

  // Set intent and trigger AI analysis
  app.post("/api/documents/:id/set-intent", async (req: Request, res: Response) => {
    try {
      const { intent, thoroughness = 'standard' } = req.body;
      if (!intent || typeof intent !== "string") {
        return res.status(400).json({ message: "Intent is required" });
      }

      // Validate thoroughness level
      const validLevels: ThoroughnessLevel[] = ['quick', 'standard', 'thorough', 'exhaustive'];
      const level: ThoroughnessLevel = validLevels.includes(thoroughness) ? thoroughness : 'standard';

      const doc = await storage.getDocument(req.params.id);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }

      // Update document with intent
      await storage.updateDocument(doc.id, { userIntent: intent });

      // Get chunks
      const chunks = await storage.getChunksForDocument(doc.id);
      if (chunks.length === 0) {
        return res.status(400).json({ message: "No text chunks found for analysis" });
      }

      // Generate intent embedding
      const intentEmbedding = await getEmbedding(intent);

      // Generate embeddings for chunks if not already done
      const chunksWithEmbeddings = await Promise.all(
        chunks.map(async (chunk) => {
          if (!chunk.embedding) {
            const embedding = await getEmbedding(chunk.text);
            await storage.updateChunkEmbedding(chunk.id, embedding);
            return { ...chunk, embedding };
          }
          return chunk;
        })
      );

      // Calculate similarity and rank chunks
      const rankedChunks = chunksWithEmbeddings
        .map((chunk) => ({
          chunk,
          similarity: cosineSimilarity(chunk.embedding!, intentEmbedding),
        }))
        .sort((a, b) => b.similarity - a.similarity);

      // Filter to top relevant chunks based on thoroughness level
      const maxChunks = getMaxChunksForLevel(level);
      const minSimilarity = level === 'exhaustive' ? 0.1 : 0.3;

      const topChunks = rankedChunks
        .filter(({ similarity }) => similarity >= minSimilarity)
        .slice(0, maxChunks)
        .map(({ chunk }) => ({
          text: chunk.text,
          startPosition: chunk.startPosition,
          id: chunk.id,
        }));

      if (topChunks.length === 0) {
        return res.json([]);
      }

      // Get existing non-AI annotations to avoid duplicates
      const existingAnnotations = await storage.getAnnotationsForDocument(doc.id);
      const userAnnotations = existingAnnotations
        .filter((a) => !a.isAiGenerated)
        .map((a) => ({
          startPosition: a.startPosition,
          endPosition: a.endPosition,
          confidenceScore: a.confidenceScore,
        }));

      // Delete existing AI annotations before generating new ones
      for (const ann of existingAnnotations.filter(a => a.isAiGenerated)) {
        await storage.deleteAnnotation(ann.id);
      }

      // Process chunks through the V2 three-phase pipeline (improved)
      const pipelineAnnotations = await processChunksWithPipelineV2(
        topChunks,
        intent,
        doc.id,
        doc.fullText,
        userAnnotations
      );

      // Clear document context cache
      clearDocumentContextCacheV2(doc.id);

      // Create new annotations from pipeline results
      for (const ann of pipelineAnnotations) {
        await storage.createAnnotation({
          documentId: doc.id,
          startPosition: ann.absoluteStart,
          endPosition: ann.absoluteEnd,
          highlightedText: ann.highlightText,
          category: ann.category,
          note: ann.note,
          isAiGenerated: true,
          confidenceScore: ann.confidence,
        });
      }

      const finalAnnotations = await storage.getAnnotationsForDocument(doc.id);
      res.json(finalAnnotations);
    } catch (error) {
      console.error("Analysis error:", error);
      res.status(500).json({ message: error instanceof Error ? error.message : "Analysis failed" });
    }
  });

  // Get annotations for document
  app.get("/api/documents/:id/annotations", async (req: Request, res: Response) => {
    try {
      const annotations = await storage.getAnnotationsForDocument(req.params.id);
      res.json(annotations);
    } catch (error) {
      console.error("Error fetching annotations:", error);
      res.status(500).json({ message: "Failed to fetch annotations" });
    }
  });

  // Add manual annotation
  app.post("/api/documents/:id/annotate", async (req: Request, res: Response) => {
    try {
      const { startPosition, endPosition, highlightedText, category, note, isAiGenerated } = req.body;

      if (
        typeof startPosition !== "number" ||
        typeof endPosition !== "number" ||
        !highlightedText ||
        !category ||
        !note
      ) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const doc = await storage.getDocument(req.params.id);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }

      const annotation = await storage.createAnnotation({
        documentId: doc.id,
        startPosition,
        endPosition,
        highlightedText,
        category: category as AnnotationCategory,
        note,
        isAiGenerated: isAiGenerated || false,
      });

      res.json(annotation);
    } catch (error) {
      console.error("Error creating annotation:", error);
      res.status(500).json({ message: "Failed to create annotation" });
    }
  });

  // Update annotation
  app.put("/api/annotations/:id", async (req: Request, res: Response) => {
    try {
      const { note, category } = req.body;

      if (!note || !category) {
        return res.status(400).json({ message: "Note and category are required" });
      }

      const annotation = await storage.updateAnnotation(
        req.params.id,
        note,
        category as AnnotationCategory
      );

      if (!annotation) {
        return res.status(404).json({ message: "Annotation not found" });
      }

      res.json(annotation);
    } catch (error) {
      console.error("Error updating annotation:", error);
      res.status(500).json({ message: "Failed to update annotation" });
    }
  });

  // Delete annotation
  app.delete("/api/annotations/:id", async (req: Request, res: Response) => {
    try {
      await storage.deleteAnnotation(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting annotation:", error);
      res.status(500).json({ message: "Failed to delete annotation" });
    }
  });

  // Search document
  app.post("/api/documents/:id/search", async (req: Request, res: Response) => {
    try {
      const { query } = req.body;

      if (!query || typeof query !== "string") {
        return res.status(400).json({ message: "Query is required" });
      }

      const doc = await storage.getDocument(req.params.id);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }

      // Get chunks with embeddings
      const chunks = await storage.getChunksForDocument(doc.id);
      
      // Generate query embedding
      const queryEmbedding = await getEmbedding(query);

      // Rank chunks by similarity
      const rankedChunks = chunks
        .filter((c) => c.embedding)
        .map((chunk) => ({
          text: chunk.text,
          startPosition: chunk.startPosition,
          endPosition: chunk.endPosition,
          similarity: cosineSimilarity(chunk.embedding!, queryEmbedding),
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 5);

      if (rankedChunks.length === 0) {
        return res.json([]);
      }

      // Use LLM to find relevant quotes
      const results = await searchDocument(
        query,
        doc.userIntent || "",
        rankedChunks
      );

      res.json(results);
    } catch (error) {
      console.error("Search error:", error);
      res.status(500).json({ message: error instanceof Error ? error.message : "Search failed" });
    }
  });

  // Get document summary
  app.get("/api/documents/:id/summary", async (req: Request, res: Response) => {
    try {
      const doc = await storage.getDocument(req.params.id);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }

      res.json({
        summary: doc.summary,
        mainArguments: doc.mainArguments,
        keyConcepts: doc.keyConcepts,
      });
    } catch (error) {
      console.error("Error fetching summary:", error);
      res.status(500).json({ message: "Failed to fetch summary" });
    }
  });

  // Register project routes
  registerProjectRoutes(app);

  // Register A/B test routes
  // registerABTestRoutes(app); // TODO: Not implemented yet

  return httpServer;
}
