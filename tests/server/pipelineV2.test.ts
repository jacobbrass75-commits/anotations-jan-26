import { vi } from "vitest";

const createCompletion = vi.fn();

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: createCompletion } };
  },
}));

// aiUsage pulls in authStorage -> sqlite; the pipeline only calls reportProviderUsage.
vi.mock("../../server/aiUsage", () => ({
  reportProviderUsage: vi.fn(),
}));

import {
  generateCandidatesV2,
  hardVerifyCandidateV2,
  softVerifyCandidatesV2,
} from "../../server/pipelineV2";
import type { CandidateAnnotation } from "../../shared/schema";

function completionWith(content: string | null) {
  return { choices: [{ message: { content } }], usage: {} };
}

function makeCandidate(overrides: Partial<CandidateAnnotation> = {}): CandidateAnnotation {
  return {
    highlightStart: 0,
    highlightEnd: 40,
    highlightText: "A substantive claim about the research topic.",
    category: "evidence",
    note: "Supports the intent directly.",
    confidence: 0.8,
    ...overrides,
  };
}

beforeEach(() => {
  createCompletion.mockReset();
});

describe("generateCandidatesV2 (fail honest)", () => {
  it("accepts an empty candidate list as a legitimate answer", async () => {
    createCompletion.mockResolvedValue(completionWith('{"candidates": []}'));

    const candidates = await generateCandidatesV2("Some chunk text.", "research intent");

    expect(candidates).toEqual([]);
  });

  it("returns no candidates when the model returns no content", async () => {
    createCompletion.mockResolvedValue(completionWith(null));

    expect(await generateCandidatesV2("Some chunk text.", "intent")).toEqual([]);
  });

  it("returns no candidates on model error instead of fabricating heuristics", async () => {
    createCompletion.mockRejectedValue(new Error("API down"));

    expect(await generateCandidatesV2("Some chunk text.", "intent")).toEqual([]);
  });

  it("passes through valid candidates", async () => {
    const candidate = makeCandidate();
    createCompletion.mockResolvedValue(completionWith(JSON.stringify({ candidates: [candidate] })));

    const candidates = await generateCandidatesV2("Some chunk text.", "intent");

    expect(candidates).toHaveLength(1);
    expect(candidates[0].highlightText).toBe(candidate.highlightText);
  });
});

describe("softVerifyCandidatesV2 (fail closed)", () => {
  it("rejects all candidates when the verifier errors", async () => {
    createCompletion.mockRejectedValue(new Error("API down"));

    const verdicts = await softVerifyCandidatesV2([makeCandidate()], "chunk", "intent");

    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].approved).toBe(false);
    expect(verdicts[0].qualityScore).toBe(0);
  });

  it("rejects all candidates when the verifier returns no content", async () => {
    createCompletion.mockResolvedValue(completionWith(null));

    const verdicts = await softVerifyCandidatesV2([makeCandidate(), makeCandidate()], "chunk", "intent");

    expect(verdicts).toHaveLength(2);
    expect(verdicts.every((verdict) => verdict.approved === false)).toBe(true);
  });

  it("passes through valid verdicts", async () => {
    createCompletion.mockResolvedValue(
      completionWith(
        JSON.stringify({
          verdicts: [{ candidateIndex: 0, approved: true, qualityScore: 0.9, issues: [] }],
        }),
      ),
    );

    const verdicts = await softVerifyCandidatesV2([makeCandidate()], "chunk", "intent");

    expect(verdicts[0].approved).toBe(true);
    expect(verdicts[0].qualityScore).toBe(0.9);
  });
});

describe("hardVerifyCandidateV2 (deterministic grounding)", () => {
  const chunk =
    "Intro sentence. The treatment reduced symptoms by 40 percent in the trial group. Outro.";

  it("accepts a grounded candidate and keeps offsets when correct", () => {
    const text = "The treatment reduced symptoms by 40 percent in the trial group.";
    const start = chunk.indexOf(text);
    const candidate = makeCandidate({
      highlightText: text,
      highlightStart: start,
      highlightEnd: start + text.length,
    });

    const result = hardVerifyCandidateV2(candidate, chunk);

    expect(result.valid).toBe(true);
    expect(result.correctedCandidate).toEqual(candidate);
  });

  it("realigns offsets when the text is grounded but offsets are wrong", () => {
    const text = "The treatment reduced symptoms by 40 percent in the trial group.";
    const candidate = makeCandidate({
      highlightText: text,
      highlightStart: 0,
      highlightEnd: text.length,
    });

    const result = hardVerifyCandidateV2(candidate, chunk);

    expect(result.valid).toBe(true);
    expect(result.correctedCandidate?.highlightStart).toBe(chunk.indexOf(text));
  });

  it("rejects candidates whose text is not in the chunk", () => {
    const candidate = makeCandidate({ highlightText: "This sentence was never in the source." });

    const result = hardVerifyCandidateV2(candidate, chunk);

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("Grounding failed");
  });

  it("rejects reference/metadata noise", () => {
    const noise = "doi: 10.1000/xyz123 vol. 12 pp. 1-20";
    const candidate = makeCandidate({ highlightText: noise });

    const result = hardVerifyCandidateV2(candidate, `${noise} plus some trailing text here.`);

    expect(result.valid).toBe(false);
  });
});
