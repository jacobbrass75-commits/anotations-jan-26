import type { Express as ExpressApp, Request, Response } from "express";
import { createServer, type Server } from "http";
import { readdir, stat } from "fs/promises";
import { join } from "path";
import { PDFParse } from "pdf-parse";
import { storage } from "./storage";
import { db, sqlite } from "./db";
import { extractTextFromTxt } from "./chunker";
import {
  getEmbeddingWithUsage,
  analyzeChunkForIntent,
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
  clearDocumentContextCacheV2,
  PIPELINE_V2_CONFIG,
} from "./pipelineV2";
import { registerProjectRoutes } from "./projectRoutes";
import { registerWritingStyleRoutes } from "./writingStyleRoutes";
import { registerChatRoutes } from "./chatRoutes";
import { registerWritingRoutes } from "./writingRoutes";
import { registerHumanizerRoutes } from "./humanizerRoutes";
import { registerExtensionRoutes } from "./extensionRoutes";
import { registerWebClipRoutes } from "./webClipRoutes";
import { registerAnalyticsRoutes } from "./analyticsRoutes";
import { registerStripeBillingRoutes } from "./stripeBillingRoutes";
import { registerPayPalBillingRoutes } from "./paypalBillingRoutes";
import type {
  AnnotationCategory,
  Document,
  InsertAnnotation,
} from "@shared/schema";
import {
  createZipFromImageUploads,
  SUPPORTED_VISION_OCR_MODELS,
  type VisionOcrModel,
} from "./ocrProcessor";
import {
  enqueueImageBundleOcrJob,
  enqueueImageOcrJob,
  enqueuePdfOcrJob,
  initializeOcrQueue,
} from "./ocrQueue";
import {
  getDocumentSourcePath,
  hasDocumentSource,
  inferDocumentSourceMimeType,
  saveDocumentSource,
} from "./sourceFiles";
import {
  DEFAULT_UPLOAD_FILE_SIZE_LIMIT_BYTES,
  createUploadMiddleware,
  getFileExtension,
  isImageFile,
  upload,
} from "./uploadMiddleware";
import {
  annotations,
  documents,
  projectAnnotations,
  projectDocuments,
  projects,
} from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { checkTokenBudget, requireAuth } from "./auth";
import { decrementStorageUsage, reserveStorageUsage } from "./authStorage";
import { createTokenUsageAccumulator } from "./aiUsage";
import {
  createTextBackedDocument,
  normalizePastedSourceFilename,
} from "./documentIngestion";
const MAX_COMBINED_UPLOAD_FILES = Number.isFinite(
  Number(process.env.MAX_COMBINED_UPLOAD_FILES),
)
  ? Math.max(1, Math.floor(Number(process.env.MAX_COMBINED_UPLOAD_FILES)))
  : 25;
const MAX_COMBINED_UPLOAD_TOTAL_BYTES = Number.isFinite(
  Number(process.env.MAX_COMBINED_UPLOAD_TOTAL_BYTES),
)
  ? Math.max(1, Math.floor(Number(process.env.MAX_COMBINED_UPLOAD_TOTAL_BYTES)))
  : DEFAULT_UPLOAD_FILE_SIZE_LIMIT_BYTES;
const DATABASE_PATH = join(process.cwd(), "data", "sourceannotator.db");
const SOURCE_UPLOADS_PATH = join(process.cwd(), "data", "uploads");
const textUpload = createUploadMiddleware();
const groupUpload = createUploadMiddleware({
  maxFileCount: MAX_COMBINED_UPLOAD_FILES,
  maxFileSizeBytes: MAX_COMBINED_UPLOAD_TOTAL_BYTES,
  maxTotalFileSizeBytes: MAX_COMBINED_UPLOAD_TOTAL_BYTES,
});

async function getFileSizeBytes(path: string): Promise<number> {
  try {
    const metadata = await stat(path);
    return metadata.size;
  } catch {
    return 0;
  }
}

async function getDirectorySizeBytes(path: string): Promise<number> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    let total = 0;

    for (const entry of entries) {
      const entryPath = join(path, entry.name);
      if (entry.isDirectory()) {
        total += await getDirectorySizeBytes(entryPath);
      } else if (entry.isFile()) {
        total += await getFileSizeBytes(entryPath);
      }
    }

    return total;
  } catch {
    return 0;
  }
}

