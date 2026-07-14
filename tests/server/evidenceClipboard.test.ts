import { describe, expect, it } from "vitest";
import {
  boundEvidenceClipboard,
  preserveStoredEvidenceClipboard,
  createEmptyClipboard,
  extractUsedEvidence,
  formatClipboardForPrompt,
  mergeEvidence,
  validateExtractedEvidence,
} from "../../server/evidenceClipboard";

describe("evidence clipboard retention", () => {
  it("keeps whole pinned, quoted, and lexically relevant evidence", () => {
    const clipboard = mergeEvidence(
      createEmptyClipboard("Archive thesis"),
      [
        {
          sourceId: "source-a",
          sourceTitle: "Archive Study",
          items: [
            {
              type: "paraphrase",
              text: "Pinned methodological limitation.",
              citedInTurn: 1,
              pinned: true,
            },
            {
              type: "direct_quote",
              text: "The archive preserves institutional memory across generations.",
              citedInTurn: 1,
              location: "p. 4",
            },
            {
              type: "finding",
              text: "Quantum archive access predicts stronger public accountability.",
              citedInTurn: 1,
            },
            {
              type: "finding",
              text: "An unrelated low-value observation.",
              citedInTurn: 1,
            },
          ],
        },
      ],
      2,
    );
    const result = boundEvidenceClipboard(clipboard, {
      itemLimit: 3,
      tokenBudget: 2_000,
      query: "quantum archive accountability",
    });
    const texts = result.clipboard.evidence.flatMap((source) =>
      source.items.map((item) => item.text),
    );

    expect(texts).toContain("Pinned methodological limitation.");
    expect(texts).toContain(
      "The archive preserves institutional memory across generations.",
    );
    expect(texts).toContain("Quantum archive access predicts stronger public accountability.");
    expect(texts).not.toContain("An unrelated low-value observation.");
    expect(result.clipboard.tokenEstimate).toBeLessThanOrEqual(2_000);
    expect(result.diagnostics.evictedItems).toBe(1);
  });

  it("drops whole evidence items instead of clipping exact quotes", () => {
    const exactQuote = `Beginning ${"quoted evidence ".repeat(100)} ending.`;
    const clipboard = mergeEvidence(
      createEmptyClipboard(),
      [
        {
          sourceId: "source-a",
          sourceTitle: "Quoted Source",
          items: [{ type: "direct_quote", text: exactQuote, citedInTurn: 1 }],
        },
      ],
      1,
    );
    const retained = boundEvidenceClipboard(clipboard, { tokenBudget: 1_000, itemLimit: 1 });

    expect(retained.clipboard.evidence[0].items[0].text).toBe(exactQuote);
    expect(formatClipboardForPrompt(retained.clipboard)).toContain(`"${exactQuote}"`);
  });

  it("keeps a larger archive separate from the query-aware prompt view", () => {
    const clipboard = mergeEvidence(
      createEmptyClipboard(),
      [
        {
          sourceId: "source-a",
          sourceTitle: "Archive",
          items: [
            { type: "finding", text: "Old unrelated item one.", citedInTurn: 1 },
            { type: "finding", text: "Old unrelated item two.", citedInTurn: 1 },
            {
              type: "finding",
              text: "制度設計では透明性と説明責任を重視する。",
              citedInTurn: 1,
            },
            { type: "finding", text: "New but unrelated item.", citedInTurn: 20 },
          ],
        },
      ],
      1,
    );
    const archive = preserveStoredEvidenceClipboard(clipboard);
    const active = boundEvidenceClipboard(archive.clipboard, {
      itemLimit: 2,
      tokenBudget: 2_000,
      query: "透明性と説明責任の議論",
    });
    const archiveTexts = archive.clipboard.evidence[0].items.map((item) => item.text);
    const activeTexts = active.clipboard.evidence[0].items.map((item) => item.text);

    expect(archiveTexts).toHaveLength(4);
    expect(activeTexts).toContain("制度設計では透明性と説明責任を重視する。");
    expect(archive.clipboard.evidence[0].items).toHaveLength(4);
  });

  it("accepts grounded extracted evidence and rejects unknown sources and fabricated quotes", () => {
    const quote = "Institutional trust mediates durable compliance.";
    const available = `### Trust Study [evidence] (source: source-trust)\n- [quote] "${quote}" (p. 7)`;
    const assistant = `The study concludes that "${quote}"`;
    const validated = validateExtractedEvidence(
      [
        {
          sourceId: "source-trust",
          sourceTitle: "Trust Study",
          items: [{ type: "direct_quote", text: quote, citedInTurn: 0, location: "p. 7" }],
        },
        {
          sourceId: "source-unknown",
          sourceTitle: "Invented Source",
          items: [{ type: "finding", text: "Invented result", citedInTurn: 0 }],
        },
        {
          sourceId: "source-trust",
          sourceTitle: "Trust Study",
          items: [
            {
              type: "direct_quote",
              text: "A quotation that does not exist in the source.",
              citedInTurn: 0,
            },
          ],
        },
      ],
      available,
      assistant,
    );

    expect(validated).toHaveLength(1);
    expect(validated[0].sourceId).toBe("source-trust");
    expect(validated[0].items).toHaveLength(1);
    expect(validated[0].items[0].text).toBe(quote);
  });

  it("persists a positive grounded extraction into the durable clipboard", async () => {
    const quote = "Public legitimacy strengthens compliance over time.";
    const create = async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            newEvidence: [
              {
                sourceId: "source-legitimacy",
                sourceTitle: "Legitimacy Study",
                items: [{ type: "direct_quote", text: quote, location: "p. 11" }],
              },
            ],
            sectionsWorkedOn: [],
          }),
        },
      ],
    });

    const clipboard = await extractUsedEvidence(
      { messages: { create } },
      `Draft evidence: "${quote}"`,
      `[SOURCE source-legitimacy]\nTitle: Legitimacy Study\nContent Snippet:\n${quote}`,
      createEmptyClipboard(),
      4,
    );

    expect(clipboard.evidence).toHaveLength(1);
    expect(clipboard.evidence[0].sourceId).toBe("source-legitimacy");
    expect(clipboard.evidence[0].items[0]).toMatchObject({
      type: "direct_quote",
      text: quote,
      location: "p. 11",
      citedInTurn: 4,
    });
  });
});
