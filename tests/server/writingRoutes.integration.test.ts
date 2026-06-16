import express from "express";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapTempWorkspace } from "./helpers/bootstrapTempWorkspace";
import { startHttpServer } from "./helpers/http";

const { anthropicCreate } = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(function AnthropicMock() {
    return {
      messages: {
        create: anthropicCreate,
      },
    };
  }),
}));

describe("writing route integration", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-writing-routes-"));
    vi.resetModules();
    vi.clearAllMocks();
    process.chdir(tempDir);
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    await bootstrapTempWorkspace(tempDir);
  });

  afterEach(async () => {
    sqlite?.close();
    sqlite = null;
    process.chdir(originalCwd);
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_FABLE_TEST_USER_REFS;
    delete process.env.ANTHROPIC_FABLE_MODEL;
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createApp(options: { existingDocuments?: number } = {}) {
    const { db, sqlite: importedSqlite } = await import("../../server/db");
    const { documents, users } = await import("../../shared/schema");
    const { registerWritingRoutes } = await import("../../server/writingRoutes");
    const { generateToken } = await import("../../server/auth");

    sqlite = importedSqlite;

    const now = new Date("2026-05-05T00:00:00.000Z");
    await db.insert(users).values({
      id: "writing-user",
      email: "writing@example.com",
      username: "writing@example.com",
      password: "",
      tier: "pro",
      tokensUsed: 90,
      tokenLimit: 1000,
      storageUsed: 0,
      storageLimit: 524_288_000,
      createdAt: now,
      updatedAt: now,
    } as any);
    if (options.existingDocuments) {
      await db.insert(documents).values(
        Array.from({ length: options.existingDocuments }, (_, index) => ({
          id: `existing-doc-${index}`,
          userId: "writing-user",
          filename: `Existing ${index}.txt`,
          fullText: `Existing document ${index}`,
        })) as any,
      );
    }

    const app = express();
    app.use(express.json());
    registerWritingRoutes(app);

    return {
      db,
      sqlite: importedSqlite,
      token: generateToken({ id: "writing-user", email: "writing@example.com", tier: "pro" }),
      server: await startHttpServer(app),
    };
  }

  it("records Anthropic token usage for completed writing jobs", async () => {
    const { server, sqlite, token } = await createApp();
    anthropicCreate
      .mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              thesis: "ScholarMark improves research workflows.",
              bibliography: [],
              sections: [
                {
                  title: "Introduction",
                  description: "Set up the argument.",
                  sourceIds: [],
                  targetWords: 100,
                },
              ],
            }),
          },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "## Introduction\nA focused draft section." }],
        usage: { input_tokens: 30, output_tokens: 40 },
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "# Complete Paper\nA focused draft section." }],
        usage: { input_tokens: 50, output_tokens: 60 },
      });

    try {
      const response = await fetch(`${server.baseUrl}/api/write`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          topic: "Research workflows",
          citationStyle: "chicago",
          tone: "academic",
          targetLength: "short",
        }),
      });
      const text = await response.text();
      const userAfterWrite = sqlite
        .prepare("SELECT tokens_used FROM users WHERE id = ?")
        .get("writing-user") as { tokens_used: number };

      expect(response.status).toBe(200);
      expect(text).toContain('"type":"complete"');
      expect(text).toContain('"usage":{"inputTokens":90,"outputTokens":120}');
      expect(text).toContain("data: [DONE]");
      expect(userAfterWrite.tokens_used).toBe(300);
    } finally {
      await server.close();
    }
  });

  it("retries with a compact planner when the first writing plan JSON is truncated", async () => {
    const { server, sqlite, token } = await createApp();
    anthropicCreate
      .mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: '{"thesis":"Long prompts need resilient planning.","sections":[{"title":"Introduction","description":"This string never closes',
          },
        ],
        usage: { input_tokens: 5, output_tokens: 6 },
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              thesis: "Long prompts need resilient planning.",
              bibliography: ["Test Source."],
              sections: [
                {
                  title: "Introduction",
                  description: "Set up the argument.",
                  sourceIds: [],
                  targetWords: 100,
                },
              ],
            }),
          },
        ],
        usage: { input_tokens: 7, output_tokens: 8 },
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "## Introduction\nA recovered draft section." }],
        usage: { input_tokens: 9, output_tokens: 10 },
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "# Complete Paper\nA recovered draft section." }],
        usage: { input_tokens: 11, output_tokens: 12 },
      });

    try {
      const response = await fetch(`${server.baseUrl}/api/write`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          topic: "A long assignment prompt that previously broke planner JSON",
          citationStyle: "chicago",
          tone: "academic",
          targetLength: "short",
        }),
      });
      const text = await response.text();
      const userAfterWrite = sqlite
        .prepare("SELECT tokens_used FROM users WHERE id = ?")
        .get("writing-user") as { tokens_used: number };

      expect(response.status).toBe(200);
      expect(anthropicCreate).toHaveBeenCalledTimes(4);
      expect(text).toContain('"type":"complete"');
      expect(text).toContain("# Complete Paper");
      expect(text).not.toContain("Failed to parse writing plan");
      expect(userAfterWrite.tokens_used).toBe(158);
    } finally {
      await server.close();
    }
  });

  it("uses the selected reusable writing style over the project voice profile", async () => {
    const { db, server, sqlite, token } = await createApp();
    const { projects, writingStyles } = await import("../../shared/schema");
    const now = new Date("2026-05-05T00:00:00.000Z");
    const selectedProfile = {
      avgSentenceLength: "Selected style uses compact, clipped sentences.",
      vocabularyLevel: "academic",
      paragraphStructure: "Selected paragraphs move from claim to consequence.",
      toneMarkers: ["measured urgency"],
      commonTransitions: ["still"],
      evidenceIntroduction: "Introduces evidence directly.",
      argumentStructure: "Builds from problem to implication.",
      hedgingStyle: "Minimal hedging.",
      openingPattern: "Opens with a concrete claim.",
      closingPattern: "Closes with a consequence.",
      distinctivePhrases: ["selected signature phrase"],
      avoidedPatterns: ["generic filler"],
      voiceSummary: "Selected reusable style voice.",
    };
    const projectProfile = {
      ...selectedProfile,
      distinctivePhrases: ["project signature phrase"],
      voiceSummary: "Project-only style voice.",
    };

    await db.insert(projects).values({
      id: "project-with-voice",
      userId: "writing-user",
      name: "Project Voice",
      voiceProfile: JSON.stringify(projectProfile),
      createdAt: now,
      updatedAt: now,
    } as any);
    await db.insert(writingStyles).values({
      id: "selected-style",
      userId: "writing-user",
      name: "Selected Style",
      description: "Reusable selected style",
      voiceProfile: JSON.stringify(selectedProfile),
      samples: ["sample one ".repeat(50), "sample two ".repeat(50)],
      createdAt: now,
      updatedAt: now,
    } as any);

    anthropicCreate
      .mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              thesis: "Reusable style should be selected.",
              bibliography: [],
              sections: [
                {
                  title: "Introduction",
                  description: "Set up the argument.",
                  sourceIds: [],
                  targetWords: 100,
                },
              ],
            }),
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "## Introduction\nA selected-style draft." }],
        usage: { input_tokens: 1, output_tokens: 1 },
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "# Complete Paper\nA selected-style draft." }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });

    try {
      const response = await fetch(`${server.baseUrl}/api/write`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          topic: "Reusable style",
          projectId: "project-with-voice",
          writingStyleId: "selected-style",
          citationStyle: "chicago",
          tone: "academic",
          targetLength: "short",
        }),
      });
      const text = await response.text();
      const firstCall = anthropicCreate.mock.calls[0]?.[0] as { system?: string };
      const savedDraft = sqlite
        .prepare(
          `
          SELECT d.user_id, d.filename, pd.role_in_project
          FROM documents d
          INNER JOIN project_documents pd ON pd.document_id = d.id
          WHERE pd.project_id = ? AND pd.role_in_project = ?
        `,
        )
        .get("project-with-voice", "AI-generated draft") as
        | { user_id: string | null; filename: string; role_in_project: string | null }
        | undefined;

      expect(response.status).toBe(200);
      expect(text).toContain('"type":"complete"');
      expect(text).toContain('"type":"saved"');
      expect(savedDraft?.user_id).toBe("writing-user");
      expect(savedDraft?.filename).toContain("Reusable style");
      expect(savedDraft?.role_in_project).toBe("AI-generated draft");
      expect(firstCall.system).toContain("Selected reusable style voice.");
      expect(firstCall.system).toContain("selected signature phrase");
      expect(firstCall.system).not.toContain("Project-only style voice.");
      expect(firstCall.system).not.toContain("project signature phrase");
    } finally {
      await server.close();
    }
  });

  it("uses Claude Fable only when the writing user is allowlisted", async () => {
    process.env.ANTHROPIC_FABLE_TEST_USER_REFS = "writing@example.com";
    const { server, token } = await createApp();

    anthropicCreate
      .mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              thesis: "Allowlisted users can test Fable.",
              bibliography: [],
              sections: [
                {
                  title: "Introduction",
                  description: "Set up the argument.",
                  sourceIds: [],
                  targetWords: 100,
                },
              ],
            }),
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "## Introduction\nA Fable draft section." }],
        usage: { input_tokens: 1, output_tokens: 1 },
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "# Complete Paper\nA Fable draft section." }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });

    try {
      const response = await fetch(`${server.baseUrl}/api/write`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          topic: "Fable opt-in",
          citationStyle: "chicago",
          tone: "academic",
          targetLength: "short",
        }),
      });
      const text = await response.text();
      const modelParams = anthropicCreate.mock.calls.map(([params]) => params as any);

      expect(response.status).toBe(200);
      expect(text).toContain('"type":"complete"');
      expect(modelParams).toHaveLength(3);
      expect(modelParams.every((params) => params.model === "claude-fable-5")).toBe(true);
      expect(modelParams.every((params) => params.output_config?.effort === "medium")).toBe(true);
      expect(modelParams.every((params) => params.thinking === undefined)).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("rejects project saves at the document limit before calling Anthropic", async () => {
    const { db, server, sqlite, token } = await createApp({ existingDocuments: 50 });
    const { projects } = await import("../../shared/schema");
    const now = new Date("2026-05-05T00:00:00.000Z");
    await db.insert(projects).values({
      id: "limit-project",
      userId: "writing-user",
      name: "Limit Project",
      createdAt: now,
      updatedAt: now,
    } as any);

    try {
      const response = await fetch(`${server.baseUrl}/api/write`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          topic: "Should not generate",
          projectId: "limit-project",
          citationStyle: "chicago",
          tone: "academic",
          targetLength: "short",
        }),
      });
      const body = await response.json();
      const row = sqlite.prepare("SELECT count(*) AS count FROM documents WHERE user_id = ?").get(
        "writing-user",
      ) as { count: number };

      expect(response.status).toBe(403);
      expect(body).toEqual({ error: "Document limit reached for the pro plan" });
      expect(anthropicCreate).not.toHaveBeenCalled();
      expect(row.count).toBe(50);
    } finally {
      await server.close();
    }
  });
});