async function getOwnedDocumentOr404(
  req: Request,
  res: Response,
): Promise<Document | null> {
  const doc = await storage.getDocument(req.params.id);
  if (!doc || doc.userId !== req.user!.userId) {
    res.status(404).json({ message: "Document not found" });
    return null;
  }
  return doc;
}

async function assertAnnotationOwnerOr404(
  annotationId: string,
  userId: string,
  res: Response,
): Promise<boolean> {
  const annotation = await storage.getAnnotation(annotationId);
  if (!annotation) {
    res.status(404).json({ message: "Annotation not found" });
    return false;
  }

  const doc = await storage.getDocument(annotation.documentId);
  if (!doc || doc.userId !== userId) {
    res.status(404).json({ message: "Annotation not found" });
    return false;
  }

  return true;
}

async function reserveStorageBudget(
  req: Request,
  res: Response,
  additionalBytes: number,
): Promise<number | null> {
  const reservation = await reserveStorageUsage(
    req.user!.userId,
    additionalBytes,
  );
  if (reservation.ok) {
    return reservation.requestedBytes;
  }

  if (reservation.reason === "not_found") {
    res.status(401).json({ message: "Authentication required" });
    return null;
  }

  res.status(403).json({
    message: "Storage budget exceeded",
    storageLimit: reservation.storageLimit,
    storageUsed: reservation.storageUsed,
    requestedBytes: reservation.requestedBytes,
  });
  return null;
}

