import { describe, expect, it } from "vitest";

import { getInternalMarkdownHref } from "../../client/src/lib/markdownConfig";

describe("markdown link routing", () => {
  it("keeps project document quote links inside the app router", () => {
    expect(
      getInternalMarkdownHref(
        "/projects/project-1/documents/project-doc-1?annotationId=ann-1&start=42",
      ),
    ).toBe("/projects/project-1/documents/project-doc-1?annotationId=ann-1&start=42");
  });

  it("normalizes same-origin app URLs to relative routes", () => {
    expect(
      getInternalMarkdownHref(
        "https://app.scholarmark.ai/projects/project-1/documents/project-doc-1#quote",
        "https://app.scholarmark.ai",
      ),
    ).toBe("/projects/project-1/documents/project-doc-1#quote");
  });

  it("leaves external, api, and page-anchor links as normal browser links", () => {
    expect(
      getInternalMarkdownHref(
        "https://example.com/projects/project-1/documents/project-doc-1",
        "https://app.scholarmark.ai",
      ),
    ).toBeNull();
    expect(getInternalMarkdownHref("/api/documents/doc-1")).toBeNull();
    expect(getInternalMarkdownHref("#local-heading")).toBeNull();
  });
});
