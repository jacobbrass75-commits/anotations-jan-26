import express from "express";
import { spawn, type ChildProcess } from "child_process";
import { createServer } from "http";
import { createServer as createNetServer, type AddressInfo } from "net";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapTempWorkspace } from "./helpers/bootstrapTempWorkspace";
import { requestJson, startHttpServer } from "./helpers/http";

// Regression coverage for project search freshness and coverage:
// - editing an annotation must re-index it, so search stops matching the old note;
// - search_project_sources must reach unannotated passages of the project's sources.

const { clerkGetAuth, clerkMiddleware, clerkGetUser } = vi.hoisted(() => ({
  clerkGetAuth: vi.fn(() => ({ userId: null })),
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  clerkGetUser: vi.fn(),
}));
const { generateDocumentSummary, getEmbeddingWithUsage, extractCitationMetadata } = vi.hoisted(
  () => ({
    generateDocumentSummary: vi.fn(async () => ({
      summary: "server summary",
      mainArguments: [],
      keyConcepts: [],
    })),
    getEmbeddingWithUsage: vi.fn(async (text: string) => [text.length, 1, 0]),
    extractCitationMetadata: vi.fn(async () => null),
  }),
);

vi.mock("@clerk/express", () => ({
  clerkMiddleware,
  getAuth: clerkGetAuth,
  clerkClient: { users: { getUser: clerkGetUser } },
}));

vi.mock("../../server/ocrQueue", () => ({
  enqueuePdfOcrJob: vi.fn(async () => undefined),
  enqueueImageOcrJob: vi.fn(async () => undefined),
  enqueueImageBundleOcrJob: vi.fn(async () => undefined),
  initializeOcrQueue: vi.fn(async () => undefined),
}));

vi.mock("../../server/openai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/openai")>()),
  generateDocumentSummary,
  getEmbeddingWithUsage,
  extractCitationMetadata,
}));

const repoRoot = resolve(__dirname, "../..");
const sdkRoot = join(repoRoot, "mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm");

const SOURCE_TEXT = [
  "Harbor records from 1850 describe the docks in detail.",
  "Most entries list cargo weights and tariffs collected at the quay.",
  "A later ledger mentions that the lighthouse keeper rationed whale oil during the winter of 1853, which no other record confirms.",
  "The final pages return to tariffs.",
].join(" ");
const ANNOTATED_QUOTE = "Most entries list cargo weights and tariffs collected at the quay.";

type ToolResult = {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

async function getFreePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolvePort(port));
    });
  });
}

async function startMcpServer(backendBaseUrl: string) {
  const port = await getFreePort();
  const child = spawn(process.execPath, [join(repoRoot, "mcp-server/server.mjs")], {
    env: {
      ...process.env,
      MCP_SERVER_PORT: String(port),
      SCHOLARMARK_BACKEND_URL: backendBaseUrl,
      SCHOLARMARK_APP_URL: "https://app.example.test",
      MCP_AI_MODE: "host",
    },
    stdio: "ignore",
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return { child, baseUrl };
    } catch {
      // not listening yet
    }
    await new Promise((done) => setTimeout(done, 50));
  }
  child.kill();
  throw new Error("MCP server did not start");
}

