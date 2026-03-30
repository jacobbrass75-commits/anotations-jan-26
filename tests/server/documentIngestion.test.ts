import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapTempWorkspace } from "./helpers/bootstrapTempWorkspace";

const generateDocumentSummary = vi.fn(async () => ({
  summary: "Condensed summary",
  mainArguments: ["Argument A"],
  keyConcepts: ["Concept A"],
}));

vi.mock("../../server/openai", async () => {
  const actual = await vi.importActual<typeof import("../../server/openai")>("../../server/openai");
  return {
    ...actual,
    generateDocumentSummary,
  };
});

describe("document ingestion", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-document-ingestion-"));
    vi.resetModules();
    generateDocumentSummary.mockClear();
    process.chdir(tempDir);
    await bootstrapTempWorkspace(tempDir);
  });

  afterEach(async () => {
    sqlite?.close();
    sqlite = null;
    process.chdir(originalCwd);
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("normalizes pasted source titles into safe txt filenames", async () => {
    const { normalizePastedSourceFilename } = await import("../../server/documentIngestion");

    expect(normalizePastedSourceFilename("  Notes / Draft \n  ")).toBe("Notes Draft.txt");
    expect(normalizePastedSourceFilename("already.txt")).toBe("already.txt");
    expect(normalizePastedSourceFilename("")).toBe("Pasted Source.txt");
  });

  it("stores pasted text as a normal document source with chunks and summary metadata", async () => {
    const { createTextBackedDocument } = await import("../../server/documentIngestion");
    const { storage } = await import("../../server/storage");
    const { sqlite: importedSqlite } = await import("../../server/db");
    const { hasDocumentSource } = await import("../../server/sourceFiles");

    sqlite = importedSqlite;

    const created = await createTextBackedDocument({
      filename: "Pasted Source.txt",
      fullText:
        "This is a pasted research source with enough length to chunk and summarize.\n\nIt includes multiple sentences for the ingestion path.",
      sourceBuffer: Buffer.from(
        "This is a pasted research source with enough length to chunk and summarize.\n\nIt includes multiple sentences for the ingestion path.",
        "utf-8"
      ),
      userId: "user-1",
    });

    expect(created).toBeDefined();
    expect(created?.filename).toBe("Pasted Source.txt");
    expect(created?.chunkCount).toBeGreaterThan(0);
    expect(await hasDocumentSource(created!.id, created!.filename)).toBe(true);

    const chunks = await storage.getChunksForDocument(created!.id);
    expect(chunks.length).toBe(created?.chunkCount);
    expect(chunks[0]?.text.length).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 0));

    const stored = await storage.getDocument(created!.id);
    expect(generateDocumentSummary).toHaveBeenCalledWith(created?.fullText);
    expect(stored).toMatchObject({
      id: created?.id,
      summary: "Condensed summary",
      mainArguments: ["Argument A"],
      keyConcepts: ["Concept A"],
    });
  });
});
