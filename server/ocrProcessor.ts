import { spawn } from "child_process";
import { writeFile, readFile, rm, mkdtemp } from "fs/promises";
import { join, dirname, extname } from "path";
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

export const SUPPORTED_VISION_OCR_MODELS = ["gpt-4o", "gpt-4o-mini"] as const;
export type VisionOcrModel = (typeof SUPPORTED_VISION_OCR_MODELS)[number];

interface VisionOcrOptions {
  batchMode?: boolean;
  batchSize?: number;
  concurrency?: number;
  model?: VisionOcrModel;
}

const HEIC_EXTENSIONS = new Set([".heic", ".heif"]);

const SINGLE_PAGE_OCR_PROMPT =
  "Extract ALL text from this scanned document page. Preserve paragraphs and reading order. For tables, render each row on its own line with columns separated by ' | '. For footnotes or marginalia, include them at the end marked with [Footnote] or [Margin]. Output only the extracted text, nothing else.";

function resolveVisionOcrModel(requestedModel: string | undefined): VisionOcrModel {
  const normalized = (requestedModel || "").toLowerCase();
  if (SUPPORTED_VISION_OCR_MODELS.includes(normalized as VisionOcrModel)) {
    return normalized as VisionOcrModel;
  }
  return "gpt-4o";
}

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
const DEFAULT_VISION_AUTO_BATCH_THRESHOLD = parsePositiveInt(
  process.env.VISION_OCR_AUTO_BATCH_THRESHOLD,
  8
);
const VISION_MAX_RETRIES = parsePositiveInt(process.env.VISION_OCR_MAX_RETRIES, 8);
const VISION_DEFAULT_RETRY_DELAY_MS = parsePositiveInt(process.env.VISION_OCR_RETRY_DELAY_MS, 1000);
const VISION_TPM_LIMIT = parsePositiveInt(process.env.VISION_OCR_TPM_LIMIT, 30000);
const VISION_ESTIMATED_TOKENS_PER_REQUEST = parsePositiveInt(
  process.env.VISION_OCR_ESTIMATED_TOKENS_PER_REQUEST,
  900
);
const VISION_MIN_REQUEST_GAP_MS = parsePositiveInt(
  process.env.VISION_OCR_MIN_REQUEST_GAP_MS,
  Math.ceil((60_000 * VISION_ESTIMATED_TOKENS_PER_REQUEST) / VISION_TPM_LIMIT)
);
const DEFAULT_VISION_MODEL = resolveVisionOcrModel(process.env.VISION_OCR_MODEL);

let visionRequestSchedule: Promise<void> = Promise.resolve();
let nextVisionRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForVisionRequestSlot(): Promise<void> {
  const reserveSlot = async () => {
    if (VISION_MIN_REQUEST_GAP_MS <= 0) {
      return;
    }
    const waitMs = Math.max(0, nextVisionRequestAt - Date.now());
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    nextVisionRequestAt = Date.now() + VISION_MIN_REQUEST_GAP_MS;
  };

  visionRequestSchedule = visionRequestSchedule.then(reserveSlot, reserveSlot);
  await visionRequestSchedule;
}

function getHeaderValue(headers: unknown, key: string): string | null {
  if (!headers) return null;

  if (typeof headers === "object" && headers !== null && "get" in headers) {
    const getter = (headers as { get?: (name: string) => string | null }).get;
    if (typeof getter === "function") {
      return getter.call(headers, key);
    }
  }

  if (typeof headers === "object" && headers !== null) {
    const value = (headers as Record<string, unknown>)[key] ?? (headers as Record<string, unknown>)[key.toLowerCase()];
    if (typeof value === "string") return value;
  }

  return null;
}

function parseDurationMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.ceil(Number(trimmed));
  }

  let totalMs = 0;
  const durationRegex = /(\d+(?:\.\d+)?)(ms|m|s)/gi;
  let matched = false;
  let match: RegExpExecArray | null;
  while ((match = durationRegex.exec(trimmed)) !== null) {
    matched = true;
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(amount)) continue;
    if (unit === "m") totalMs += amount * 60_000;
    if (unit === "s") totalMs += amount * 1_000;
    if (unit === "ms") totalMs += amount;
  }

  return matched && totalMs > 0 ? Math.ceil(totalMs) : null;
}

function parseRetryDelayFromMessage(message: string | undefined): number | null {
  if (!message) return null;
  const msMatch = message.match(/try again in\s*([0-9]+(?:\.[0-9]+)?)\s*ms/i);
  if (msMatch?.[1]) {
    return Math.ceil(Number(msMatch[1]));
  }
  const sMatch = message.match(/try again in\s*([0-9]+(?:\.[0-9]+)?)\s*s/i);
  if (sMatch?.[1]) {
    return Math.ceil(Number(sMatch[1]) * 1000);
  }
  return null;
}

function isRateLimitedError(error: unknown): boolean {
  const candidate = error as {
    status?: number;
    code?: string;
    error?: { code?: string; type?: string };
  };

  return (
    candidate?.status === 429 ||
    candidate?.code === "rate_limit_exceeded" ||
    candidate?.error?.code === "rate_limit_exceeded" ||
    candidate?.error?.type === "tokens"
  );
}

function getRateLimitDelayMs(error: unknown, attempt: number): number {
  const candidate = error as {
    headers?: unknown;
    message?: string;
    error?: { message?: string };
  };

  const retryAfterMsHeader = parseDurationMs(getHeaderValue(candidate?.headers, "retry-after-ms"));
  if (retryAfterMsHeader) return retryAfterMsHeader;

  const retryAfterHeader = parseDurationMs(getHeaderValue(candidate?.headers, "retry-after"));
  if (retryAfterHeader) {
    // retry-after header is usually seconds when unitless
    if (/^\d+(\.\d+)?$/.test((getHeaderValue(candidate?.headers, "retry-after") || "").trim())) {
      return Math.ceil(retryAfterHeader * 1000);
    }
    return retryAfterHeader;
  }

  const resetTokensHeader = parseDurationMs(getHeaderValue(candidate?.headers, "x-ratelimit-reset-tokens"));
  if (resetTokensHeader) return resetTokensHeader;

  const messageDelay =
    parseRetryDelayFromMessage(candidate?.message) ||
    parseRetryDelayFromMessage(candidate?.error?.message);
  if (messageDelay) return messageDelay;

  const exponential = VISION_DEFAULT_RETRY_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(exponential, 30_000);
}

async function runVisionRequestWithRetry<T>(
  label: string,
  task: () => Promise<T>
): Promise<T> {
  for (let attempt = 1; attempt <= VISION_MAX_RETRIES; attempt++) {
    await waitForVisionRequestSlot();

    try {
      return await task();
    } catch (error) {
      if (!isRateLimitedError(error) || attempt >= VISION_MAX_RETRIES) {
        throw error;
      }

      const delayMs = getRateLimitDelayMs(error, attempt) + Math.floor(Math.random() * 250);
      console.warn(
        `[Vision OCR] Rate-limited during ${label} (attempt ${attempt}/${VISION_MAX_RETRIES}). Retrying in ${delayMs}ms`
      );
      await sleep(delayMs);
    }
  }

  throw new Error(`[Vision OCR] Retries exhausted for ${label}`);
}

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
  totalPages: number,
  model: VisionOcrModel
): Promise<string> {
  console.log(`[Vision OCR] Processing page ${pageNumber}/${totalPages} with model=${model}`);
  const imageUrl = await readImageAsDataUrl(imagePath);

  const response = await runVisionRequestWithRetry(`page ${pageNumber}/${totalPages}`, () =>
    openai.chat.completions.create({
      model,
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
      max_tokens: 4096,
    })
  );

  return normalizeOcrText(response.choices[0]?.message?.content || "");
}

