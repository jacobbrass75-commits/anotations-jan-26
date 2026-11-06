import express from "express";
import { spawn, type ChildProcess } from "child_process";
import { createHash } from "crypto";
import { createServer } from "http";
import { createServer as createNetServer, type AddressInfo } from "net";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapTempWorkspace } from "./helpers/bootstrapTempWorkspace";
import { startHttpServer } from "./helpers/http";

// Store-review evidence: every host-AI tool is called through the real mcp-server/server.mjs
// against a real backend on a temporary SQLite workspace, using synthetic data only.

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
const fixtureDir = join(repoRoot, "integrations/scholarmark-plugin/listing/review-fixtures");

const HOST_TOOLS = [
  "get_projects",
  "create_project",
  "get_source_library",
  "get_project_sources",
  "search_project_sources",
  "add_source_to_project",
  "upload_text_to_project",
  "upload_file_to_project",
  "get_source_status",
  "get_source_summary",
  "get_source_annotations",
  "find_quote_in_source",
  "get_web_clips",
  "save_source",
  "read_source_text",
  "save_source_summary",
  "save_annotations",
  "update_annotation",
  "delete_annotation",
  "save_citation",
  "search",
  "fetch",
];

type ToolResult = {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
  structuredContent?: unknown;
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
      OPENAI_APPS_CHALLENGE_TOKEN: "",
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
  const client = new Client({ name: "tool-inventory-test", version: "1.0.0" });
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

function errorText(result: ToolResult): string {
  expect(result.isError).toBe(true);
  return result.content[0]?.text ?? "";
}

describe("MCP host-AI tool inventory", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  let mcpChild: ChildProcess | null = null;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-mcp-inventory-"));
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
    sqlite = importedSqlite;

    const now = new Date("2026-11-05T00:00:00.000Z");
    for (const id of ["inventory-user", "other-user"]) {
      await db.insert(users).values({
        id,
        email: `${id}@example.test`,
        username: `${id}@example.test`,
        password: "",
        tier: "pro",
        tokensUsed: 0,
        tokenLimit: 500,
        storageUsed: 0,
        storageLimit: 52428800,
        createdAt: now,
        updatedAt: now,
      } as any);
    }

    // OAuth tokens are seeded the way the token endpoint stores them: hashed, scoped, expiring.
    const nowSeconds = Math.floor(Date.now() / 1000);
    importedSqlite
      .prepare(
        `INSERT INTO mcp_oauth_clients (client_id, client_secret_hash, client_name, redirect_uris,
           grant_types, response_types, token_endpoint_auth_method, created_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "inventory-client",
        "Inventory Test Client",
        JSON.stringify(["http://localhost/callback"]),
        JSON.stringify(["authorization_code", "refresh_token"]),
        JSON.stringify(["code"]),
        "none",
        nowSeconds,
      );
    const issue = (id: string, userId: string, scope: string, expiresAt: number) => {
      const raw = `mcp_sm_inventory_${id}`;
      importedSqlite
        .prepare(
          `INSERT INTO mcp_tokens (id, user_id, client_id, key_hash, key_prefix, scope, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          userId,
          "inventory-client",
          createHash("sha256").update(raw).digest("hex"),
          raw.slice(0, 14),
          scope,
          expiresAt,
          nowSeconds,
        );
      return raw;
    };

    const app = express();
    app.use(express.json());
    await registerRoutes(createServer(app), app);
    return {
      db,
      server: await startHttpServer(app),
      tokens: {
        readWrite: issue("rw", "inventory-user", "read write", nowSeconds + 3600),
        readOnly: issue("ro", "inventory-user", "read", nowSeconds + 3600),
        expired: issue("expired", "inventory-user", "read write", nowSeconds - 60),
        other: issue("other", "other-user", "read write", nowSeconds + 3600),
      },
    };
  }

  it("calls and validates all 22 host tools with readback, missing-data, and scope checks", async () => {
    const { db, server, tokens } = await createBackend();
    const called = new Set<string>();
    try {
      const mcp = await startMcpServer(server.baseUrl);
      mcpChild = mcp.child;

      // No token: the MCP layer returns 401 with the protected-resource pointer.
      const anonymous = await fetch(`${mcp.baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(anonymous.status).toBe(401);
      expect(anonymous.headers.get("www-authenticate")).toContain("resource_metadata=");
      expect((await fetch(`${mcp.baseUrl}/.well-known/openai-apps-challenge`)).status).toBe(404);

      const client = await connectClient(mcp.baseUrl, tokens.readWrite);
      const call = async (name: string, args: Record<string, unknown>) => {
        called.add(name);
        return (await client.callTool({ name, arguments: args })) as ToolResult;
      };
      const callJson = async (name: string, args: Record<string, unknown>) =>
        parseToolJson(await call(name, args));

      const { tools } = await client.listTools();
      expect(tools.map((tool: { name: string }) => tool.name).sort()).toEqual(
        [...HOST_TOOLS].sort(),
      );

      // Projects
      const project = await callJson("create_project", {
        name: "Plugin Review Sample",
        thesis: "Mentoring matters more than shift length.",
      });
      expect(project.id).toBeTruthy();
      const projects = await callJson("get_projects", {});
      expect(projects.map((p: { id: string }) => p.id)).toContain(project.id);

      // save_source with the synthetic review fixture, verbatim
      // Windows checkouts may carry CRLF; the backend stores LF without a trailing newline.
      const fixtureText = (await readFile(join(fixtureDir, "riverside-survey-source.txt"), "utf8"))
        .replace(/\r\n/g, "\n")
        .trimEnd();
      const saved = await callJson("save_source", {
        text: fixtureText,
        title: "Riverside survey (synthetic)",
        project_id: project.id,
        summary: "Synthetic volunteer retention survey.",
        key_concepts: ["retention", "mentoring"],
      });
      expect(saved.projectDocumentId).toBeTruthy();
      const pd = saved.projectDocumentId as string;

      const page = await callJson("read_source_text", {
        project_document_id: pd,
        offset: 0,
        max_chars: 40,
      });
      expect(page.text).toBe(fixtureText.slice(0, 40));
      expect(page.nextOffset).toBe(40);
      const rest = await callJson("read_source_text", {
        project_document_id: pd,
        offset: page.nextOffset,
        max_chars: 100000,
      });
      expect(page.text + rest.text).toBe(fixtureText);

      // Summary write + readback
      await callJson("save_source_summary", {
        project_document_id: pd,
        summary: "Edited synthetic summary.",
        main_arguments: ["Mentoring correlates with retention."],
        key_concepts: ["mentoring"],
      });
      const summary = await callJson("get_source_summary", { project_document_id: pd });
      expect(JSON.stringify(summary.summary)).toContain("Edited synthetic summary.");
      expect(JSON.stringify(summary.summary)).toContain("Mentoring correlates with retention.");

      const status = await callJson("get_source_status", { project_document_id: pd });
      expect(status.documentId).toBe(saved.documentId);
      expect(JSON.stringify(status.status)).toMatch(/ready|completed/i);

      // Annotations: save, read back, update, delete
      const annotated = await callJson("save_annotations", {
        project_document_id: pd,
        research_goal: "what predicts volunteer retention",
        annotations: [
          {
            quote: "the difference was modest and the survey cannot show that mentoring caused it",
            category: "evidence",
            note: "Limits the mentoring claim.",
          },
          {
            quote: "Volunteers loved the garden more than anything",
            category: "key_quote",
            note: "x",
          },
        ],
      });
      expect(annotated.savedCount).toBe(1);
      expect(annotated.notFound).toHaveLength(1);
      const annotationId = annotated.saved[0].id as string;
      expect(annotationId).toBeTruthy();

      const readAnnotations = async () =>
        JSON.stringify(await callJson("get_source_annotations", { project_document_id: pd }));
      expect(await readAnnotations()).toContain("Limits the mentoring claim.");

      await callJson("update_annotation", {
        annotation_id: annotationId,
        note: "Updated synthetic note.",
        category: "argument",
      });
      const updated = (
        await callJson("get_source_annotations", { project_document_id: pd })
      ).annotations.find((a: { id: string }) => a.id === annotationId);
      expect(updated).toMatchObject({ note: "Updated synthetic note.", category: "argument" });

      // Citation write + readback through fetch metadata
      await callJson("save_citation", {
        project_document_id: pd,
        citation: {
          sourceType: "other",
          authors: [{ firstName: "Riverside", lastName: "Garden Collective" }],
          title: "Volunteer Retention at the Riverside Community Garden",
          publicationDate: "2024",
        },
      });
      const fetchedSource = await call("fetch", { id: `source:${pd}` });
      const fetchedSourceJson = parseToolJson(fetchedSource);
      expect(fetchedSource.structuredContent).toEqual(fetchedSourceJson);
      expect(fetchedSourceJson.text).toBe(fixtureText);
      expect(JSON.stringify(fetchedSourceJson.metadata)).toContain(
        "Volunteer Retention at the Riverside Community Garden",
      );

      // Quote location: page markers survive so C1-C4 locators stay checkable
      const quote = await callJson("find_quote_in_source", {
        project_document_id: pd,
        quote: "schedule conflicts (46 percent)",
      });
      const quoteJson = JSON.stringify(quote);
      expect(quoteJson).not.toMatch(/"found":\s*false/);
      const c3Offset = fixtureText.indexOf("schedule conflicts (46 percent)");
      expect(fixtureText.lastIndexOf("[Page", c3Offset)).toBe(fixtureText.indexOf("[Page 3]"));
      expect(quoteJson).toContain(String(c3Offset));

      const projectHits = await callJson("search_project_sources", {
        project_id: project.id,
        query: "mentoring",
      });
      // Matches project context, summaries, annotations, and unannotated source passages.
      expect(JSON.stringify(projectHits.results)).toMatch(/mentoring caused it/i);

      const searchResponse = await call("search", { query: "mentoring" });
      const searchJson = parseToolJson(searchResponse);
      expect(searchResponse.structuredContent).toEqual(searchJson);
      expect(searchJson.results.length).toBeGreaterThan(0);

      // Library + attach to a second project
      const loose = await callJson("save_source", {
        text: "Synthetic loose note about compost and soil health.",
        title: "Loose compost note",
      });
      const library = await callJson("get_source_library", { search: "compost" });
      expect(JSON.stringify(library.sources)).toContain(loose.documentId);
      const second = await callJson("create_project", { name: "Second synthetic project" });
      const attached = await callJson("add_source_to_project", {
        project_id: second.id,
        document_id: loose.documentId,
      });
      expect(attached.projectDocument?.id).toBeTruthy();

      const pasted = await callJson("upload_text_to_project", {
        project_id: second.id,
        title: "Pasted synthetic text",
        text: "Synthetic pasted text about rainwater barrels.",
      });
      expect(pasted.projectDocument?.id).toBeTruthy();
      const uploadedFile = await callJson("upload_file_to_project", {
        project_id: second.id,
        filename: "synthetic-notes.txt",
        mime_type: "text/plain",
        file_base64: Buffer.from("Synthetic file about seed libraries.").toString("base64"),
      });
      expect(uploadedFile.projectDocument).toBeTruthy();
      const secondSources = JSON.stringify(
        await callJson("get_project_sources", { project_id: second.id }),
      );
      expect(secondSources).toContain(loose.documentId);
      expect(secondSources).toContain(pasted.document.id);
      expect(secondSources).toContain(uploadedFile.projectDocument.id);
      expect(
        JSON.stringify(await callJson("get_project_sources", { project_id: project.id })),
      ).toContain(pd);

      // Web clips: seeded synthetic clip, then read through the tool
      const { webClips } = await import("../../shared/schema");
      await db.insert(webClips).values({
        userId: "inventory-user",
        highlightedText: "Synthetic clip about pollinator gardens.",
        category: "key_quote",
        sourceUrl: "https://example.test/pollinators",
        pageTitle: "Synthetic pollinators page",
        projectId: project.id,
      } as any);
      const clips = JSON.stringify(await callJson("get_web_clips", { project_id: project.id }));
      expect(clips).toContain("Synthetic clip about pollinator gardens.");

      // Delete + readback
      const deleted = await call("delete_annotation", { annotation_id: annotationId });
      expect(deleted.isError).toBeFalsy();
      expect(await readAnnotations()).not.toContain("Updated synthetic note.");

      // Missing data is rejected rather than silently succeeding
      expect(
        errorText(await call("read_source_text", { project_document_id: "missing-pd" })),
      ).toBeTruthy();
      expect(
        errorText(await call("update_annotation", { annotation_id: annotationId, note: "x" })),
      ).toBeTruthy();
      expect(
        errorText(await call("delete_annotation", { annotation_id: "missing-annotation" })),
      ).toBeTruthy();
      expect(errorText(await call("fetch", { id: "source:missing-pd" }))).toBeTruthy();
      expect(errorText(await call("save_source_summary", { project_document_id: pd }))).toContain(
        "at least one",
      );
      expect((await call("create_project", {})).isError).toBe(true);
      expect(
        errorText(await call("get_project_sources", { project_id: "missing-project" })),
      ).toBeTruthy();

      await client.close();
      expect([...called].sort()).toEqual([...HOST_TOOLS].sort());

      // Read-only scope: reads pass, every write is refused by the backend with 403
      const readOnly = await connectClient(mcp.baseUrl, tokens.readOnly);
      const roProjects = parseToolJson(
        (await readOnly.callTool({ name: "get_projects", arguments: {} })) as ToolResult,
      );
      expect(roProjects.map((p: { id: string }) => p.id)).toContain(project.id);
      for (const [name, args] of [
        ["create_project", { name: "Should fail" }],
        ["save_source", { text: "Should fail" }],
        [
          "save_annotations",
          {
            project_document_id: pd,
            annotations: [{ quote: "Methods", category: "evidence", note: "x" }],
          },
        ],
        [
          "save_citation",
          { project_document_id: pd, citation: { sourceType: "book", authors: [], title: "x" } },
        ],
      ] as const) {
        const result = (await readOnly.callTool({ name, arguments: args })) as ToolResult;
        expect(errorText(result), name).toContain(`lacks "write" permission`);
      }
      await readOnly.close();
      expect(
        JSON.stringify(await readAnnotationsWith(mcp.baseUrl, tokens.readWrite, pd)),
      ).not.toContain("Methods");

      // Expired token and another user's token cannot reach this user's data
      const expired = await connectClient(mcp.baseUrl, tokens.expired);
      expect(
        errorText((await expired.callTool({ name: "get_projects", arguments: {} })) as ToolResult),
      ).toContain("Authentication failed");
      await expired.close();
      const other = await connectClient(mcp.baseUrl, tokens.other);
      expect(
        parseToolJson(
          (await other.callTool({ name: "get_projects", arguments: {} })) as ToolResult,
        ),
      ).toEqual([]);
      expect(
        (await other.callTool({ name: "read_source_text", arguments: { project_document_id: pd } }))
          .isError,
      ).toBe(true);
      await other.close();

      expect(generateDocumentSummary).not.toHaveBeenCalled();
      expect(generateRetrievalContext).not.toHaveBeenCalled();
      expect(extractCitationMetadata).not.toHaveBeenCalled();
      expect(getEmbeddingWithUsage).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  }, 60_000);
});

async function readAnnotationsWith(mcpBaseUrl: string, token: string, projectDocumentId: string) {
  const client = await connectClient(mcpBaseUrl, token);
  try {
    return parseToolJson(
      (await client.callTool({
        name: "get_source_annotations",
        arguments: { project_document_id: projectDocumentId },
      })) as ToolResult,
    );
  } finally {
    await client.close();
  }
}
