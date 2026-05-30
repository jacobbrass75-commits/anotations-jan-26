import { describe, expect, it } from "vitest";
import { wrapGeneratedDocumentIfNeeded } from "../../server/chatDocumentFormatting";

describe("chat document formatting", () => {
  it("wraps substantial markdown drafts when the model omits document tags", () => {
    const body = [
      "# Age-Responsive Assessment",
      "",
      "## Introduction",
      Array.from({ length: 340 }, (_, index) => `word${index}`).join(" "),
      "",
      "[^1]: Test citation.",
    ].join("\n");

    const wrapped = wrapGeneratedDocumentIfNeeded(body);

    expect(wrapped).toContain('<document title="Age-Responsive Assessment">');
    expect(wrapped).toContain(body);
    expect(wrapped).toContain("</document>");
  });

  it("does not double-wrap existing document-tagged content", () => {
    const content = '<document title="Draft">Already wrapped</document>';

    expect(wrapGeneratedDocumentIfNeeded(content)).toBe(content);
  });
});
