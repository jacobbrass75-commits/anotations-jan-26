import { readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtemp } from "fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("source file persistence", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-source-files-"));
    vi.resetModules();
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("stores uploads under data/uploads and detects saved files", async () => {
    const { getDocumentSourcePath, hasDocumentSource, saveDocumentSource } = await import(
      "../../server/sourceFiles"
    );

    const filePath = await saveDocumentSource("doc-1", "Paper.PDF", Buffer.from("pdf-body"));

    expect(filePath).toBe(join(tempDir, "data", "uploads", "doc-1.pdf"));
    expect(getDocumentSourcePath("doc-2", "archive.thisextensioniswaytoolong")).toBe(
      join(tempDir, "data", "uploads", "doc-2.bin")
    );
    expect(await hasDocumentSource("doc-1", "Paper.PDF")).toBe(true);
    expect(await readFile(filePath, "utf8")).toBe("pdf-body");
  });

  it("infers MIME types from normalized extensions", async () => {
    const { inferDocumentSourceMimeType } = await import("../../server/sourceFiles");

    expect(inferDocumentSourceMimeType("scan.HEIC")).toBe("image/heic");
    expect(inferDocumentSourceMimeType("report.pdf")).toBe("application/pdf");
    expect(inferDocumentSourceMimeType("unknown.reallylongextension")).toBe("application/octet-stream");
  });
});
