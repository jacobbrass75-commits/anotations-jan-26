import { spawn } from "child_process";
import { writeFile, unlink, rmdir, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const PYTHON_DIR = path.join(import.meta.dirname, "python");
const SUBPROCESS_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export interface ScreenshotResult {
  screenshots: string[];
  total_pages: number;
}

export interface OcrPageResult {
  page: number;
  text: string;
  confidence: number;
}

export interface OcrResult {
  pages: OcrPageResult[];
  full_text: string;
  model: "ppocr" | "vl";
}

/**
 * Spawn a Python subprocess and collect its stdout/stderr.
 * Rejects on non-zero exit code or timeout.
 */
function runPython(script: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(PYTHON_DIR, script);
    const proc = spawn(PYTHON_BIN, [scriptPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: SUBPROCESS_TIMEOUT,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("error", (err) => {
      reject(
        new Error(
          `Python subprocess failed to start: ${err.message}. ` +
            `Ensure Python is installed and PYTHON_BIN is set correctly.`
        )
      );
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(
          new Error(
            `Python script "${script}" exited with code ${code}.\nStderr: ${stderr}`
          )
        );
      }
    });
  });
}

/**
 * Extract screenshot PNGs from specific PDF pages for vision analysis.
 */
export async function extractPdfScreenshots(
  pdfPath: string,
  pageNumbers: number[]
): Promise<ScreenshotResult> {
  const outputDir = await mkdtemp(path.join(tmpdir(), "pdf_screenshots_"));
  const pagesArg = pageNumbers.join(",");

  const stdout = await runPython("extract_screenshots.py", [
    "--pdf_path",
    pdfPath,
    "--pages",
    pagesArg,
    "--output_dir",
    outputDir,
  ]);

  return JSON.parse(stdout) as ScreenshotResult;
}

/**
 * Run OCR on a PDF using the specified model.
 */
export async function runOcr(
  pdfPath: string,
  model: "ppocr" | "vl",
  lang: string = "en"
): Promise<OcrResult> {
  const stdout = await runPython("ocr_extract.py", [
    "--pdf_path",
    pdfPath,
    "--model",
    model,
    "--lang",
    lang,
  ]);

  return JSON.parse(stdout) as OcrResult;
}

/**
 * Save a buffer as a temporary PDF file.
 * Returns the path to the temp file.
 */
export async function saveTempPdf(buffer: Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pdf_upload_"));
  const filePath = path.join(dir, "upload.pdf");
  await writeFile(filePath, buffer);
  return filePath;
}

/**
 * Clean up temporary files and directories.
 * Silently ignores errors (files may already be deleted).
 */
export async function cleanupTempFiles(...paths: string[]): Promise<void> {
  for (const p of paths) {
    try {
      // Try as file first, then as directory
      await unlink(p).catch(async () => {
        // If it's a directory, remove its contents then the dir
        const { readdir } = await import("fs/promises");
        try {
          const entries = await readdir(p);
          for (const entry of entries) {
            await unlink(path.join(p, entry)).catch(() => {});
          }
          await rmdir(p).catch(() => {});
        } catch {
          // Not a directory either, ignore
        }
      });
    } catch {
      // Ignore cleanup errors
    }
  }
}
