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
import { startHttpServer } from "./helpers/http";

const { clerkGetAuth, clerkMiddleware, clerkGetUser } = vi.hoisted(() => ({
  clerkGetAuth: vi.fn(() => ({ userId: null })),
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  clerkGetUser: vi.fn(),
}));
const {
  generateDocumentSummary,
  getEmbeddingWithUsage,
  extractCitationMetadata,
  generateRetrievalContext,
} = vi.hoisted(() => ({
  generateDocumentSummary: vi.fn(async () => ({
    summary: "server summary",
    mainArguments: [],
    keyConcepts: [],
  })),
  getEmbeddingWithUsage: vi.fn(async () => [1, 0, 0]),
  extractCitationMetadata: vi.fn(async () => null),
  generateRetrievalContext: vi.fn(async () => "server context"),
}));

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

vi.mock("../../server/contextGenerator", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/contextGenerator")>()),
  generateRetrievalContext,
}));

const repoRoot = resolve(__dirname, "../..");
const sdkRoot = join(repoRoot, "mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm");

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

async function startMcpServer(backendBaseUrl: string, aiMode: "host" | "server") {
  const port = await getFreePort();
  const child = spawn(process.execPath, [join(repoRoot, "mcp-server/server.mjs")], {
    env: {
      ...process.env,
      MCP_SERVER_PORT: String(port),
      SCHOLARMARK_BACKEND_URL: backendBaseUrl,
      SCHOLARMARK_APP_URL: "https://app.example.test",
      MCP_AI_MODE: aiMode,
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
  const client = new Client({ name: "host-mode-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${mcpBaseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

function parseToolJson(result: {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}) {
  if (result.isError) {
    throw new Error(result.content[0]?.text ?? "tool error");
  }
  return JSON.parse(result.content[0]?.text ?? "null");
}

describe("MCP host-AI mode", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  let mcpChild: ChildProcess | null = null;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-mcp-host-"));
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

    const now = new Date("2026-11-01T00:00:00.000Z");
    // Budget is exhausted: host-AI storage must still work because it spends no tokens.
    await db.insert(users).values({
      id: "host-user",
      email: "host@example.com",
      username: "host@example.com",
      password: "",
      tier: "pro",
      tokensUsed: 500,
      tokenLimit: 500,
      storageUsed: 0,
      storageLimit: 52428800,
      createdAt: now,
      updatedAt: now,
    } as any);

    const app = express();
    app.use(express.json());
    await registerRoutes(createServer(app), app);
    return {
      server: await startHttpServer(app),
      token: generateToken({ id: "host-user", email: "host@example.com", tier: "pro" }),
    };
  }

  it("stores sources, summaries, annotations, and citations without ScholarMark AI calls", async () => {
    const { server, token } = await createBackend();
    try {
      const mcp = await startMcpServer(server.baseUrl, "host");
      mcpChild = mcp.child;
      const client = await connectClient(mcp.baseUrl, token);

      const { tools } = await client.listTools();
      const names = tools.map((tool: { name: string }) => tool.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "save_source",
          "read_source_text",
          "save_annotations",
          "search",
          "fetch",
        ]),
      );
      expect(names).not.toContain("send_message");
      expect(names).not.toContain("compile_paper");
      for (const tool of tools) {
        expect(tool.title, tool.name).toBeTruthy();
        expect(tool.annotations?.readOnlyHint, tool.name).toBeTypeOf("boolean");
      }
      expect(client.getInstructions()).toContain("save_annotations");
      expect(
        tools.find((tool: { name: string }) => tool.name === "search")?.outputSchema,
      ).toMatchObject({
        type: "object",
        required: ["results"],
      });
      expect(
        tools.find((tool: { name: string }) => tool.name === "fetch")?.outputSchema,
      ).toMatchObject({
        type: "object",
        required: expect.arrayContaining(["id", "title", "text", "url"]),
      });

      const project = parseToolJson(
        await client.callTool({ name: "create_project", arguments: { name: "Rivers" } }),
      );
      const text =
        "Rivers shape cities. The Thames carried trade for centuries, and its floods forced London to build embankments in the 1860s.";
      const uploaded = parseToolJson(
        await client.callTool({
          name: "upload_file_to_project",
          arguments: {
            project_id: project.id,
            filename: "river-notes.txt",
            mime_type: "text/plain",
            file_base64: Buffer.from(text).toString("base64"),
          },
        }),
      );
      expect(uploaded.projectDocument).toBeTruthy();

      const rejectedOcr = await fetch(`${server.baseUrl}/api/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "X-ScholarMark-AI-Mode": "host" },
        body: (() => {
          const form = new FormData();
          form.append("file", new Blob([text], { type: "application/pdf" }), "scan.pdf");
          form.append("ocrMode", "vision");
          return form;
        })(),
      });
      expect(rejectedOcr.status).toBe(400);

      const saved = parseToolJson(
        await client.callTool({
          name: "save_source",
          arguments: {
            text,
            title: "Thames history",
            project_id: project.id,
            summary: "How the Thames shaped London.",
            key_concepts: ["trade", "flooding"],
            citation: {
              sourceType: "book",
              authors: [{ firstName: "Ada", lastName: "Lovelace" }],
              title: "Thames History",
            },
          },
        }),
      );
      expect(saved.projectDocumentId).toBeTruthy();
      expect(saved.summary).toMatchObject({ summary: "How the Thames shaped London." });

      const page = parseToolJson(
        await client.callTool({
          name: "read_source_text",
          arguments: { project_document_id: saved.projectDocumentId, offset: 0, max_chars: 20 },
        }),
      );
      expect(page.text).toBe(text.slice(0, 20));
      expect(page.nextOffset).toBe(20);

      const annotated = parseToolJson(
        await client.callTool({
          name: "save_annotations",
          arguments: {
            project_document_id: saved.projectDocumentId,
            research_goal: "infrastructure responses to flooding",
            annotations: [
              {
                quote: "its floods forced  London to build embankments",
                category: "evidence",
                note: "Direct link between flooding and infrastructure.",
              },
              { quote: "This sentence is not in the source", category: "key_quote", note: "x" },
            ],
          },
        }),
      );
      expect(annotated.savedCount).toBe(1);
      expect(annotated.saved[0].matchType).toBe("whitespace_insensitive");
      expect(annotated.notFound).toHaveLength(1);

      const searchResponse = await client.callTool({
        name: "search",
        arguments: { query: "embankments" },
      });
      const results = parseToolJson(searchResponse);
      expect(searchResponse.structuredContent).toEqual(results);
      const annotationHit = results.results.find((hit: { id: string }) =>
        hit.id.startsWith("annotation:"),
      );
      expect(annotationHit).toBeTruthy();
      const fetchResponse = await client.callTool({
        name: "fetch",
        arguments: { id: annotationHit.id },
      });
      const fetched = parseToolJson(fetchResponse);
      expect(fetchResponse.structuredContent).toEqual(fetched);
      expect(fetched.text).toContain("its floods forced London to build embankments");
      expect(fetched.metadata.citation).toMatchObject({ title: "Thames History" });

      for (const id of [`source:${saved.projectDocumentId}`, `document:${saved.documentId}`]) {
        const sourceResponse = await client.callTool({ name: "fetch", arguments: { id } });
        const source = parseToolJson(sourceResponse);
        expect(sourceResponse.structuredContent).toEqual(source);
        expect(source.text).toBe(text);
      }

      await client.close();

      expect(generateDocumentSummary).not.toHaveBeenCalled();
      expect(generateRetrievalContext).not.toHaveBeenCalled();
      expect(extractCitationMetadata).not.toHaveBeenCalled();
      expect(getEmbeddingWithUsage).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  }, 30_000);

  it("keeps server-AI tools available when MCP_AI_MODE=server", async () => {
    const { server, token } = await createBackend();
    try {
      const mcp = await startMcpServer(server.baseUrl, "server");
      mcpChild = mcp.child;
      const client = await connectClient(mcp.baseUrl, token);
      const { tools } = await client.listTools();
      expect(tools.map((tool: { name: string }) => tool.name)).toEqual(
        expect.arrayContaining(["send_message", "compile_paper", "save_annotations"]),
      );
      await client.close();
    } finally {
      await server.close();
    }
  }, 30_000);
});
