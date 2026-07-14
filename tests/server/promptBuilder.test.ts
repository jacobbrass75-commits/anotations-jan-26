import {
  ANNOTATION_PROMPT_TOKEN_BUDGET,
  CHAT_SOURCE_PROMPT_BYTE_BUDGET,
  buildQuoteJumpTargets,
  buildSourceBlock,
  buildWritingSystemPrompt,
  planSourceBlock,
} from "../../server/chat/promptBuilder";
import {
  selectAnnotationsForPrompt,
  type TieredSource,
  type WritingSource,
} from "../../server/writingPipeline";
import type { ProjectAnnotation } from "../../shared/schema";

function makeAnnotation(overrides: Partial<ProjectAnnotation> = {}): ProjectAnnotation {
  return {
    id: `ann-${Math.random().toString(36).slice(2, 10)}`,
    projectDocumentId: "pdoc-1",
    startPosition: 0,
    endPosition: 100,
    highlightedText: "x".repeat(400),
    category: "evidence",
    note: "A note explaining relevance.",
    isAiGenerated: true,
    confidenceScore: 0.8,
    promptText: null,
    promptIndex: null,
    promptColor: null,
    analysisRunId: null,
    searchableContent: null,
    searchEmbedding: null,
    createdAt: new Date(),
    ...overrides,
  } as ProjectAnnotation;
}

function makeTieredSource(annotations: ProjectAnnotation[], id = "source-1"): TieredSource {
  return {
    id,
    kind: "project_document",
    title: `Source ${id}`,
    author: "Author",
    category: "project_source",
    citationData: null,
    documentFilename: `${id}.pdf`,
    summary: "Summary.",
    mainArguments: null,
    keyConcepts: null,
    roleInProject: null,
    projectContext: null,
    sourceRole: "evidence",
    styleAnalysis: null,
    chunkCount: 10,
    annotations,
    excerpt: "Excerpt.",
    documentId: `doc-${id}`,
  };
}

describe("selectAnnotationsForPrompt", () => {
  it("returns all annotations when no cap applies", () => {
    const annotations = [makeAnnotation(), makeAnnotation()];
    expect(selectAnnotationsForPrompt(annotations)).toHaveLength(2);
    expect(selectAnnotationsForPrompt(annotations, 5)).toHaveLength(2);
  });

  it("prefers manual annotations, then higher confidence, and outputs document order", () => {
    const manual = makeAnnotation({
      id: "manual",
      isAiGenerated: false,
      confidenceScore: null,
      startPosition: 500,
    });
    const lowConfidence = makeAnnotation({
      id: "low",
      confidenceScore: 0.3,
      startPosition: 100,
    });
    const highConfidence = makeAnnotation({
      id: "high",
      confidenceScore: 0.95,
      startPosition: 300,
    });

    const selected = selectAnnotationsForPrompt([lowConfidence, manual, highConfidence], 2);

    expect(selected.map((annotation) => annotation.id)).toEqual(["high", "manual"]);
    expect(selected[0].startPosition).toBeLessThan(selected[1].startPosition);
  });
});

describe("planSourceBlock", () => {
  it("applies no caps when annotations fit the budget", () => {
    const source = makeTieredSource([makeAnnotation(), makeAnnotation()]);
    const plan = planSourceBlock([source]);

    expect(plan.perSourceLimits).toBeNull();
    expect(plan.includedAnnotations).toBe(2);
    expect(plan.totalAnnotations).toBe(2);
  });

  it("caps per-source annotations when the corpus exceeds the budget", () => {
    // Each annotation is ~(400 + 28 + 120)/4 ≈ 137 tokens; 100 per source x 2
    // sources ≈ 27K tokens, well past the budget.
    const sources = [
      makeTieredSource(
        Array.from({ length: 100 }, () => makeAnnotation()),
        "a",
      ),
      makeTieredSource(
        Array.from({ length: 100 }, () => makeAnnotation()),
        "b",
      ),
    ];

    const plan = planSourceBlock(sources);

    expect(plan.perSourceLimits).not.toBeNull();
    expect(plan.totalAnnotations).toBe(200);
    expect(plan.includedAnnotations).toBeLessThan(plan.totalAnnotations);
    expect(plan.estimatedAnnotationTokens).toBeGreaterThan(ANNOTATION_PROMPT_TOKEN_BUDGET);

    const limits = Array.from(plan.perSourceLimits!.values());
    expect(limits).toHaveLength(2);
    for (const limit of limits) {
      expect(limit).toBeGreaterThanOrEqual(3);
      expect(limit).toBeLessThan(100);
    }
  });
});

describe("buildSourceBlock", () => {
  it("renders every annotation for small projects", () => {
    const source = makeTieredSource([
      makeAnnotation({ id: "keep-1" }),
      makeAnnotation({ id: "keep-2" }),
    ]);

    const block = buildSourceBlock([source]);

    expect(block).toContain("[ANNOTATION keep-1]");
    expect(block).toContain("[ANNOTATION keep-2]");
    expect(block).not.toContain("more annotations not shown");
  });

  it("truncates oversized projects and signals retrievability", () => {
    const annotations = Array.from({ length: 120 }, (_, index) =>
      makeAnnotation({ id: `ann-${index}`, startPosition: index * 10 }),
    );
    const source = makeTieredSource(annotations);

    const block = buildSourceBlock([source]);

    expect(block).toContain("showing");
    expect(block).toMatch(/\d+ more annotations not shown/);
    const renderedCount = (block.match(/\[ANNOTATION ann-/g) || []).length;
    expect(renderedCount).toBeLessThan(120);
    expect(renderedCount).toBeGreaterThanOrEqual(3);
  });

  it("bounds five large non-ASCII web clips while retaining every source stub", () => {
    const sources: WritingSource[] = Array.from({ length: 5 }, (_, index) => ({
      id: `web-${index + 1}`,
      kind: "web_clip",
      title: `Web source ${index + 1}`,
      author: "Author",
      excerpt: "A selected excerpt.",
      fullText: "漢🙂".repeat(15_000),
      category: "web_clip",
      note: null,
      citationData: null,
      documentFilename: `web-${index + 1}.txt`,
    }));

    const prompt = buildWritingSystemPrompt(sources, null, null);

    expect(Buffer.byteLength(prompt, "utf8")).toBeLessThan(
      CHAT_SOURCE_PROMPT_BYTE_BUDGET + 10_000,
    );
    for (const source of sources) {
      expect(prompt).toContain(`[SOURCE ${source.id}]`);
    }
    expect(prompt).toContain("additional source text omitted");
  });
});

describe("buildQuoteJumpTargets", () => {
  it("does not create project document links for standalone conversations", () => {
    const source = makeTieredSource([makeAnnotation({ highlightedText: "A grounded quote." })]);

    expect(buildQuoteJumpTargets(null, [source])).toEqual([]);
  });

  it("uses project document ids for quote links", () => {
    const source = makeTieredSource(
      [
        makeAnnotation({
          id: "ann-1",
          highlightedText: "A grounded quote.",
          startPosition: 42,
        }),
      ],
      "project-doc-1",
    );

    const targets = buildQuoteJumpTargets("project-1", [source]);

    expect(targets).toEqual([
      {
        quote: "A grounded quote.",
        jumpPath:
          "/projects/project-1/documents/project-doc-1?annotationId=ann-1&start=42&anchor=agroundedquote",
      },
    ]);
    expect(targets[0].jumpPath).not.toContain("doc-project-doc-1");
  });
});