async function extractVisionTextForBatch(
  imagePaths: string[],
  startPageIndex: number,
  totalPages: number,
  model: VisionOcrModel
): Promise<string[]> {
  const startPage = startPageIndex + 1;
  const endPage = startPageIndex + imagePaths.length;
  console.log(`[Vision OCR] Processing pages ${startPage}-${endPage}/${totalPages} in batch with model=${model}`);

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

  const response = await runVisionRequestWithRetry(`batch ${startPage}-${endPage}/${totalPages}`, () =>
    openai.chat.completions.create({
      model,
      messages: [{ role: "user", content }],
      response_format: { type: "json_object" },
      max_tokens: 8192,
    })
  );

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
 * Save an uploaded file buffer to a temp file with matching extension.
 */
export async function saveTempUpload(
  buffer: Buffer,
  originalFilename: string
): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "ocr-upload-"));
  const extension = extname(originalFilename).toLowerCase();
  const safeExtension = extension && extension.length <= 10 ? extension : ".bin";
  const tempPath = join(tempDir, `upload${safeExtension}`);
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

async function extractVisionTextsFromImagePaths(
  docId: string,
  imagePaths: string[],
  options: VisionOcrOptions = {}
): Promise<string[]> {
  const totalPages = imagePaths.length;
  if (totalPages === 0) {
    return [];
  }

  // Use dynamic import for p-limit (ESM module)
  const pLimit = (await import("p-limit")).default;
  const useBatchMode =
    options.batchMode === true ||
    (options.batchMode !== false && totalPages >= DEFAULT_VISION_AUTO_BATCH_THRESHOLD);
  const singlePageConcurrency = options.concurrency ?? DEFAULT_VISION_PAGE_CONCURRENCY;
  const batchConcurrency = options.concurrency ?? DEFAULT_VISION_BATCH_CONCURRENCY;
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_VISION_BATCH_SIZE);
  const model = options.model ?? DEFAULT_VISION_MODEL;

  console.log(
    `[Vision OCR] Mode=${useBatchMode ? "batch" : "page"} pages=${totalPages} batchSize=${batchSize} model=${model} minGapMs=${VISION_MIN_REQUEST_GAP_MS} doc=${docId}`
  );

  if (useBatchMode) {
    const indexedImages = imagePaths.map((imagePath, index) => ({ imagePath, index }));
    const batches = chunkBySize(indexedImages, batchSize);
    const limit = pLimit(batchConcurrency);
    const pageTexts = new Array(totalPages).fill("");

    await Promise.all(
      batches.map((batch) =>
        limit(async () => {
          const batchStartIndex = batch[0]?.index ?? 0;
          const batchImagePaths = batch.map((item) => item.imagePath);
          try {
            const batchTexts = await extractVisionTextForBatch(
              batchImagePaths,
              batchStartIndex,
              totalPages,
              model
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
                totalPages,
                model
              );
            }
          }
        })
      )
    );

    return pageTexts;
  }

  const limit = pLimit(singlePageConcurrency);
  return Promise.all(
    imagePaths.map((imagePath, index) =>
      limit(() => extractVisionTextForPage(imagePath, index + 1, totalPages, model))
    )
  );
}

