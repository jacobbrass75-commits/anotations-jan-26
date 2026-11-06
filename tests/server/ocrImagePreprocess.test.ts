import { access, mkdtemp, readFile, rm, unlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { crc32, deflateSync } from "zlib";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Keep the OCR module isolated from the database / AI clients. sharp itself is NOT mocked:
// these tests exercise the real native decoder used by the HEIC/vision preprocessing path.
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/openai", () => ({ generateDocumentSummary: vi.fn() }));
vi.mock("../../server/sourceFiles", () => ({ saveDocumentSource: vi.fn() }));
vi.mock("../../server/pipelineV2", () => ({ chunkTextV2: vi.fn() }));

const { preprocessImageForVision } = await import("../../server/ocrProcessor");

function documentLikeRaster(width: number, height: number): Buffer {
  const raw = Buffer.alloc(width * height * 3, 255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ink = y % 40 < 12 && (x * 7 + y * 3) % 23 < 15 && x > 40 && x < width - 40;
      const value = ink ? 20 : 250 - ((x + y) % 7);
      raw.fill(value, (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  }
  return raw;
}

function encode(width: number, height: number) {
  return sharp(documentLikeRaster(width, height), { raw: { width, height, channels: 3 } });
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed) >>> 0);
  return Buffer.concat([length, typed, crc]);
}

/** A tiny PNG whose header claims 20000x20000 pixels (above sharp's default pixel limit). */
function pixelBombPng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(20_000, 0);
  ihdr.writeUInt32BE(20_000, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.alloc(1024))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("preprocessImageForVision (real sharp)", () => {
  let inputDir = "";
  let outputDir = "";

  beforeAll(async () => {
    inputDir = await mkdtemp(join(tmpdir(), "scholarmark-ocr-pre-in-"));
    outputDir = await mkdtemp(join(tmpdir(), "scholarmark-ocr-pre-out-"));
  });

  afterAll(async () => {
    await rm(inputDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
  });

  // Mirrors the HEIC callers: the converted bytes are written to a temp path and the same
  // buffer is handed to preprocessing, with the path kept as the fallback.
  async function writeInput(name: string, buffer: Buffer): Promise<string> {
    const path = join(inputDir, name);
    await writeFile(path, buffer);
    return path;
  }

  async function preprocess(inputPath: string, name: string): Promise<string> {
    return preprocessImageForVision(await readFile(inputPath), inputPath, outputDir, name);
  }

  // The OCR callers delete their temp inputs right after preprocessing. On Windows an open
  // native handle makes that unlink fail with EPERM, so prove the input is released.
  async function expectInputReleased(inputPath: string) {
    await unlink(inputPath);
    await expect(access(inputPath)).rejects.toMatchObject({ code: "ENOENT" });
  }

  async function expectPreprocessedJpeg(inputPath: string, name: string) {
    const outputPath = await preprocess(inputPath, name);
    expect(outputPath).toBe(join(outputDir, `${name}.jpg`));
    await expectInputReleased(inputPath);
    const metadata = await sharp(await readFile(outputPath)).metadata();
    expect(metadata.format).toBe("jpeg");
    return metadata;
  }

  it("preprocesses an ordinary portrait JPEG without changing its orientation", async () => {
    const input = await writeInput("ordinary.jpg", await encode(600, 800).jpeg().toBuffer());
    const metadata = await expectPreprocessedJpeg(input, "ordinary-jpg");
    expect([metadata.width, metadata.height]).toEqual([600, 800]);
  });

  it("preprocesses an ordinary PNG to JPEG", async () => {
    const input = await writeInput("ordinary.png", await encode(600, 800).png().toBuffer());
    const metadata = await expectPreprocessedJpeg(input, "ordinary-png");
    expect([metadata.width, metadata.height]).toEqual([600, 800]);
  });

  it("rotates landscape captures to portrait and caps the long edge", async () => {
    const input = await writeInput("landscape.jpg", await encode(3000, 1000).jpeg().toBuffer());
    const metadata = await expectPreprocessedJpeg(input, "landscape");
    expect(metadata.height).toBe(2200);
    expect(metadata.width).toBe(733);
  });

  it("still decodes truncated JPEG input instead of falling back to the original", async () => {
    const full = await encode(600, 800).jpeg().toBuffer();
    const input = await writeInput(
      "truncated.jpg",
      full.subarray(0, Math.floor(full.length * 0.6)),
    );
    const metadata = await expectPreprocessedJpeg(input, "truncated-jpg");
    expect([metadata.width, metadata.height]).toEqual([600, 800]);
  });

  it("still decodes truncated PNG input instead of falling back to the original", async () => {
    const full = await encode(600, 800).png().toBuffer();
    const input = await writeInput(
      "truncated.png",
      full.subarray(0, Math.floor(full.length * 0.6)),
    );
    const metadata = await expectPreprocessedJpeg(input, "truncated-png");
    expect([metadata.width, metadata.height]).toEqual([600, 800]);
  });

  it("falls back to the original path for undecodable input", async () => {
    const input = await writeInput("garbage.jpg", Buffer.from("not an image ".repeat(32)));
    await expect(preprocess(input, "garbage")).resolves.toBe(input);
    await expectInputReleased(input);
  });

  it("keeps sharp's input pixel limit in force", async () => {
    const input = await writeInput("pixel-bomb.png", pixelBombPng());
    await expect(sharp(await readFile(input), { failOn: "none" }).toBuffer()).rejects.toThrow(
      /pixel limit/i,
    );
    await expect(preprocess(input, "pixel-bomb")).resolves.toBe(input);
    await expectInputReleased(input);
  });
});
