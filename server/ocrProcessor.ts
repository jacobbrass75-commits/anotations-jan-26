import { spawn } from "child_process";
import { writeFile, readFile, rm, mkdtemp } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";
import OpenAI from "openai";
import { storage } from "./storage";
import { chunkTextV2 } from "./pipelineV2";
import { generateDocumentSummary } from "./openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface VisionOcrOptions {
  batchMode?: boolean;
  batchSize?: number;
  concurrency?: number;
}

const SINGLE_PAGE_OCR_PROMPT =
  "Extract ALL text from this scanned document page. Preserve paragraphs and reading order. For tables, render each row on its own line with columns separated by ' | '. For footnotes or marginalia, include them at the end marked with [Footnote] or [Margin]. Output only the extracted text, nothing else.";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return fallback;
}

const DEFAULT_VISION_PAGE_CONCURRENCY = parsePositiveInt(process.env.VISION_OCR_PAGE_CONCURRENCY, 5);
const DEFAULT_VISION_BATCH_SIZE = parsePositiveInt(process.env.VISION_OCR_BATCH_SIZE, 2);
const DEFAULT_VISION_BATCH_CONCURRENCY = parsePositiveInt(process.env.VISION_OCR_BATCH_CONCURRENCY, 2);

function normalizeOcrText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return null;
}

function parseBatchVisionResponse(raw: string, expectedCount: number): string[] | null {
  const jsonString = extractJsonObject(raw);
  if (!jsonString) return null;

  try {
    const parsed = JSON.parse(jsonString) as {
      pages?: Array<{ page?: number; text?: string }>;
      texts?: string[];
    };

    if (Array.isArray(parsed.texts) && parsed.texts.length === expectedCount) {
      return parsed.texts.map((text) => normalizeOcrText(String(text ?? "")));
    }

    if (!Array.isArray(parsed.pages)) {
      return null;
    }

    if (
      parsed.pages.length === expectedCount &&
      parsed.pages.every((page) => typeof page.text === "string")
    ) {
      return parsed.pages.map((page) => normalizeOcrText(page.text ?? ""));
    }

    const results = new Array(expectedCount).fill("");
    for (const page of parsed.pages) {
      if (typeof page.page !== "number" || typeof page.text !== "string") continue;
      const index = Math.floor(page.page) - 1;
      if (index >= 0 && index < expectedCount) {
        results[index] = normalizeOcrText(page.text);
      }
    }

    if (results.some((text) => text.length > 0)) {
      return results;
    }
  } catch {
    return null;
  }

  return null;
}

async function readImageAsDataUrl(imagePath: string): Promise<string> {
  const imageBuffer = await readFile(imagePath);
  return `data:image/png;base64,${imageBuffer.toString("base64")}`;
}

async function extractVisionTextForPage(
  imagePath: string,
  pageNumber: number,
  totalPages: number
): Promise<string> {
  console.log(`[Vision OCR] Processing page ${pageNumber}/${totalPages}`);
  const imageUrl = await readImageAsDataUrl(imagePath);

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: SINGLE_PAGE_OCR_PROMPT,
          },
          {
            type: "image_url",
            image_url: {
              url: imageUrl,
              detail: "high",
            },
          },
        ],
      },
    ],
    max_tokens: 8192,
  });

  return normalizeOcrText(response.choices[0]?.message?.content || "");
}

async function extractVisionTextForBatch(
  imagePaths: string[],
  startPageIndex: number,
  totalPages: number
): Promise<string[]> {
  const startPage = startPageIndex + 1;
  const endPage = startPageIndex + imagePaths.length;
  console.log(`[Vision OCR] Processing pages ${startPage}-${endPage}/${totalPages} in batch`);

  const imageUrls = await Promise.all(imagePaths.map((imagePath) => readImageAsDataUrl(imagePath)));

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "high" } }
  > = [
    {
      type: "text",
      text: `You will receive ${imagePaths.length} scanned document pages in order. Extract ALL text from each page and preserve reading order. Respond ONLY as valid JSON with this exact shape: {"pages":[{"page":1,"text":"..."},{"page":2,"text":"..."}]}. Use page numbers 1 through ${imagePaths.length} relative to this batch.`,
    },
    ...imageUrls.map((url) => ({
      type: "image_url" as const,
      image_url: { url, detail: "high" as const },
    })),
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content }],
    response_format: { type: "json_object" },
    max_tokens: 16384,
  });

  const raw = response.choices[0]?.message?.content || "";
  const parsed = parseBatchVisionResponse(raw, imagePaths.length);
  if (!parsed) {
    throw new Error("Batch OCR returned invalid JSON format");
  }
  return parsed;
}

