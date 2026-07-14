import { describe, expect, it, vi } from "vitest";
import {
  applyPromptMemoryPolicy,
  applyReaderPromptMemoryPolicy,
  buildCompactedHistory,
  compactConversation,
  compactReaderConversation,
  getRequiredCompileMessageIndices,
  getRequiredTurnMessageIndices,
  markTruncatedDraft,
  MAX_COMPACTION_SUMMARY_CHARS,
  normalizeReaderMessages,
  truncateToolResult,
} from "../../server/contextCompaction";
import { getWritingMode } from "../../server/chat/promptBuilder";

function conversation(turns: number) {
  return Array.from({ length: turns }, (_, index) => [
    { role: "user", content: `User turn ${index + 1}` },
    { role: "assistant", content: `Assistant turn ${index + 1}` },
  ]).flat();
}

describe("compactConversation", () => {
  it("replaces the previous summary while providing it to the summarizer", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "One consolidated bounded summary." }],
    });
    const result = await compactConversation(
      { messages: { create } },
      conversation(12),
      "Prior durable thesis decision.",
      0,
    );

    expect(result?.compactedAtTurn).toBe(6);
    expect(result?.summary).toContain("One consolidated bounded summary.");
    expect(result?.summary).toContain("Prior durable thesis decision.");
    expect(create.mock.calls[0][0].messages[0].content).toContain(
      "Previous summary:\nPrior durable thesis decision.",
    );
  });

  it("removes a superseded citation style from a successful model summary", async () => {
    const result = await compactConversation(
      {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              {
                type: "text",
                text: "The paper continued using Chicago citations while developing its thesis.",
              },
            ],
          }),
        },
      },
      [
        { role: "user", content: "Switch the citation style from Chicago to APA." },
        { role: "assistant", content: "I will use APA from now on." },
        ...conversation(11),
      ],
      "Citation style: Chicago. The thesis concerns archival access.",
      0,
    );

    expect(result?.summary).toMatch(/\bAPA\b/);
    expect(result?.summary).not.toMatch(/\bChicago\b/);
  });

  it("recognizes a department requirement as the latest citation-style decision", async () => {
    const result = await compactConversation(
      {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: "The paper used APA while preserving its thesis." }],
          }),
        },
      },
      [
        { role: "user", content: "Let's use APA for this draft." },
        { role: "assistant", content: "APA selected." },
        {
          role: "user",
          content:
            "Actually, the department requires Chicago notes and bibliography. Replace APA everywhere.",
        },
        { role: "assistant", content: "Chicago now supersedes APA." },
        ...conversation(10),
      ],
      "Citation style: APA.",
      0,
    );

    expect(result?.summary).toMatch(/Chicago notes and bibliography/i);
    expect(result?.summary).not.toMatch(/\bAPA\b/i);
  });

  it("removes a superseded citation style from the deterministic fallback", async () => {
    const result = await compactConversation(
      { messages: { create: vi.fn().mockResolvedValue({ content: [] }) } },
      [
        { role: "user", content: "Use APA citations instead of Chicago." },
        { role: "assistant", content: "APA will be the current citation style." },
        ...conversation(11),
      ],
      "Use Chicago citations. Preserve the archival thesis.",
      0,
    );

    expect(result?.summary).toMatch(/\bAPA\b/);
    expect(result?.summary).not.toMatch(/\bChicago\b/);
    expect(result?.summary).toContain("archival thesis");
  });

  it("keeps the latest side of an explicit exclude-to-include reversal", async () => {
    const result = await compactConversation(
      {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: "The methods appendix remained excluded." }],
          }),
        },
      },
      [
        { role: "user", content: "Include the methods appendix instead." },
        { role: "assistant", content: "I will restore it." },
        ...conversation(11),
      ],
      "Decision: exclude the methods appendix.",
      0,
    );

    expect(result?.summary).toMatch(/include the methods appendix/i);
    expect(result?.summary).not.toMatch(/exclud/i);
  });

  it("uses an extractive fallback when summarization is empty", async () => {
    const result = await compactConversation(
      { messages: { create: vi.fn().mockResolvedValue({ content: [] }) } },
      [
        ...conversation(1),
        { role: "user", content: "We must exclude the obsolete survey and keep APA citations." },
        { role: "assistant", content: "Understood. The obsolete survey will not be used." },
        ...conversation(11),
      ],
      "The thesis centers on archival access.",
      1,
    );

    expect(result?.summary).toContain("The thesis centers on archival access.");
    expect(result?.summary).toContain("must exclude the obsolete survey");
  });

  it("uses the same decision-preserving fallback when summarization throws", async () => {
    const result = await compactConversation(
      { messages: { create: vi.fn().mockRejectedValue(new Error("temporary outage")) } },
      [
        { role: "user", content: "We decided the thesis must emphasize public access." },
        { role: "assistant", content: "I will preserve that thesis." },
        ...conversation(6),
      ],
      null,
      0,
    );

    expect(result?.summary).toContain("thesis must emphasize public access");
  });

  it("does not count synthetic retrieval messages as user turns", async () => {
    const messages = conversation(7);
    messages.splice(4, 0, {
      role: "user",
      content: "[CONTEXT RETRIEVAL - Surrounding text] synthetic payload",
    });
    const result = await compactConversation(
      {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: "summary" }],
          }),
        },
      },
      messages,
      null,
      0,
    );

    expect(result?.compactedAtTurn).toBe(1);
  });

  it("caps oversized model summaries", async () => {
    const result = await compactConversation(
      {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: "summary sentence. ".repeat(2_000) }],
          }),
        },
      },
      conversation(7),
      null,
      0,
    );
    expect(result!.summary.length).toBeLessThanOrEqual(MAX_COMPACTION_SUMMARY_CHARS);
    expect(result!.summary).toContain("[summary bounded]");
  });

  it("batches later compactions instead of rewriting the summary every turn", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "batched summary" }],
    });
    const first = await compactConversation(
      { messages: { create } },
      conversation(7),
      null,
      0,
    );
    expect(first?.compactedAtTurn).toBe(1);
    const tooSoon = await compactConversation(
      { messages: { create } },
      conversation(8),
      first!.summary,
      first!.compactedAtTurn,
    );
    expect(tooSoon).toBeNull();
    const nextBatch = await compactConversation(
      { messages: { create } },
      conversation(13),
      first!.summary,
      first!.compactedAtTurn,
    );
    expect(nextBatch?.compactedAtTurn).toBe(7);
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe("buildCompactedHistory", () => {
  it("keeps six genuine exchanges instead of assuming twelve records", () => {
    const messages = conversation(7);
    messages.splice(6, 0, {
      role: "user",
      content: "[DEEP DIVE FINDINGS] synthetic payload",
    });
    const result = buildCompactedHistory(messages, "[No evidence collected yet]", "summary", 1);
    const contents = result.map((message) => message.content);

    expect(contents).not.toContain("User turn 1");
    expect(contents).toContain("User turn 2");
    expect(contents).toContain("Assistant turn 2");
    expect(contents).toContain("User turn 7");
  });

  it("retains all raw history when no summary exists", () => {
    const result = buildCompactedHistory(
      conversation(8),
      "[No evidence collected yet]",
      null,
      0,
    );
    expect(result.some((message) => message.content === "User turn 1")).toBe(true);
  });

  it("omits messages made empty by tool-result stripping", () => {
    const result = buildCompactedHistory(
      [
        { role: "user", content: "Question" },
        { role: "assistant", content: "<chunk_request>only a tool call</chunk_request>" },
      ],
      "[No evidence collected yet]",
      null,
      0,
    );
    expect(result).toEqual([{ role: "user", content: "Question" }]);
  });

  it("rehydrates an older exchange when the current request is relevant", () => {
    const messages = [
      { role: "user", content: "The quantum archive section must foreground public access." },
      { role: "assistant", content: "I saved that section decision." },
      ...conversation(6),
    ];
    const result = buildCompactedHistory(
      messages,
      "[No evidence collected yet]",
      "Earlier decisions were summarized.",
      1,
      6,
      { currentRequest: "Revise the quantum archive public access section." },
    );
    expect(result.map((message) => message.content)).toContain(messages[0].content);
    expect(result.map((message) => message.content)).toContain(messages[1].content);
  });
});

