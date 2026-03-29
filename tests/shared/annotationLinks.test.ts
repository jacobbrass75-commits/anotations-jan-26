import { buildProjectAnnotationJumpPath, buildTextFingerprint } from "../../shared/annotationLinks";

describe("annotation link helpers", () => {
  it("builds stable text fingerprints for deep-link anchors", () => {
    expect(buildTextFingerprint("  A Quote, With Punctuation!  ")).toBe("aquotewithpunctuation");
    expect(buildTextFingerprint("Mixed CASE 123")).toBe("mixedcase123");
  });

  it("builds project annotation jump paths with only populated params", () => {
    expect(
      buildProjectAnnotationJumpPath({
        projectId: "project-1",
        projectDocumentId: "doc-1",
        annotationId: "annotation-1",
        startPosition: 42,
        anchorFingerprint: "importantquote",
      })
    ).toBe(
      "/projects/project-1/documents/doc-1?annotationId=annotation-1&start=42&anchor=importantquote"
    );

    expect(
      buildProjectAnnotationJumpPath({
        projectId: "project-1",
        projectDocumentId: "doc-1",
      })
    ).toBe("/projects/project-1/documents/doc-1");
  });
});