async function saveVisionOcrResult(
  docId: string,
  pageTexts: string[],
  noTextErrorMessage: string
): Promise<{ fullText: string; chunkCount: number }> {
  const fullText = pageTexts.join("\n\n").replace(/\s+/g, " ").trim();

  if (!fullText || fullText.length < 10) {
    await storage.updateDocument(docId, {
      status: "error",
      processingError: noTextErrorMessage,
    });
    return { fullText: "", chunkCount: 0 };
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

  return { fullText, chunkCount: chunks.length };
}

/**
 * Process a PDF with OpenAI Vision OCR (background, async).
 * Converts pages to images, sends each to GPT-4o Vision.
 */
export async function processWithVisionOcr(
  docId: string,
  tempPdfPath: string,
  options: VisionOcrOptions = {}
): Promise<void> {
  let imageDir: string | null = null;

  try {
    imageDir = await mkdtemp(join(tmpdir(), "vision-imgs-"));

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
    const pageTexts = await extractVisionTextsFromImagePaths(docId, result.images, options);
    const { fullText, chunkCount } = await saveVisionOcrResult(
      docId,
      pageTexts,
      "Vision OCR could not extract readable text from this PDF."
    );
    if (!fullText) return;

    console.log(`[Vision OCR] Complete for doc ${docId}: ${fullText.length} chars, ${chunkCount} chunks`);
  } catch (error) {
    console.error(`[Vision OCR] Failed for doc ${docId}:`, error);
    await storage.updateDocument(docId, {
      status: "error",
      processingError: error instanceof Error ? error.message : "Vision OCR processing failed",
    });
  } finally {
    await cleanupTempFiles(tempPdfPath, dirname(tempPdfPath));
    if (imageDir) {
      await cleanupTempFiles(imageDir);
    }
  }
}

/**
 * Process an uploaded image file with Vision OCR.
 * Supports HEIC/HEIF multi-image containers.
 */
export async function processImageWithVisionOcr(
  docId: string,
  tempImagePath: string,
  originalFilename: string,
  options: VisionOcrOptions = {}
): Promise<void> {
  let extractedImageDir: string | null = null;

  try {
    const extension = extname(originalFilename).toLowerCase();
    let imagePaths = [tempImagePath];

    if (HEIC_EXTENSIONS.has(extension)) {
      extractedImageDir = await mkdtemp(join(tmpdir(), "vision-heic-"));
      const inputBuffer = await readFile(tempImagePath);

      const heicConvert = await import("heic-convert");
      const convertAll = heicConvert.all || heicConvert.default?.all;
      if (typeof convertAll !== "function") {
        throw new Error("HEIC conversion is unavailable (missing convert.all)");
      }

      const images = (await convertAll({
        buffer: inputBuffer,
        format: "PNG",
      })) as Array<{ convert: () => Promise<Buffer> }>;

      if (!Array.isArray(images) || images.length === 0) {
        throw new Error("No images found in HEIC/HEIF file.");
      }

      imagePaths = [];
      for (let index = 0; index < images.length; index++) {
        const convertedBuffer = await images[index].convert();
        const outputPath = join(extractedImageDir, `image_${index + 1}.png`);
        await writeFile(outputPath, convertedBuffer);
        imagePaths.push(outputPath);
      }

      console.log(`[Vision OCR] Extracted ${imagePaths.length} image(s) from ${extension} for doc ${docId}`);
    }

    if (imagePaths.length === 0) {
      await storage.updateDocument(docId, {
        status: "error",
        processingError: "No readable images were found in the uploaded file.",
      });
      return;
    }

    const imageOptions: VisionOcrOptions = {
      ...options,
      batchMode: options.batchMode ?? imagePaths.length > 1,
    };

    console.log(`[Vision OCR] Processing ${imagePaths.length} image(s) for doc ${docId}`);
    const pageTexts = await extractVisionTextsFromImagePaths(docId, imagePaths, imageOptions);
    const { fullText, chunkCount } = await saveVisionOcrResult(
      docId,
      pageTexts,
      "Vision OCR could not extract readable text from this image file."
    );
    if (!fullText) return;

    console.log(`[Vision OCR] Complete for image doc ${docId}: ${fullText.length} chars, ${chunkCount} chunks`);
  } catch (error) {
    console.error(`[Vision OCR] Image processing failed for doc ${docId}:`, error);
    await storage.updateDocument(docId, {
      status: "error",
      processingError: error instanceof Error ? error.message : "Image OCR processing failed",
    });
  } finally {
    await cleanupTempFiles(tempImagePath, dirname(tempImagePath));
    if (extractedImageDir) {
      await cleanupTempFiles(extractedImageDir);
    }
  }
}