function chunkBySize<T>(items: T[], size: number): T[][] {
  if (size <= 1) {
    return items.map((item) => [item]);
  }
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Save an uploaded PDF buffer to a temp file.
 * Returns the path to the temp file.
 */
export async function saveTempPdf(buffer: Buffer): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "ocr-"));
  const tempPath = join(tempDir, "upload.pdf");
  await writeFile(tempPath, buffer);
  return tempPath;
}

/**
 * Clean up temporary files and directories.
 */
export async function cleanupTempFiles(...paths: string[]): Promise<void> {
  for (const p of paths) {
    try {
      await rm(p, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Run a Python script and capture stdout.
 */
function runPython(scriptPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [scriptPath, ...args], {
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
      // Log progress lines from Python
      const lines = data.toString().trim().split("\n");
      for (const line of lines) {
        if (line) console.log(`[OCR] ${line}`);
      }
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Python script exited with code ${code}: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn Python: ${err.message}`));
    });
  });
}

/**
 * Process a PDF with PaddleOCR (background, async).
 * Updates the document record when done.
 */
export async function processWithPaddleOcr(
  docId: string,
  tempPdfPath: string
): Promise<void> {
  try {
    const scriptPath = join(__dirname, "python", "pdf_pipeline.py");
    const stdout = await runPython(scriptPath, [
      "--mode=ocr",
      "--model=ppocr",
      "--dpi=200",
      tempPdfPath,
    ]);

    const fullText = stdout.replace(/\f/g, "\n\n").replace(/\s+/g, " ").trim();

    if (!fullText || fullText.length < 10) {
      await storage.updateDocument(docId, {
        status: "error",
        processingError: "PaddleOCR could not extract readable text from this PDF.",
      });
      return;
    }

    // Update document with extracted text
    await storage.updateDocument(docId, { fullText });

    // Chunk the text
    const chunks = chunkTextV2(fullText);
    for (const chunk of chunks) {
      await storage.createChunk({
        documentId: docId,
        text: chunk.text,
        startPosition: chunk.originalStartPosition,
        endPosition: chunk.originalStartPosition + chunk.text.length,
      });
    }

    await storage.updateDocument(docId, {
      chunkCount: chunks.length,
      status: "ready",
    });

    // Generate summary in background
    generateDocumentSummary(fullText).then(async (summaryData) => {
      await storage.updateDocument(docId, {
        summary: summaryData.summary,
        mainArguments: summaryData.mainArguments,
        keyConcepts: summaryData.keyConcepts,
      });
    });

    console.log(`[OCR] PaddleOCR complete for doc ${docId}: ${fullText.length} chars, ${chunks.length} chunks`);
  } catch (error) {
    console.error(`[OCR] PaddleOCR failed for doc ${docId}:`, error);
    await storage.updateDocument(docId, {
      status: "error",
      processingError: error instanceof Error ? error.message : "PaddleOCR processing failed",
    });
  } finally {
    await cleanupTempFiles(tempPdfPath, join(tempPdfPath, ".."));
  }
}

/**
 * Process a PDF with OpenAI Vision OCR (background, async).
 * Converts pages to images, sends each to GPT-4o Vision in parallel.
 */
export async function processWithVisionOcr(
  docId: string,
  tempPdfPath: string,
  options: VisionOcrOptions = {}
): Promise<void> {
  let imageDir: string | null = null;

  try {
    // Create output directory for images
    imageDir = await mkdtemp(join(tmpdir(), "vision-imgs-"));

    // Convert PDF to images
    const scriptPath = join(__dirname, "python", "pdf_to_images.py");
    const stdout = await runPython(scriptPath, [tempPdfPath, imageDir, "--dpi", "200"]);
    const result = JSON.parse(stdout) as { images: string[]; total_pages: number };

    if (!result.images || result.images.length === 0) {
      await storage.updateDocument(docId, {
        status: "error",
        processingError: "Could not convert PDF pages to images.",
      });
      return;
    }

    console.log(`[Vision OCR] Processing ${result.total_pages} pages for doc ${docId}`);

    // Use dynamic import for p-limit (ESM module)
    const pLimit = (await import("p-limit")).default;
    const useBatchMode = options.batchMode === true;
    const singlePageConcurrency = options.concurrency ?? DEFAULT_VISION_PAGE_CONCURRENCY;
    const batchConcurrency = options.concurrency ?? DEFAULT_VISION_BATCH_CONCURRENCY;
    const batchSize = Math.max(1, options.batchSize ?? DEFAULT_VISION_BATCH_SIZE);

    let pageTexts: string[];

    if (useBatchMode) {
      const indexedImages = result.images.map((imagePath, index) => ({ imagePath, index }));
      const batches = chunkBySize(indexedImages, batchSize);
      const limit = pLimit(batchConcurrency);
      pageTexts = new Array(result.images.length).fill("");

      await Promise.all(
        batches.map((batch) =>
          limit(async () => {
            const batchStartIndex = batch[0]?.index ?? 0;
            const batchImagePaths = batch.map((item) => item.imagePath);
            try {
              const batchTexts = await extractVisionTextForBatch(
                batchImagePaths,
                batchStartIndex,
                result.total_pages
              );
              batch.forEach((item, offset) => {
                pageTexts[item.index] = batchTexts[offset] || "";
              });
            } catch (batchError) {
              console.warn(
                `[Vision OCR] Batch ${batchStartIndex + 1}-${batchStartIndex + batch.length} failed, retrying per-page`,
                batchError
              );

              for (const item of batch) {
                pageTexts[item.index] = await extractVisionTextForPage(
                  item.imagePath,
                  item.index + 1,
                  result.total_pages
                );
              }
            }
          })
        )
      );
    } else {
      const limit = pLimit(singlePageConcurrency);
      pageTexts = await Promise.all(
        result.images.map((imagePath, index) =>
          limit(() => extractVisionTextForPage(imagePath, index + 1, result.total_pages))
        )
      );
    }

    // Stitch all page texts together
    const fullText = pageTexts.join("\n\n").replace(/\s+/g, " ").trim();

    if (!fullText || fullText.length < 10) {
      await storage.updateDocument(docId, {
        status: "error",
        processingError: "Vision OCR could not extract readable text from this PDF.",
      });
      return;
    }

    // Update document with extracted text
    await storage.updateDocument(docId, { fullText });

    // Chunk the text
    const chunks = chunkTextV2(fullText);
    for (const chunk of chunks) {
      await storage.createChunk({
        documentId: docId,
        text: chunk.text,
        startPosition: chunk.originalStartPosition,
        endPosition: chunk.originalStartPosition + chunk.text.length,
      });
    }

    await storage.updateDocument(docId, {
      chunkCount: chunks.length,
      status: "ready",
    });

    // Generate summary in background
    generateDocumentSummary(fullText).then(async (summaryData) => {
      await storage.updateDocument(docId, {
        summary: summaryData.summary,
        mainArguments: summaryData.mainArguments,
        keyConcepts: summaryData.keyConcepts,
      });
    });

    console.log(`[Vision OCR] Complete for doc ${docId}: ${fullText.length} chars, ${chunks.length} chunks`);
  } catch (error) {
    console.error(`[Vision OCR] Failed for doc ${docId}:`, error);
    await storage.updateDocument(docId, {
      status: "error",
      processingError: error instanceof Error ? error.message : "Vision OCR processing failed",
    });
  } finally {
    await cleanupTempFiles(tempPdfPath, join(tempPdfPath, ".."));
    if (imageDir) {
      await cleanupTempFiles(imageDir);
    }
  }
}
