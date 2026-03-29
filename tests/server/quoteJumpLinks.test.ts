import { applyJumpLinksToMarkdown, dedupeQuoteJumpTargets } from "../../server/quoteJumpLinks";

describe("quote jump links", () => {
  it("dedupes blank and repeated targets", () => {
    expect(
      dedupeQuoteJumpTargets([
        { quote: "Important quote", jumpPath: "/a" },
        { quote: "Important quote", jumpPath: "/a" },
        { quote: " ", jumpPath: "/b" },
        { quote: "Different quote", jumpPath: " " },
      ])
    ).toEqual([{ quote: "Important quote", jumpPath: "/a" }]);
  });

  it("wraps exact quoted text in markdown links", () => {
    const result = applyJumpLinksToMarkdown(
      'The paper argues "Important claim here" more than once.',
      [{ quote: "Important claim here", jumpPath: "/projects/p1/documents/d1" }]
    );

    expect(result).toContain('["Important claim here"](/projects/p1/documents/d1)');
  });

  it("does not double-wrap content that is already linked", () => {
    const original = 'Already linked ["Important claim here"](/projects/p1/documents/d1).';

    expect(
      applyJumpLinksToMarkdown(original, [
        { quote: "Important claim here", jumpPath: "/projects/p1/documents/d1" },
      ])
    ).toBe(original);
  });

  it("matches normalized quotes even when source formatting differs", () => {
    const result = applyJumpLinksToMarkdown(
      'The reviewer wrote “The real point is clarity.” in the margin.',
      [{ quote: "The **real** point is clarity.", jumpPath: "/projects/p2/documents/d2" }]
    );

    expect(result).toContain("[“The real point is clarity.”](/projects/p2/documents/d2)");
  });
});