async function connectClient(mcpBaseUrl: string, token: string) {
  const { Client } = await import(pathToFileURL(join(sdkRoot, "client/index.js")).href);
  const { StreamableHTTPClientTransport } = await import(
    pathToFileURL(join(sdkRoot, "client/streamableHttp.js")).href
  );
  const client = new Client({ name: "project-search-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${mcpBaseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

function parseToolJson(result: ToolResult) {
  if (result.isError) {
    throw new Error(result.content[0]?.text ?? "tool error");
  }
  return JSON.parse(result.content[0]?.text ?? "null");
}

describe("project search retrieval", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  let mcpChild: ChildProcess | null = null;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-project-search-"));
    vi.resetModules();
    vi.clearAllMocks();
    process.chdir(tempDir);
    await bootstrapTempWorkspace(tempDir);
  });

  afterEach(async () => {
    mcpChild?.kill();
    mcpChild = null;
    sqlite?.close();
    sqlite = null;
    process.chdir(originalCwd);
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createBackend() {
    const { db, sqlite: importedSqlite } = await import("../../server/db");
    const { users } = await import("../../shared/schema");
    const { registerRoutes } = await import("../../server/routes");
    const { generateToken } = await import("../../server/auth");
    sqlite = importedSqlite;

    const now = new Date("2026-11-06T00:00:00.000Z");
    for (const id of ["search-user", "other-user"]) {
      await db.insert(users).values({
        id,
        email: `${id}@example.test`,
        username: `${id}@example.test`,
        password: "",
        tier: "pro",
        tokensUsed: 0,
        tokenLimit: 100000,
        storageUsed: 0,
        storageLimit: 52428800,
        createdAt: now,
        updatedAt: now,
      } as any);
    }

    const app = express();
    app.use(express.json());
    await registerRoutes(createServer(app), app);
    return {
      db,
      server: await startHttpServer(app),
      token: generateToken({ id: "search-user", email: "search-user@example.test", tier: "pro" }),
      otherToken: generateToken({
        id: "other-user",
        email: "other-user@example.test",
        tier: "pro",
      }),
    };
  }

  async function seedProject(baseUrl: string, token: string, name: string) {
    const auth = { Authorization: `Bearer ${token}` };
    const project = await requestJson<{ id: string }>(baseUrl, "/api/projects", {
      method: "POST",
      headers: auth,
      body: { name },
    });
    expect(project.status).toBe(201);

    const form = new FormData();
    form.append("title", "Harbor records");
    form.append("text", SOURCE_TEXT);
    const uploaded = await fetch(`${baseUrl}/api/upload-text`, {
      method: "POST",
      headers: { ...auth, "X-ScholarMark-AI-Mode": "host" },
      body: form,
    });
    expect(uploaded.status).toBe(200);
    const document = (await uploaded.json()) as { id: string };

    const projectDocument = await requestJson<{ id: string }>(
      baseUrl,
      `/api/projects/${project.body!.id}/documents`,
      {
        method: "POST",
        headers: { ...auth, "X-ScholarMark-AI-Mode": "host" },
        body: { documentId: document.id },
      },
    );
    expect(projectDocument.status).toBe(201);
    return {
      projectId: project.body!.id,
      documentId: document.id,
      projectDocumentId: projectDocument.body!.id,
    };
  }

  async function search(baseUrl: string, token: string, projectId: string, query: string) {
    const response = await requestJson<{ results: any[] }>(
      baseUrl,
      `/api/projects/${projectId}/search`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: { query },
      },
    );
    expect(response.status).toBe(200);
    return response.body!.results;
  }

  it("re-indexes an edited annotation so search returns the current note, not the old one", async () => {
    const { db, server, token, otherToken } = await createBackend();
    try {
      const { projectId, projectDocumentId } = await seedProject(server.baseUrl, token, "Harbor");
      const startPosition = SOURCE_TEXT.indexOf(ANNOTATED_QUOTE);
      const created = await requestJson<{ id: string }>(
        server.baseUrl,
        `/api/project-documents/${projectDocumentId}/annotations`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: {
            startPosition,
            endPosition: startPosition + ANNOTATED_QUOTE.length,
            highlightedText: ANNOTATED_QUOTE,
            category: "evidence",
            note: "zephyrine shipping ledger",
            isAiGenerated: false,
          },
        },
      );
      expect(created.status).toBe(201);
      const annotationId = created.body!.id;
      expect(
        (await search(server.baseUrl, token, projectId, "zephyrine")).map((r) => r.annotationId),
      ).toContain(annotationId);

      // Web-app edit path (server AI mode): note and category change, and the index follows.
      const edited = await requestJson<any>(
        server.baseUrl,
        `/api/project-annotations/${annotationId}`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}` },
          body: { note: "quillmont customs tariffs", category: "argument" },
        },
      );
      expect(edited.status).toBe(200);
      expect(edited.body).toMatchObject({
        note: "quillmont customs tariffs",
        category: "argument",
      });
      expect(edited.body.searchableContent).toContain("quillmont customs tariffs");
      expect(edited.body.searchableContent).toContain("[argument]");
      expect(edited.body.searchableContent).not.toContain("zephyrine");

      expect(
        (await search(server.baseUrl, token, projectId, "zephyrine")).filter(
          (r) => r.type === "annotation",
        ),
      ).toEqual([]);
      const fresh = (await search(server.baseUrl, token, projectId, "quillmont")).find(
        (r) => r.annotationId === annotationId,
      );
      expect(fresh).toMatchObject({ note: "quillmont customs tariffs", category: "argument" });
      expect(fresh.matchedText).not.toContain("zephyrine");

      const { projectAnnotations } = await import("../../shared/schema");
      const { eq } = await import("drizzle-orm");
      const [afterServerEdit] = await db
        .select()
        .from(projectAnnotations)
        .where(eq(projectAnnotations.id, annotationId));
      // The embedding is rebuilt from the new searchable text (the mock encodes its length).
      expect(afterServerEdit.searchEmbedding?.[0]).toBe(afterServerEdit.searchableContent!.length);

      // Host-AI edit path: no ScholarMark embedding call, and the stale embedding is dropped.
      getEmbeddingWithUsage.mockClear();
      const hostEdit = await requestJson<any>(
        server.baseUrl,
        `/api/project-annotations/${annotationId}`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "X-ScholarMark-AI-Mode": "host" },
          body: { note: "brindlewick harbor fees" },
        },
      );
      expect(hostEdit.status).toBe(200);
      expect(hostEdit.body).toMatchObject({
        note: "brindlewick harbor fees",
        category: "argument",
      });
      expect(hostEdit.body.searchableContent).toBe(
        `[argument] ${ANNOTATED_QUOTE} brindlewick harbor fees`,
      );
      expect(hostEdit.body.searchEmbedding).toBeNull();
      expect(getEmbeddingWithUsage).not.toHaveBeenCalled();
      expect(
        (await search(server.baseUrl, token, projectId, "quillmont")).filter(
          (r) => r.type === "annotation",
        ),
      ).toEqual([]);

      // Only note and category are editable; ownership fields in the body are ignored.
      const other = await seedProject(server.baseUrl, otherToken, "Other harbor");
      const moved = await requestJson<any>(
        server.baseUrl,
        `/api/project-annotations/${annotationId}`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}` },
          body: {
            note: "still mine",
            projectDocumentId: other.projectDocumentId,
            searchableContent: "injected",
          },
        },
      );
      expect(moved.status).toBe(200);
      expect(moved.body.projectDocumentId).toBe(projectDocumentId);
      expect(moved.body.searchableContent).not.toContain("injected");

      const invalid = await requestJson(
        server.baseUrl,
        `/api/project-annotations/${annotationId}`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}` },
          body: { category: "not_a_category" },
        },
      );
      expect(invalid.status).toBe(400);

      // Another user cannot edit it.
      const foreign = await requestJson(
        server.baseUrl,
        `/api/project-annotations/${annotationId}`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${otherToken}` },
          body: { note: "hijacked" },
        },
      );
      expect(foreign.status).toBe(403);
    } finally {
      await server.close();
    }
  }, 30_000);

  it("finds unannotated source passages through search_project_sources and search, per user", async () => {
    const { server, token, otherToken } = await createBackend();
    try {
      const { projectId, projectDocumentId } = await seedProject(server.baseUrl, token, "Harbor");
      const other = await seedProject(server.baseUrl, otherToken, "Other harbor");

      const mcp = await startMcpServer(server.baseUrl);
      mcpChild = mcp.child;
      const client = await connectClient(mcp.baseUrl, token);

      // Annotate one sentence, then edit its note through the MCP tool.
      const annotated = parseToolJson(
        (await client.callTool({
          name: "save_annotations",
          arguments: {
            project_document_id: projectDocumentId,
            annotations: [
              { quote: ANNOTATED_QUOTE, category: "evidence", note: "zephyrine shipping ledger" },
            ],
          },
        })) as ToolResult,
      );
      const annotationId = annotated.saved[0].id as string;
      parseToolJson(
        (await client.callTool({
          name: "update_annotation",
          arguments: { annotation_id: annotationId, note: "quillmont customs tariffs" },
        })) as ToolResult,
      );

      const projectSearch = async (query: string) =>
        parseToolJson(
          (await client.callTool({
            name: "search_project_sources",
            arguments: { project_id: projectId, query },
          })) as ToolResult,
        ).results.results as any[];

      // Stale note is gone from both MCP search tools; the current note is found.
      expect((await projectSearch("zephyrine")).filter((r) => r.type === "annotation")).toEqual([]);
      expect((await projectSearch("quillmont"))[0]).toMatchObject({
        type: "annotation",
        annotationId,
        note: "quillmont customs tariffs",
      });
      const globalStale = parseToolJson(
        (await client.callTool({
          name: "search",
          arguments: { query: "zephyrine" },
        })) as ToolResult,
      );
      expect(globalStale.results).toEqual([]);

      // An unannotated passage is reachable, with its exact position in the source.
      const passageHits = await projectSearch("rationed whale oil");
      const passage = passageHits.find((r) => r.type === "source_text");
      expect(passage).toBeTruthy();
      expect(passage.documentId).toBe(projectDocumentId);
      expect(passage.documentFilename).toContain("Harbor records");
      expect(passage.matchedText).toContain("rationed whale oil");
      expect(passage.startPosition).toBe(SOURCE_TEXT.indexOf("rationed whale oil"));
      expect(passage.relevanceLevel).toBe("high");

      // Word-level matches work across the passage too.
      expect((await projectSearch("lighthouse winter")).some((r) => r.type === "source_text")).toBe(
        true,
      );

      // An annotated passage is reported once, as the annotation with the user's note.
      const tariffHits = await projectSearch("cargo weights");
      expect(tariffHits.filter((r) => r.type === "annotation")).toHaveLength(1);
      expect(
        tariffHits.filter(
          (r) =>
            r.type === "source_text" && r.startPosition === SOURCE_TEXT.indexOf("cargo weights"),
        ),
      ).toEqual([]);

      // The annotated occurrence is skipped, and the later unannotated one is still returned.
      const tariffPassages = (await projectSearch("tariffs")).filter(
        (r) => r.type === "source_text",
      );
      expect(tariffPassages.map((r) => r.startPosition)).toEqual([
        SOURCE_TEXT.lastIndexOf("tariffs"),
      ]);

      const globalHits = parseToolJson(
        (await client.callTool({
          name: "search",
          arguments: { query: "rationed whale oil" },
        })) as ToolResult,
      );
      expect(globalHits.results).toEqual([
        expect.objectContaining({
          id: `source:${projectDocumentId}`,
          text: expect.stringContaining("rationed whale oil"),
        }),
      ]);
      await client.close();

      // Isolation: the other user's identical source never appears, and their project is closed.
      expect(JSON.stringify(passageHits)).not.toContain(other.projectDocumentId);
      const foreign = await requestJson(server.baseUrl, `/api/projects/${other.projectId}/search`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: { query: "rationed whale oil" },
      });
      expect(foreign.status).toBe(403);

      expect(getEmbeddingWithUsage).not.toHaveBeenCalled();
      expect(generateDocumentSummary).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  }, 30_000);
});
