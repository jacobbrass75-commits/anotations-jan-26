import { chunkText, extractTextFromTxt } from "../../server/chunker";

describe("chunker", () => {
  it("prefers ending the first chunk on a sentence boundary when one is nearby", () => {
    const text = "Sentence one. Sentence two. Sentence three.";
    const chunks = chunkText(text, 12, 4);

    expect(chunks[0]).toEqual({
      text: "Sentence one. ",
      startPosition: 0,
      endPosition: 14,
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1].startPosition).toBeLessThan(chunks[0].endPosition);
    expect(chunks[1].startPosition).toBeGreaterThan(chunks[0].startPosition);
  });

  it("normalizes plain-text document content", () => {
    expect(extractTextFromTxt("line 1\r\nline\t\t2  \rline  3")).toBe("line 1\nline 2 \nline 3");
  });
});