async function releaseReservedStorage(
  userId: string,
  bytes: number,
): Promise<void> {
  if (bytes <= 0) return;
  try {
    await decrementStorageUsage(userId, bytes);
  } catch (error) {
    console.warn("Failed to release reserved storage usage", {
      userId,
      bytes,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function enforceContentLengthLimit(maxBytes: number) {
  return (req: Request, res: Response, next: () => void): void => {
    const rawLength = req.headers["content-length"];
    const contentLength =
      typeof rawLength === "string" ? Number(rawLength) : Number.NaN;
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      res.status(413).json({
        message: "Upload payload is too large",
        maxBytes,
      });
      return;
    }

    next();
  };
}

// Detect garbled text from failed PDF extraction
// Checks for high ratio of non-word characters or unusual patterns
function isGarbledText(text: string): boolean {
  if (!text || text.length < 100) return false;

  // Sample the first 2000 characters for analysis
  const sample = text.slice(0, 2000);

  // Count normal words (sequences of 3+ alphabetic characters)
  const words = sample.match(/[a-zA-Z]{3,}/g) || [];

  // Count special/unusual character patterns
  const specialChars = sample.match(/[^\w\s.,;:!?'"()-]/g) || [];
  const brackets = sample.match(/[\[\]{}\\|^~`@#$%&*+=<>]/g) || [];

  // Calculate ratios
  const wordChars = words.join("").length;
  const totalChars = sample.replace(/\s/g, "").length;
  const wordRatio = totalChars > 0 ? wordChars / totalChars : 0;
  const bracketRatio = totalChars > 0 ? brackets.length / totalChars : 0;

  // Text is likely garbled if:
  // - Less than 40% of non-space characters form recognizable words
  // - Or more than 10% are unusual bracket/symbol characters
  // - Or average "word" length is very short (fragmented characters)
  const avgWordLen = words.length > 0 ? wordChars / words.length : 0;

  return (
    wordRatio < 0.4 ||
    bracketRatio > 0.1 ||
    (words.length > 10 && avgWordLen < 3)
  );
}

export async function registerRoutes(
  httpServer: Server,
  app: ExpressApp,
): Promise<Server> {
  await initializeOcrQueue();

  app.get("/healthz", (_req: Request, res: Response) => {
    return res.json({ ok: true, service: "scholarmark-app" });
  });

  app.get("/readyz", async (_req: Request, res: Response) => {
    try {
      sqlite.prepare("SELECT 1").get();
      return res.json({ ok: true, service: "scholarmark-app", database: "ok" });
    } catch (error) {
      console.error("Readiness check failed:", error);
      return res
        .status(503)
        .json({ ok: false, service: "scholarmark-app", database: "error" });
    }
  });

  app.get(
    "/api/system/status",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const userId = req.user!.userId;
        const accountDocumentPredicate = () => sql`
        ${documents.userId} = ${userId}
        OR EXISTS (
          SELECT 1
          FROM ${projectDocuments}
          INNER JOIN ${projects} ON ${projects.id} = ${projectDocuments.projectId}
          WHERE ${projectDocuments.documentId} = ${documents.id}
            AND ${projects.userId} = ${userId}
        )
      `;

        const [projectCountRow] = await db
          .select({ count: sql<number>`count(*)` })
          .from(projects)
          .where(eq(projects.userId, userId));
        const [documentCountRow] = await db
          .select({ count: sql<number>`count(DISTINCT ${documents.id})` })
          .from(documents)
          .where(accountDocumentPredicate());
        const [annotationCountRow] = await db
          .select({ count: sql<number>`count(*)` })
          .from(annotations)
          .innerJoin(documents, eq(annotations.documentId, documents.id))
          .where(accountDocumentPredicate());
        const [projectAnnotationCountRow] = await db
          .select({ count: sql<number>`count(*)` })
          .from(projectAnnotations)
          .innerJoin(
            projectDocuments,
            eq(projectAnnotations.projectDocumentId, projectDocuments.id),
          )
          .innerJoin(projects, eq(projectDocuments.projectId, projects.id))
          .where(eq(projects.userId, userId));

        const documentMeta = await db
          .select({
            id: documents.id,
            filename: documents.filename,
            uploadDate: documents.uploadDate,
            summary: documents.summary,
            chunkCount: documents.chunkCount,
            status: documents.status,
            processingError: documents.processingError,
          })
          .from(documents)
          .where(accountDocumentPredicate());
        const statusBreakdown = {
          ready: 0,
          processing: 0,
          error: 0,
          other: 0,
        };

        for (const doc of documentMeta) {
          if (doc.status === "ready") {
            statusBreakdown.ready += 1;
          } else if (doc.status === "processing") {
            statusBreakdown.processing += 1;
          } else if (doc.status === "error") {
            statusBreakdown.error += 1;
          } else {
            statusBreakdown.other += 1;
          }
        }

        const dbBytes = await getFileSizeBytes(DATABASE_PATH);
        const sourceFilesBytes =
          await getDirectorySizeBytes(SOURCE_UPLOADS_PATH);
        const heapUsage = process.memoryUsage();

        return res.json({
          counts: {
            projects: projectCountRow?.count ?? 0,
            documents: documentCountRow?.count ?? 0,
            annotations:
              (annotationCountRow?.count ?? 0) +
              (projectAnnotationCountRow?.count ?? 0),
          },
          storage: {
            databaseBytes: dbBytes,
            sourceFilesBytes,
            totalBytes: dbBytes + sourceFilesBytes,
          },
          system: {
            uptimeSeconds: Math.floor(process.uptime()),
            nodeVersion: process.version,
            platform: `${process.platform}/${process.arch}`,
            heapUsedBytes: heapUsage.heapUsed,
            heapTotalBytes: Math.max(heapUsage.heapTotal, 1),
          },
          documentsByStatus: statusBreakdown,
          capturedAt: Date.now(),
        });
      } catch (error) {
        console.error("Error fetching system status:", error);
        return res
          .status(500)
          .json({ message: "Failed to fetch system status" });
      }
    },
  );

  // Upload document
  app.post(
    "/api/upload",
    requireAuth,
    checkTokenBudget,
    upload.single("file"),
    async (req: Request, res: Response) => {
      let reservedStorageBytes = 0;
      try {
        if (!req.file) {
          return res.status(400).json({ message: "No file uploaded" });
        }

        const file = req.file;
        const fileBytes = file.size || file.buffer.length;
        const requestedOcrMode = (
          (req.body.ocrMode as string) || "standard"
        ).toLowerCase();
        const ocrMode =
          requestedOcrMode === "vision-batch"
            ? "vision_batch"
            : ["standard", "advanced", "vision", "vision_batch"].includes(
                  requestedOcrMode,
                )
              ? requestedOcrMode
              : "standard";
        const requestedOcrModel = (
          (req.body.ocrModel as string) || ""
        ).toLowerCase();
        const ocrModel: VisionOcrModel = SUPPORTED_VISION_OCR_MODELS.includes(
          requestedOcrModel as VisionOcrModel,
        )
          ? (requestedOcrModel as VisionOcrModel)
          : "gpt-4o";
        const fileExtension = getFileExtension(file.originalname);
        const isPdf =
          file.mimetype === "application/pdf" || fileExtension === ".pdf";
        const isTxt =
          file.mimetype === "text/plain" || fileExtension === ".txt";
        const isImage = isImageFile(file.mimetype, fileExtension);

        if (!isPdf && !isTxt && !isImage) {
          return res.status(400).json({
            message:
              "Unsupported file type. Please upload a PDF, TXT, or image file (including HEIC/HEIF).",
          });
        }

        // For TXT files and standard PDF mode, use synchronous processing
        if (isTxt || (isPdf && ocrMode === "standard")) {
          let fullText: string;

          if (isPdf) {
            // Use pdf-parse to properly extract text from PDF
            const parser = new PDFParse({ data: file.buffer });
            const textResult = await parser.getText();
            fullText = textResult.text;
            await parser.destroy();
            // Clean up whitespace
            fullText = fullText.replace(/\s+/g, " ").trim();

            // Check if extracted text appears garbled (common with scanned PDFs or custom fonts)
            if (isGarbledText(fullText)) {
              return res.status(400).json({
                message:
                  "This PDF appears to be scanned or uses custom fonts that cannot be read. Please try: (1) Using a PDF with selectable text, (2) Copy the text content into a .txt file and upload that instead, or (3) Re-upload with Advanced OCR, Vision OCR, or Vision OCR Batch mode.",
              });
            }
          } else {
            fullText = extractTextFromTxt(file.buffer.toString("utf-8"));
          }

          const reservation = await reserveStorageBudget(req, res, fileBytes);
          if (reservation === null) return;
          reservedStorageBytes = reservation;

          const updatedDoc = await createTextBackedDocument({
            filename: file.originalname,
            fullText,
            sourceBuffer: file.buffer,
            userId: req.user!.userId,
          });
          reservedStorageBytes = 0;
          return res.json(updatedDoc);
        }

        if (isPdf) {
          const reservation = await reserveStorageBudget(req, res, fileBytes);
          if (reservation === null) return;
          reservedStorageBytes = reservation;

          // OCR modes for PDFs: queue durable background OCR against persisted source.
          const doc = await storage.createDocument({
            filename: file.originalname,
            fullText: "",
            userId: req.user!.userId,
          } as any);
          await saveDocumentSource(doc.id, file.originalname, file.buffer);
          reservedStorageBytes = 0;
          await storage.updateDocument(doc.id, { status: "processing" });
          await enqueuePdfOcrJob({
            documentId: doc.id,
            sourceFilename: file.originalname,
            ocrMode: ocrMode as "advanced" | "vision" | "vision_batch",
            ocrModel,
          });

          const updatedDoc = await storage.getDocument(doc.id);
          return res.status(202).json(updatedDoc);
        }

        if (isImage) {
          const reservation = await reserveStorageBudget(req, res, fileBytes);
          if (reservation === null) return;
          reservedStorageBytes = reservation;

          // Image OCR runs as a durable queued job.
          const doc = await storage.createDocument({
            filename: file.originalname,
            fullText: "",
            userId: req.user!.userId,
          } as any);
          await saveDocumentSource(doc.id, file.originalname, file.buffer);
          reservedStorageBytes = 0;
          await storage.updateDocument(doc.id, { status: "processing" });
          const imageOcrMode =
            ocrMode === "vision_batch" ? "vision_batch" : "vision";
          await enqueueImageOcrJob({
            documentId: doc.id,
            sourceFilename: file.originalname,
            ocrMode: imageOcrMode,
            ocrModel,
          });

          const updatedDoc = await storage.getDocument(doc.id);
          return res.status(202).json(updatedDoc);
        }

        return res
          .status(400)
          .json({ message: "Unsupported OCR mode for this file type" });
      } catch (error) {
        await releaseReservedStorage(req.user!.userId, reservedStorageBytes);
        console.error("Upload error:", error);
        res
          .status(500)
          .json({
            message: error instanceof Error ? error.message : "Upload failed",
          });
      }
    },
  );

  app.post(
    "/api/upload-text",
    requireAuth,
    checkTokenBudget,
    textUpload.none(),
    async (req: Request, res: Response) => {
      let reservedStorageBytes = 0;
      try {
        const rawText = typeof req.body.text === "string" ? req.body.text : "";
        const normalizedText = extractTextFromTxt(rawText);
        const textBytes = Buffer.byteLength(rawText, "utf-8");

        if (!normalizedText || normalizedText.length < 10) {
          return res.status(400).json({
            message:
              "Paste at least a few sentences so ScholarMark can create a usable source.",
          });
        }
        const reservation = await reserveStorageBudget(req, res, textBytes);
        if (reservation === null) return;
        reservedStorageBytes = reservation;

        const title = typeof req.body.title === "string" ? req.body.title : "";
        const filename = normalizePastedSourceFilename(title);
        const doc = await createTextBackedDocument({
          filename,
          fullText: normalizedText,
          sourceBuffer: Buffer.from(rawText, "utf-8"),
          userId: req.user!.userId,
        });
        reservedStorageBytes = 0;

        return res.json(doc);
      } catch (error) {
        await releaseReservedStorage(req.user!.userId, reservedStorageBytes);
        console.error("Upload text error:", error);
        return res.status(500).json({
          message:
            error instanceof Error ? error.message : "Paste upload failed",
        });
      }
    },
  );

  // Upload multiple images as a single combined document (preserves upload order).
  app.post(
    "/api/upload-group",
    requireAuth,
    checkTokenBudget,
    enforceContentLengthLimit(MAX_COMBINED_UPLOAD_TOTAL_BYTES),
    groupUpload.array("files", MAX_COMBINED_UPLOAD_FILES),
    async (req: Request, res: Response) => {
      let reservedStorageBytes = 0;
      try {
        const files = (req.files as Express.Multer.File[] | undefined) || [];
        if (!files.length) {
          return res.status(400).json({ message: "No files uploaded" });
        }
        const totalUploadedBytes = files.reduce(
          (sum, file) => sum + (file.size || file.buffer.length),
          0,
        );
        if (totalUploadedBytes > MAX_COMBINED_UPLOAD_TOTAL_BYTES) {
          return res.status(413).json({
            message: "Combined upload is too large",
            maxBytes: MAX_COMBINED_UPLOAD_TOTAL_BYTES,
            requestedBytes: totalUploadedBytes,
          });
        }
        if (files.length > MAX_COMBINED_UPLOAD_FILES) {
          return res.status(400).json({
            message:
              `Too many images in one combined upload (${files.length}). ` +
              `Limit is ${MAX_COMBINED_UPLOAD_FILES}. Split into smaller batches for reliability.`,
          });
        }

        const requestedOcrMode = (
          (req.body.ocrMode as string) || "standard"
        ).toLowerCase();
        const ocrMode =
          requestedOcrMode === "vision-batch"
            ? "vision_batch"
            : ["standard", "vision", "vision_batch"].includes(requestedOcrMode)
              ? requestedOcrMode
              : "standard";
        const requestedOcrModel = (
          (req.body.ocrModel as string) || ""
        ).toLowerCase();
        const ocrModel: VisionOcrModel = SUPPORTED_VISION_OCR_MODELS.includes(
          requestedOcrModel as VisionOcrModel,
        )
          ? (requestedOcrModel as VisionOcrModel)
          : "gpt-4o";

        const supportedCombinedExtensions = new Set([
          ".png",
          ".jpg",
          ".jpeg",
          ".heic",
          ".heif",
        ]);
        for (const file of files) {
          const ext = getFileExtension(file.originalname);
          const image = isImageFile(file.mimetype, ext);
          if (!image) {
            return res.status(400).json({
              message: "Combined uploads currently support images only.",
            });
          }
          if (!supportedCombinedExtensions.has(ext)) {
            return res.status(400).json({
              message: `Unsupported image format for combined upload: ${file.originalname}. Please convert to PNG/JPG or upload separately.`,
            });
          }
        }

        const primaryName = files[0].originalname || "image-upload";
        const baseName = primaryName.replace(/\.[^/.]+$/, "");
        const combinedFilename = `${baseName} (${files.length} images).zip`;
        const combinedZipBuffer = await createZipFromImageUploads(
          files.map((file) => ({
            buffer: file.buffer,
            originalFilename: file.originalname,
          })),
        );
        const reservation = await reserveStorageBudget(
          req,
          res,
          combinedZipBuffer.length,
        );
        if (reservation === null) return;
        reservedStorageBytes = reservation;

        const doc = await storage.createDocument({
          filename: combinedFilename,
          fullText: "",
          userId: req.user!.userId,
        } as any);
        await storage.updateDocument(doc.id, { status: "processing" });
        await saveDocumentSource(doc.id, combinedFilename, combinedZipBuffer);
        reservedStorageBytes = 0;

        const combinedOcrMode =
          ocrMode === "vision" ? "vision" : "vision_batch";
        await enqueueImageBundleOcrJob({
          documentId: doc.id,
          sourceFilename: combinedFilename,
          ocrMode: combinedOcrMode,
          ocrModel,
        });

        const updatedDoc = await storage.getDocument(doc.id);
        return res.status(202).json(updatedDoc);
      } catch (error) {
        await releaseReservedStorage(req.user!.userId, reservedStorageBytes);
        console.error("Upload-group error:", error);
        res
          .status(500)
          .json({
            message: error instanceof Error ? error.message : "Upload failed",
          });
      }
    },
  );

  // Get document processing status (for polling)
  app.get(
    "/api/documents/:id/status",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const doc = await getOwnedDocumentOr404(req, res);
        if (!doc) return;
        res.json({
          id: doc.id,
          status: doc.status,
          processingError: doc.processingError,
          filename: doc.filename,
          chunkCount: doc.chunkCount,
        });
      } catch (error) {
        console.error("Error fetching document status:", error);
        res.status(500).json({ message: "Failed to fetch document status" });
      }
    },
  );

  // Get all documents
  app.get(
    "/api/documents",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const docs = await storage.getAllDocuments(req.user!.userId);
        res.json(docs);
      } catch (error) {
        console.error("Error fetching documents:", error);
        res.status(500).json({ message: "Failed to fetch documents" });
      }
    },
  );

  // Get lightweight document metadata list (avoids returning fullText for every document)
  app.get(
    "/api/documents/meta",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const docs = await storage.getAllDocumentMeta(req.user!.userId);
        res.json(docs);
      } catch (error) {
        console.error("Error fetching document metadata:", error);
        res.status(500).json({ message: "Failed to fetch document metadata" });
      }
    },
  );

  // Get single document
  app.get(
    "/api/documents/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const doc = await getOwnedDocumentOr404(req, res);
        if (!doc) return;
        res.json(doc);
      } catch (error) {
        console.error("Error fetching document:", error);
        res.status(500).json({ message: "Failed to fetch document" });
      }
    },
  );

  // Get original source metadata for a document
  app.get(
    "/api/documents/:id/source-meta",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const doc = await getOwnedDocumentOr404(req, res);
        if (!doc) return;

        const available = await hasDocumentSource(doc.id, doc.filename);
        res.json({
          documentId: doc.id,
          filename: doc.filename,
          available,
          mimeType: inferDocumentSourceMimeType(doc.filename),
          sourceUrl: available ? `/api/documents/${doc.id}/source` : null,
        });
      } catch (error) {
        console.error("Error fetching source metadata:", error);
        res.status(500).json({ message: "Failed to fetch source metadata" });
      }
    },
  );

  // Stream original uploaded source file for side-by-side reference
  app.get(
    "/api/documents/:id/source",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const doc = await getOwnedDocumentOr404(req, res);
        if (!doc) return;

        const available = await hasDocumentSource(doc.id, doc.filename);
        if (!available) {
          return res
            .status(404)
            .json({
              message:
                "Original source file is not available for this document",
            });
        }

        const sourcePath = getDocumentSourcePath(doc.id, doc.filename);
        const mimeType = inferDocumentSourceMimeType(doc.filename);
        const safeFilename = doc.filename.replace(/"/g, "");
        const dispositionType =
          mimeType === "application/zip" ? "attachment" : "inline";

        res.setHeader("Content-Type", mimeType);
        res.setHeader(
          "Content-Disposition",
          `${dispositionType}; filename="${safeFilename}"`,
        );
        res.sendFile(sourcePath, (error) => {
          if (error && !res.headersSent) {
            res.status(500).json({ message: "Failed to stream source file" });
          }
        });
      } catch (error) {
        console.error("Error streaming source document:", error);
        res.status(500).json({ message: "Failed to stream source document" });
      }
    },
  );

  // Set intent and trigger AI analysis
  app.post(
    "/api/documents/:id/set-intent",
    requireAuth,
    checkTokenBudget,
    async (req: Request, res: Response) => {
      const tokenUsage = createTokenUsageAccumulator();
      try {
        const { intent, thoroughness = "standard" } = req.body;
        if (!intent || typeof intent !== "string") {
          return res.status(400).json({ message: "Intent is required" });
        }

        // Validate thoroughness level
        const validLevels: ThoroughnessLevel[] = [
          "quick",
          "standard",
          "thorough",
          "exhaustive",
        ];
        const level: ThoroughnessLevel = validLevels.includes(thoroughness)
          ? thoroughness
          : "standard";

        const doc = await getOwnedDocumentOr404(req, res);
        if (!doc) return;

        if (doc.status === "processing") {
          return res
            .status(409)
            .json({
              message:
                "Document is still processing. Please wait until processing completes.",
            });
        }
        if (doc.status === "error") {
          return res
            .status(409)
            .json({
              message:
                "Document processing failed. Please re-upload the document.",
            });
        }

        // Update document with intent
        await storage.updateDocument(doc.id, { userIntent: intent });

        // Get chunks
        const chunks = await storage.getChunksForDocument(doc.id);
        if (chunks.length === 0) {
          return res
            .status(400)
            .json({ message: "No text chunks found for analysis" });
        }

        // Generate intent embedding
        const intentEmbedding = await getEmbeddingWithUsage(
          intent,
          tokenUsage.add,
        );

        // Generate embeddings for chunks if not already done
        const chunksWithEmbeddings = await Promise.all(
          chunks.map(async (chunk) => {
            if (!chunk.embedding) {
              const embedding = await getEmbeddingWithUsage(
                chunk.text,
                tokenUsage.add,
              );
              await storage.updateChunkEmbedding(chunk.id, embedding);
              return { ...chunk, embedding };
            }
            return chunk;
          }),
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
        const minSimilarity = level === "exhaustive" ? 0.1 : 0.3;

        const topChunks = rankedChunks
          .filter(({ similarity }) => similarity >= minSimilarity)
          .slice(0, maxChunks)
          .map(({ chunk }) => ({
            text: chunk.text,
            startPosition: chunk.startPosition,
            id: chunk.id,
          }));

        if (topChunks.length === 0) {
          await tokenUsage.flush(req.user!.userId, "document_analysis");
          return res.json([]);
        }

        // Get existing non-AI annotations to avoid duplicates
        const existingAnnotations = await storage.getAnnotationsForDocument(
          doc.id,
        );
        const userAnnotations = existingAnnotations
          .filter((a) => !a.isAiGenerated)
          .map((a) => ({
            startPosition: a.startPosition,
            endPosition: a.endPosition,
            confidenceScore: a.confidenceScore,
          }));

        // Delete existing AI annotations before generating new ones
        for (const ann of existingAnnotations.filter((a) => a.isAiGenerated)) {
          await storage.deleteAnnotation(ann.id);
        }

        // Process chunks through the V2 three-phase pipeline (improved)
        const pipelineAnnotations = await processChunksWithPipelineV2(
          topChunks,
          intent,
          doc.id,
          doc.fullText,
          userAnnotations,
          { onTokenUsage: tokenUsage.add },
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

        const finalAnnotations = await storage.getAnnotationsForDocument(
          doc.id,
        );
        await tokenUsage.flush(req.user!.userId, "document_analysis");
        res.json(finalAnnotations);
      } catch (error) {
        console.error("Analysis error:", error);
        res
          .status(500)
          .json({
            message: error instanceof Error ? error.message : "Analysis failed",
          });
      }
    },
  );

  // Get annotations for document
  app.get(
    "/api/documents/:id/annotations",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const doc = await getOwnedDocumentOr404(req, res);
        if (!doc) return;

        const annotations = await storage.getAnnotationsForDocument(doc.id);
        res.json(annotations);
      } catch (error) {
        console.error("Error fetching annotations:", error);
        res.status(500).json({ message: "Failed to fetch annotations" });
      }
    },
  );

  // Add manual annotation
  app.post(
    "/api/documents/:id/annotate",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const {
          startPosition,
          endPosition,
          highlightedText,
          category,
          note,
          isAiGenerated,
        } = req.body;

        if (
          typeof startPosition !== "number" ||
          typeof endPosition !== "number" ||
          !highlightedText ||
          !category ||
          !note
        ) {
          return res.status(400).json({ message: "Missing required fields" });
        }

        const doc = await getOwnedDocumentOr404(req, res);
        if (!doc) return;

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
    },
  );

  // Update annotation
  app.put(
    "/api/annotations/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { note, category } = req.body;

        if (!note || !category) {
          return res
            .status(400)
            .json({ message: "Note and category are required" });
        }

        const ownsAnnotation = await assertAnnotationOwnerOr404(
          req.params.id,
          req.user!.userId,
          res,
        );
        if (!ownsAnnotation) return;

        const annotation = await storage.updateAnnotation(
          req.params.id,
          note,
          category as AnnotationCategory,
        );

        if (!annotation) {
          return res.status(404).json({ message: "Annotation not found" });
        }

        res.json(annotation);
      } catch (error) {
        console.error("Error updating annotation:", error);
        res.status(500).json({ message: "Failed to update annotation" });
      }
    },
  );

  // Delete annotation
  app.delete(
    "/api/annotations/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const ownsAnnotation = await assertAnnotationOwnerOr404(
          req.params.id,
          req.user!.userId,
          res,
        );
        if (!ownsAnnotation) return;

        await storage.deleteAnnotation(req.params.id);
        res.json({ success: true });
      } catch (error) {
        console.error("Error deleting annotation:", error);
        res.status(500).json({ message: "Failed to delete annotation" });
      }
    },
  );

  // Search document
  app.post(
    "/api/documents/:id/search",
    requireAuth,
    checkTokenBudget,
    async (req: Request, res: Response) => {
      const tokenUsage = createTokenUsageAccumulator();
      try {
        const { query } = req.body;

        if (!query || typeof query !== "string") {
          return res.status(400).json({ message: "Query is required" });
        }

        const doc = await getOwnedDocumentOr404(req, res);
        if (!doc) return;

        // Get chunks with embeddings
        const chunks = await storage.getChunksForDocument(doc.id);

        // Generate query embedding
        const queryEmbedding = await getEmbeddingWithUsage(
          query,
          tokenUsage.add,
        );

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
          await tokenUsage.flush(req.user!.userId, "document_search");
          return res.json([]);
        }

        // Use LLM to find relevant quotes
        const results = await searchDocument(
          query,
          doc.userIntent || "",
          rankedChunks,
          tokenUsage.add,
        );

        await tokenUsage.flush(req.user!.userId, "document_search");
        res.json(results);
      } catch (error) {
        console.error("Search error:", error);
        res
          .status(500)
          .json({
            message: error instanceof Error ? error.message : "Search failed",
          });
      }
    },
  );

  // Get document summary
  app.get(
    "/api/documents/:id/summary",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const doc = await getOwnedDocumentOr404(req, res);
        if (!doc) return;

        res.json({
          summary: doc.summary,
          mainArguments: doc.mainArguments,
          keyConcepts: doc.keyConcepts,
        });
      } catch (error) {
        console.error("Error fetching summary:", error);
        res.status(500).json({ message: "Failed to fetch summary" });
      }
    },
  );

  // Register project routes
  registerProjectRoutes(app);
  registerWritingStyleRoutes(app);
  registerWebClipRoutes(app);
  registerStripeBillingRoutes(app);
  registerPayPalBillingRoutes(app);

  // Register chat routes
  registerChatRoutes(app);

  // Register writing pipeline routes
  registerWritingRoutes(app);

  // Register humanizer routes
  registerHumanizerRoutes(app);

  // Register extension routes (Chrome extension API)
  registerExtensionRoutes(app);

  // Register admin analytics routes
  registerAnalyticsRoutes(app);

  // Register A/B test routes
  // registerABTestRoutes(app); // TODO: Not implemented yet

  return httpServer;
}
