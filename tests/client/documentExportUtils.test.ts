import {
  getDocTypeLabel,
  stripMarkdown,
  toSafeFilename,
} from "../../client/src/lib/documentExportUtils";

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
});
