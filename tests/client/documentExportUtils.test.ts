import {
  getDocTypeLabel,
  stripMarkdown,
  toPdfSafeText,
  toSafeFilename,
} from "../../client/src/lib/documentExportUtils";
import {
  buildDocxBlob,
  buildPdfBlob,
} from "../../client/src/lib/documentExport";

describe("document export utilities", () => {
  it("strips markdown formatting to plain text", () => {
    expect(
      stripMarkdown(
        "# Title\nSome **bold** text with [a link](https://example.com), `inline code`, and ![img](x.png)."
      )
    ).toBe("Title Some bold text with a link, inline code, and .");
  });

  it("creates filesystem-safe filenames", () => {
    expect(toSafeFilename('Draft: "Illegal" / Title?')).toBe("Draft_ _Illegal_ _ Title_");
    expect(toSafeFilename("   ")).toBe("generated-paper");
  });

  it("maps filename extensions to user-facing labels", () => {
    expect(getDocTypeLabel("paper.pdf")).toBe("PDF");
    expect(getDocTypeLabel("notes.txt")).toBe("TXT");
    expect(getDocTypeLabel("scan.HEIC")).toBe("IMAGE");
    expect(getDocTypeLabel("report.docx")).toBe("DOC");
  });

  it("normalizes unsupported PDF punctuation for standard fonts", () => {
    expect(toPdfSafeText("non‑breaking – dash — quote “test” café ≥ 2")).toBe(
      "non-breaking - dash - quote \"test\" cafe >= 2"
    );
  });

  it("builds PDFs with punctuation that pdf-lib standard fonts cannot encode directly", async () => {
    const blob = await buildPdfBlob(
      "Export Test",
      "# Export Test\n\nFuture research must address non‑breaking hyphens, en dashes – and curly “quotes.”"
    );

    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("builds DOCX blobs without requiring Node buffers", async () => {
    const blob = await buildDocxBlob("Export Test", "# Export Test\n\nRegular document text.");

    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(blob.size).toBeGreaterThan(0);
  });
});