describe("applyPromptMemoryPolicy", () => {
  it("selects complete exchanges, keeps recent turns, and favors lexical relevance", () => {
    const filler = "x".repeat(240);
    const messages = [
      { role: "user" as const, content: "The quantum archive is the durable thesis decision." },
      { role: "assistant" as const, content: `Relevant earlier response ${filler}` },
      { role: "user" as const, content: "Unrelated scheduling discussion." },
      { role: "assistant" as const, content: `Unrelated response ${filler}` },
      { role: "user" as const, content: `[CONTEXT RETRIEVAL] ${filler}` },
      { role: "assistant" as const, content: `Synthetic follow-up ${filler}` },
      { role: "user" as const, content: "Keep this recent instruction." },
      { role: "assistant" as const, content: "Recent acknowledgement." },
      { role: "user" as const, content: "Return to the quantum archive argument." },
    ];
    const result = applyPromptMemoryPolicy({
      systemPrompt: "system",
      messages,
      requiredMessageIndices: [messages.length - 1],
      currentRequest: messages[messages.length - 1].content,
      tokenBudget: 520,
    });
    const contents = result.messages.map((message) => message.content);

    expect(contents).toContain(messages[0].content);
    expect(contents).toContain(messages[1].content);
    expect(contents).toContain(messages[6].content);
    expect(contents).toContain(messages[8].content);
    expect(contents).not.toContain(messages[4].content);
    expect(result.diagnostics.estimatedTotalTokens).toBeLessThanOrEqual(520);
    expect(result.diagnostics.droppedExchangeCount).toBeGreaterThan(0);
    for (const message of result.messages) {
      if (message.role === "assistant") {
        const index = result.messages.indexOf(message);
        expect(result.messages.slice(0, index).some((prior) => prior.role === "user")).toBe(true);
      }
    }
  });

  it("fails closed when required recent context alone exceeds the hard budget", () => {
    expect(() =>
      applyPromptMemoryPolicy({
        systemPrompt: "system",
        messages: [{ role: "user", content: "x".repeat(2_000) }],
        requiredMessageIndices: [0],
        tokenBudget: 100,
      }),
    ).toThrow(/exceeds the configured memory budget/);
  });

  it("treats recent exchanges as high priority but drops a huge prior turn when necessary", () => {
    const result = applyPromptMemoryPolicy({
      systemPrompt: "system",
      messages: [
        { role: "user", content: "Previous request" },
        { role: "assistant", content: "x".repeat(4_000) },
        { role: "user", content: "Current request" },
      ],
      requiredMessageIndices: [2],
      currentRequest: "Current request",
      tokenBudget: 220,
    });
    expect(result.messages).toEqual([{ role: "user", content: "Current request" }]);
  });

  it("keeps the current-turn evidence brief and acknowledgement as explicit context", () => {
    const messages = [
      { role: "user" as const, content: `Old turn ${"x".repeat(800)}` },
      { role: "assistant" as const, content: `Old response ${"x".repeat(800)}` },
      { role: "user" as const, content: "[EVIDENCE GATHERED THIS TURN]\nExact quote, p. 4" },
      { role: "assistant" as const, content: "I have the evidence gathered for this turn." },
      { role: "user" as const, content: "Write the paragraph." },
    ];
    const result = applyPromptMemoryPolicy({
      systemPrompt: "system",
      messages,
      requiredMessageIndices: [2, 3, 4],
      currentRequest: "Write the paragraph.",
      minimumRecentTurns: 0,
      tokenBudget: 220,
    });
    expect(result.messages.map((message) => message.content)).toEqual([
      messages[2].content,
      messages[3].content,
      messages[4].content,
    ]);
  });

  it("scores multilingual relevance and uses a UTF-8-safe hard bound", () => {
    const messages = [
      { role: "user" as const, content: "制度設計では透明性と説明責任を重視する。" },
      { role: "assistant" as const, content: "この決定を保存しました。" },
      { role: "user" as const, content: `Unrelated ${"🙂".repeat(200)}` },
      { role: "assistant" as const, content: "Unrelated response." },
      { role: "user" as const, content: "透明性と説明責任の議論に戻ってください。" },
    ];
    const result = applyPromptMemoryPolicy({
      systemPrompt: "system",
      messages,
      requiredMessageIndices: [4],
      currentRequest: messages[4].content,
      minimumRecentTurns: 0,
      tokenBudget: 300,
    });
    expect(result.messages.map((message) => message.content)).toContain(messages[0].content);
    expect(result.messages.map((message) => message.content)).not.toContain(messages[2].content);
    expect(result.diagnostics.estimatedTotalTokens).toBeLessThanOrEqual(300);
  });

  it("preserves the latest revision of every compile section", () => {
    const messages = [
      { role: "assistant" as const, content: '<document title="Introduction">Old intro</document>' },
      { role: "assistant" as const, content: '<document title="Methods">Current methods</document>' },
      { role: "assistant" as const, content: '<document title="Introduction">Current intro</document>' },
      { role: "assistant" as const, content: "<document>Untitled appendix</document>" },
    ];
    expect(getRequiredCompileMessageIndices(messages)).toEqual([1, 2, 3]);
  });

  it("keeps a complete section canonical when a later output-limit partial has the same title", () => {
    const messages = [
      {
        role: "assistant" as const,
        content: '<document title="Methods">Complete methods section.</document>',
      },
      {
        role: "assistant" as const,
        content: markTruncatedDraft('<document title="Methods">Cut off mid-sentence'),
      },
    ];

    expect(getRequiredCompileMessageIndices(messages)).toEqual([0]);
  });

  it("fails closed for substantive untagged assistant drafts", () => {
    const untaggedDraft = `${"A substantive opening paragraph. ".repeat(8)}\n\n${
      "A second substantive paragraph. ".repeat(8)
    }`;
    expect(
      getRequiredCompileMessageIndices([
        { role: "assistant", content: "Short acknowledgement." },
        { role: "assistant", content: untaggedDraft },
      ]),
    ).toEqual([1]);
  });

  it("requires both the triggering request and retrieved evidence under a tight budget", () => {
    const messages = [
      { role: "user" as const, content: `Old request ${"x".repeat(500)}` },
      { role: "assistant" as const, content: `Old answer ${"x".repeat(500)}` },
      { role: "user" as const, content: "Explain the source's causal mechanism." },
      { role: "assistant" as const, content: "I need surrounding context." },
      {
        role: "user" as const,
        content: "[CONTEXT RETRIEVAL - Surrounding text] The mechanism is institutional trust.",
      },
    ];
    const requiredMessageIndices = getRequiredTurnMessageIndices(
      messages,
      "Explain the source's causal mechanism.",
    );
    expect(requiredMessageIndices).toEqual([2, 4]);

    const managed = applyPromptMemoryPolicy({
      systemPrompt: "system",
      messages,
      requiredMessageIndices,
      currentRequest: messages[2].content,
      minimumRecentTurns: 0,
      tokenBudget: 260,
    });
    const contents = managed.messages.map((message) => message.content);
    expect(contents).toContain(messages[2].content);
    expect(contents).toContain(messages[4].content);
    expect(contents).not.toContain(messages[0].content);
  });

  it("truncates retrieval only at safe boundaries and never keeps a partial quote", () => {
    const result = truncateToolResult(
      `[CONTEXT RETRIEVAL]\nA complete finding.\n\n"${"quoted material ".repeat(40)}"\n\nFinal note.`,
      180,
    );

    expect(result).toContain("A complete finding.");
    expect(result).not.toContain("quoted material");
    expect(result).toContain("[...truncated");
    expect((result.match(/"/g) || [])).toHaveLength(0);
  });

  it("normalizes provider roles without turning stored system text into assistant text", () => {
    expect(
      normalizeReaderMessages([
        { role: "system", content: "stale system message" },
        { role: "assistant", content: "Saved draft" },
        { role: "user", content: "First request" },
        { role: "user", content: "Second request" },
      ]),
    ).toEqual([
      {
        role: "user",
        content: "[CONTINUATION CONTEXT] Resume from the saved assistant work below.",
      },
      { role: "assistant", content: "Saved draft" },
      { role: "user", content: "First request\n\nSecond request" },
    ]);
  });

  it("uses the same compaction and budget path for Anthropic and OpenRouter reader modes", async () => {
    const previousDeepSeekFlag = process.env.ENABLE_DEEPSEEK_WRITING;
    process.env.ENABLE_DEEPSEEK_WRITING = "true";
    const cases = [
      { writingModel: "opus", expectedMode: "precision" as const },
      { writingModel: "sonnet", expectedMode: "extended" as const },
      { writingModel: "gpt56", expectedMode: "extended" as const },
      { writingModel: "deepseek", expectedMode: "extended" as const },
    ];
    try {
      for (const testCase of cases) {
        const mode = getWritingMode(testCase);
        expect(mode).toBe(testCase.expectedMode);
        const compacted = await compactReaderConversation(
          mode,
          {
            messages: {
              create: vi.fn().mockResolvedValue({
                content: [{ type: "text", text: `${mode} summary` }],
              }),
            },
          },
          conversation(7),
          null,
          0,
        );
        expect(compacted?.summary).toBe(`${mode} summary`);
        const managed = applyReaderPromptMemoryPolicy(mode, {
          systemPrompt: "system",
          messages: [{ role: "user", content: "current" }],
          requiredMessageIndices: [0],
          tokenBudget: 100,
        });
        expect(managed.diagnostics.readerMode).toBe(mode);
        expect(managed.messages).toHaveLength(1);
      }
    } finally {
      if (previousDeepSeekFlag === undefined) delete process.env.ENABLE_DEEPSEEK_WRITING;
      else process.env.ENABLE_DEEPSEEK_WRITING = previousDeepSeekFlag;
    }
  });
});
