import { BackendHttpError, ScholarMarkBackendClient } from "./backend-client.js";
import { consumeSSEStream } from "./sse-buffer.js";
import { z } from "zod";
const RETRIEVAL_OUTPUT_SCHEMAS = {
    search: z.object({
        results: z.array(z.object({
            id: z.string(), title: z.string(), url: z.string(),
            text: z.string().optional(), score: z.number().nullable().optional(),
        })),
    }),
    fetch: z.object({
        id: z.string(), title: z.string(), text: z.string(), url: z.string(),
        metadata: z.record(z.string(), z.unknown()).optional(),
    }),
};
function asTextResult(payload) {
    return {
        content: [
            {
                type: "text",
                text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
            },
        ],
    };
}
function asErrorResult(message) {
    return {
        isError: true,
        content: [
            {
                type: "text",
                text: message,
            },
        ],
    };
}
const READ_ONLY = { readOnlyHint: true, openWorldHint: false };
function asRetrievalResult(payload) {
    return { ...asTextResult(payload), structuredContent: payload };
}
const WRITES = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const OVERWRITES = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
const DELETES = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
// Directory listings (Claude connectors, ChatGPT apps) require a title and safety hints on every tool.
const TOOL_METADATA = {
    get_projects: { title: "List projects", annotations: READ_ONLY },
    create_project: { title: "Create project", annotations: WRITES },
    get_source_library: { title: "List source library", annotations: READ_ONLY },
    get_project_sources: { title: "List project sources", annotations: READ_ONLY },
    search_project_sources: { title: "Search project", annotations: READ_ONLY },
    add_source_to_project: { title: "Add source to project", annotations: WRITES },
    upload_text_to_project: { title: "Upload text to project", annotations: WRITES },
    upload_file_to_project: { title: "Upload file to project", annotations: WRITES },
    get_source_status: { title: "Get source status", annotations: READ_ONLY },
    get_source_summary: { title: "Get source summary", annotations: READ_ONLY },
    get_source_annotations: { title: "Get annotations", annotations: READ_ONLY },
    get_source_chunks: { title: "Semantic source search", annotations: READ_ONLY },
    find_quote_in_source: { title: "Find quote in source", annotations: READ_ONLY },
    get_web_clips: { title: "Get web clips", annotations: READ_ONLY },
    start_conversation: { title: "Start ScholarMark chat", annotations: WRITES },
    send_message: { title: "Send ScholarMark chat message", annotations: WRITES },
    get_conversations: { title: "List ScholarMark chats", annotations: READ_ONLY },
    compile_paper: { title: "Compile paper", annotations: WRITES },
    verify_paper: { title: "Verify paper", annotations: READ_ONLY },
    save_source: { title: "Save source", annotations: WRITES },
    read_source_text: { title: "Read source text", annotations: READ_ONLY },
    save_source_summary: { title: "Save source summary", annotations: OVERWRITES },
    save_annotations: { title: "Save annotations", annotations: WRITES },
    update_annotation: { title: "Update annotation", annotations: OVERWRITES },
    delete_annotation: { title: "Delete annotation", annotations: DELETES },
    save_citation: { title: "Save citation", annotations: OVERWRITES },
    search: { title: "Search ScholarMark", annotations: READ_ONLY },
    fetch: { title: "Fetch ScholarMark item", annotations: READ_ONLY },
};
/**
 * Tools that run ScholarMark's own OpenAI/Anthropic calls. In host-AI mode the
 * connecting client (Claude, ChatGPT) does that work itself, so these are hidden.
 */
const SERVER_AI_TOOLS = new Set([
    "get_source_chunks",
    "start_conversation",
    "send_message",
    "get_conversations",
    "compile_paper",
    "verify_paper",
]);
function registerTool(server, name, description, inputSchema, handler) {
    if (typeof server.registerTool === "function") {
        const mcpInputSchema = toZodInputSchema(inputSchema);
        const metadata = TOOL_METADATA[name] ?? {};
        server.registerTool(name, {
            title: metadata.title,
            description,
            inputSchema: mcpInputSchema,
            outputSchema: RETRIEVAL_OUTPUT_SCHEMAS[name],
            annotations: metadata.annotations,
        }, handler);
        return;
    }
    if (typeof server.tool === "function") {
        server.tool(name, description, inputSchema, handler);
        return;
    }
    throw new Error("MCP server instance does not support tool registration");
}
function toZodField(schema) {
    const schemaType = typeof schema.type === "string" ? schema.type : "";
    let field;
    if (schemaType === "string") {
        field = z.string();
    }
    else if (schemaType === "number") {
        field = z.number();
    }
    else if (schemaType === "integer") {
        field = z.number().int();
    }
    else if (schemaType === "boolean") {
        field = z.boolean();
    }
    else if (schemaType === "array") {
        const items = typeof schema.items === "object" && schema.items !== null ? schema.items : {};
        field = z.array(toZodField(items));
    }
    else if (schemaType === "object") {
        field = toZodInputSchema(schema);
    }
    else {
        field = z.any();
    }
    if (Array.isArray(schema.enum) && schema.enum.length > 0 && schemaType === "string") {
        field = z.enum(schema.enum);
    }
    const description = typeof schema.description === "string" ? schema.description.trim() : "";
    if (description.length > 0) {
        return field.describe(description);
    }
    return field;
}
function toZodInputSchema(inputSchema) {
    const schemaType = typeof inputSchema.type === "string" ? inputSchema.type : "";
    if (schemaType !== "object") {
        return z.object({}).passthrough();
    }
    const properties = typeof inputSchema.properties === "object" && inputSchema.properties !== null
        ? inputSchema.properties
        : {};
    const required = Array.isArray(inputSchema.required)
        ? inputSchema.required.filter((entry) => typeof entry === "string")
        : [];
    const requiredSet = new Set(required);
    const shape = {};
    for (const [key, rawValue] of Object.entries(properties)) {
        const schema = typeof rawValue === "object" && rawValue !== null
            ? rawValue
            : {};
        let field = toZodField(schema);
        if (!requiredSet.has(key)) {
            field = field.optional();
        }
        shape[key] = field;
    }
    const base = z.object(shape);
    return inputSchema.additionalProperties === false ? base.strict() : base.passthrough();
}
function getHeaderValue(headers, headerName) {
    if (!headers)
        return null;
    if (typeof Headers !== "undefined" && headers instanceof Headers) {
        return headers.get(headerName);
    }
    if (typeof headers === "object") {
        const record = headers;
        const direct = record[headerName] ?? record[headerName.toLowerCase()] ?? record[headerName.toUpperCase()];
        if (typeof direct === "string")
            return direct;
        if (Array.isArray(direct) && typeof direct[0] === "string")
            return direct[0];
    }
    return null;
}
function extractBearerToken(context) {
    if (context.authInfo?.token) {
        return context.authInfo.token;
    }
    const candidateHeaders = [
        context.requestInfo?.headers,
        context.request?.headers,
        context.headers,
        context.meta?.headers,
        context._meta?.headers,
    ];
    for (const headers of candidateHeaders) {
        const authorization = getHeaderValue(headers, "authorization");
        if (!authorization)
            continue;
        const [scheme, token] = authorization.split(/\s+/);
        if (!scheme || !token)
            continue;
        if (scheme.toLowerCase() !== "bearer")
            continue;
        return token;
    }
    return null;
}
function parseRequiredString(input, key) {
    const value = input[key];
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${key} is required`);
    }
    return value.trim();
}
function parseOptionalString(input, key) {
    const value = input[key];
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function parseOptionalSourceRole(input) {
    const sourceRole = parseOptionalString(input, "source_role");
    if (!sourceRole) {
        return undefined;
    }
    const normalized = sourceRole.toLowerCase();
    if (["evidence", "background", "style_reference"].includes(normalized)) {
        return normalized;
    }
    throw new Error("source_role must be one of: evidence, background, style_reference");
}
function parseOptionalOcrMode(input) {
    const ocrMode = parseOptionalString(input, "ocr_mode");
    if (!ocrMode) {
        return "standard";
    }
    const normalized = ocrMode.toLowerCase().replace(/-/g, "_");
    if (["standard", "advanced", "vision", "vision_batch"].includes(normalized)) {
        return normalized;
    }
    throw new Error("ocr_mode must be one of: standard, advanced, vision, vision_batch");
}
function parseBase64FileContent(input) {
    const raw = parseRequiredString(input, "file_base64");
    const commaIndex = raw.indexOf(",");
    const encoded = raw.startsWith("data:") && commaIndex >= 0 ? raw.slice(commaIndex + 1) : raw;
    const cleaned = encoded.replace(/\s+/g, "");
    if (cleaned.length === 0) {
        throw new Error("file_base64 must contain base64-encoded file bytes");
    }
    const buffer = Buffer.from(cleaned, "base64");
    if (buffer.length === 0) {
        throw new Error("file_base64 decoded to an empty file");
    }
    return buffer;
}
function buildProjectDocumentPayload(input, documentId) {
    const payload = { documentId };
    const folderId = parseOptionalString(input, "folder_id");
    const projectContext = parseOptionalString(input, "project_context");
    const roleInProject = parseOptionalString(input, "role_in_project");
    const sourceRole = parseOptionalSourceRole(input);
    if (folderId)
        payload.folderId = folderId;
    if (projectContext)
        payload.projectContext = projectContext;
    if (roleInProject)
        payload.roleInProject = roleInProject;
    if (sourceRole)
        payload.sourceRole = sourceRole;
    return payload;
}
async function addDocumentToProject(client, token, input, documentId) {
    const projectId = encodeURIComponent(parseRequiredString(input, "project_id"));
    return await client.requestJson("POST", `/api/projects/${projectId}/documents`, token, buildProjectDocumentPayload(input, documentId));
}
function buildQueryString(params) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (typeof value === "undefined" || value === null) {
            continue;
        }
        search.set(key, String(value));
    }
    const query = search.toString();
    return query.length > 0 ? `?${query}` : "";
}
function buildTextFingerprint(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
}
function buildIndexedText(text, mode) {
    const normalizedChars = [];
    const rawPositions = [];
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (mode === "whitespace" && /\s/.test(char)) {
            continue;
        }
        if (mode === "alphanumeric" && !/[a-z0-9]/i.test(char)) {
            continue;
        }
        normalizedChars.push(char.toLowerCase());
        rawPositions.push(index);
    }
    return {
        normalized: normalizedChars.join(""),
        rawPositions,
    };
}
function findTextRange(fullText, quote) {
    if (!fullText || !quote) {
        return null;
    }
    const directIndex = fullText.indexOf(quote);
    if (directIndex >= 0) {
        return {
            startPosition: directIndex,
            endPosition: directIndex + quote.length,
            matchType: "exact",
        };
    }
    const foldedText = fullText.toLowerCase();
    const foldedQuote = quote.toLowerCase();
    const insensitiveIndex = foldedText.indexOf(foldedQuote);
    if (insensitiveIndex >= 0) {
        return {
            startPosition: insensitiveIndex,
            endPosition: insensitiveIndex + quote.length,
            matchType: "case_insensitive",
        };
    }
    for (const mode of ["whitespace", "alphanumeric"]) {
        const indexedFullText = buildIndexedText(fullText, mode);
        const indexedQuote = buildIndexedText(quote, mode);
        if (!indexedQuote.normalized) {
            continue;
        }
        const normalizedIndex = indexedFullText.normalized.indexOf(indexedQuote.normalized);
        if (normalizedIndex < 0) {
            continue;
        }
        const startPosition = indexedFullText.rawPositions[normalizedIndex];
        const endPosition = indexedFullText.rawPositions[normalizedIndex + indexedQuote.normalized.length - 1] + 1;
        return {
            startPosition,
            endPosition,
            matchType: mode === "whitespace" ? "whitespace_insensitive" : "alphanumeric",
        };
    }
    return null;
}
function textsLooselyEqual(left, right) {
    if (left === right) {
        return true;
    }
    if (left.toLowerCase() === right.toLowerCase()) {
        return true;
    }
    return buildTextFingerprint(left) === buildTextFingerprint(right);
}
function getNumericPosition(record, key) {
    const value = record?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function rangesOverlap(leftStart, leftEnd, rightStart, rightEnd) {
    return leftStart < rightEnd && rightStart < leftEnd;
}
function findBestAnnotationMatch(annotations, quote, textMatch) {
    const annotationRows = Array.isArray(annotations) ? annotations : [];
    let bestAnnotation = null;
    let bestScore = -Infinity;
    for (const annotation of annotationRows) {
        const highlightedText = typeof annotation?.highlightedText === "string"
            ? annotation.highlightedText
            : "";
        const startPosition = getNumericPosition(annotation, "startPosition");
        const endPosition = getNumericPosition(annotation, "endPosition");
        let score = 0;
        if (highlightedText === quote) {
            score += 120;
        }
        else if (textsLooselyEqual(highlightedText, quote)) {
            score += 90;
        }
        if (textMatch && startPosition !== null && endPosition !== null) {
            if (startPosition === textMatch.startPosition && endPosition === textMatch.endPosition) {
                score += 60;
            }
            else if (rangesOverlap(startPosition, endPosition, textMatch.startPosition, textMatch.endPosition)) {
                score += 35;
            }
            else {
                score -= Math.min(25, Math.abs(startPosition - textMatch.startPosition));
            }
        }
        if (!textMatch && startPosition !== null && endPosition !== null) {
            score -= Math.abs((endPosition - startPosition) - quote.length);
        }
        if (score > bestScore) {
            bestScore = score;
            bestAnnotation = annotation;
        }
    }
    return bestScore >= 40 ? bestAnnotation : null;
}
function buildProjectAnnotationJumpPath(options) {
    const params = new URLSearchParams();
    if (options.annotationId) {
        params.set("annotationId", options.annotationId);
    }
    if (typeof options.startPosition === "number" && Number.isFinite(options.startPosition)) {
        params.set("start", String(options.startPosition));
    }
    if (options.anchorFingerprint) {
        params.set("anchor", options.anchorFingerprint);
    }
    const query = params.toString();
    const basePath = `/projects/${options.projectId}/documents/${options.projectDocumentId}`;
    return query.length > 0 ? `${basePath}?${query}` : basePath;
}
async function resolveSourceIds(client, token, input) {
    const projectDocumentId = parseOptionalString(input, "project_document_id");
    const documentId = parseOptionalString(input, "document_id");
    if (projectDocumentId) {
        const projectDocument = await client.requestJson("GET", `/api/project-documents/${encodeURIComponent(projectDocumentId)}`, token);
        const resolvedDocumentId = typeof projectDocument?.documentId === "string"
            ? projectDocument.documentId.trim()
            : "";
        if (resolvedDocumentId.length === 0) {
            throw new Error("Project document did not include a backing document ID.");
        }
        return {
            projectDocumentId,
            documentId: resolvedDocumentId,
            projectDocument,
        };
    }
    if (documentId) {
        return {
            projectDocumentId: undefined,
            documentId,
            projectDocument: null,
        };
    }
    throw new Error("project_document_id or document_id is required");
}
function describeBackendError(error) {
    if (error instanceof BackendHttpError) {
        if (error.status === 401) {
            return "Authentication failed. Please reconnect the ScholarMark connector.";
        }
        if (error.status === 403) {
            return "This feature requires a ScholarMark Pro plan.";
        }
        if (error.status === 404) {
            return "Requested ScholarMark resource was not found.";
        }
        if (typeof error.body === "string" && error.body.trim().length > 0) {
            return `Backend request failed (${error.status}): ${error.body}`;
        }
        if (error.body && typeof error.body === "object") {
            const message = error.body.message;
            if (typeof message === "string" && message.trim().length > 0) {
                return `Backend request failed (${error.status}): ${message}`;
            }
        }
        return `Backend request failed with status ${error.status}`;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return "Unknown tool execution error";
}
function formatSseOutput(result) {
    const sections = [];
    if (result.text.trim().length > 0) {
        sections.push(result.text.trim());
    }
    for (const document of result.documents) {
        const safeTitle = (document.title || "Draft").replace(/"/g, "'");
        sections.push(`<document title="${safeTitle}">\n${document.content}\n</document>`);
    }
    return sections.join("\n\n").trim();
}
async function withToken(context, fn) {
    try {
        const token = extractBearerToken(context);
        if (!token) {
            return asErrorResult("Missing Bearer token in MCP request context.");
        }
        return await fn(token);
    }
    catch (error) {
        return asErrorResult(describeBackendError(error));
    }
}
const ANNOTATION_CATEGORIES = ["key_quote", "argument", "evidence", "methodology", "user_added"];
function parseBoundedInteger(input, key, fallback, min, max) {
    const value = input[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, Math.floor(value)));
}
function parseOptionalStringList(input, key) {
    const value = input[key];
    if (typeof value === "undefined") {
        return undefined;
    }
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
        throw new Error(`${key} must be an array of strings`);
    }
    return value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}
function buildSummaryPayload(input) {
    const summary = parseOptionalString(input, "summary");
    const mainArguments = parseOptionalStringList(input, "main_arguments");
    const keyConcepts = parseOptionalStringList(input, "key_concepts");
    if (!summary && !mainArguments && !keyConcepts) {
        return null;
    }
    return {
        ...(summary ? { summary } : {}),
        ...(mainArguments ? { mainArguments } : {}),
        ...(keyConcepts ? { keyConcepts } : {}),
    };
}
function parseOptionalCitation(input) {
    const citation = input.citation;
    if (typeof citation === "undefined" || citation === null) {
        return undefined;
    }
    if (typeof citation !== "object" || Array.isArray(citation)) {
        throw new Error("citation must be an object");
    }
    if (typeof citation.title !== "string" || typeof citation.sourceType !== "string" || !Array.isArray(citation.authors)) {
        throw new Error("citation needs sourceType, title, and authors (use [] when there is no author)");
    }
    return citation;
}
function truncateText(text, maxChars) {
    const value = String(text ?? "");
    return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
}
export const SCHOLARMARK_HOST_INSTRUCTIONS = `ScholarMark stores the user's research sources, highlights, notes, and citations. You do the reading and analysis; ScholarMark keeps the results so they persist across chats and show up in the ScholarMark web app.

When the user pastes or shares a document:
1. Pick or create a project (get_projects, create_project). Ask which project if it is unclear.
2. Save the document verbatim with save_source and the project_id. Include your summary, key concepts, and citation metadata when you can tell them from the text.
3. Ask the user what they are looking for in this source (their research question, thesis, or the kind of evidence they need) before annotating, unless they already said.
4. Read it with read_source_text (page through long sources with nextOffset), then call save_annotations with exact quotes, a category, and a note tying each quote to the user's goal. Retry or drop any quotes reported in notFound.
5. Tell the user what you saved.

To answer questions about saved material, use search and fetch, or search_project_sources, get_source_annotations, and find_quote_in_source. Quote saved text exactly and say which source it came from. Confirm with the user before deleting anything.`;
export function registerScholarMarkTools(server, options) {
    const hostAiMode = (options.aiMode ?? "host") === "host";
    const client = new ScholarMarkBackendClient(options.backendBaseUrl, undefined, hostAiMode ? { "X-ScholarMark-AI-Mode": "host" } : {});
    const appBaseUrl = (options.appBaseUrl ?? "https://app.scholarmark.ai").replace(/\/+$/, "");
    const register = (name, ...rest) => {
        if (hostAiMode && SERVER_AI_TOOLS.has(name)) {
            return;
        }
        registerTool(server, name, ...rest);
    };
    register("get_projects", "List your ScholarMark writing projects", {
        type: "object",
        properties: {},
        additionalProperties: false,
    }, async (_input, context) => withToken(context, async (token) => {
        const projects = await client.requestJson("GET", "/api/projects", token);
        return asTextResult(projects);
    }));
    register("create_project", "Create a new ScholarMark project for organizing sources, quote work, and writing", {
        type: "object",
        properties: {
            name: { type: "string", description: "Project name" },
            description: { type: "string", description: "Optional project description" },
            thesis: { type: "string", description: "Optional working thesis or research question" },
            scope: { type: "string", description: "Optional assignment scope, paper type, or constraints" },
        },
        required: ["name"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const name = parseRequiredString(input, "name");
        const project = await client.requestJson("POST", "/api/projects", token, {
            name,
            description: parseOptionalString(input, "description"),
            thesis: parseOptionalString(input, "thesis"),
            scope: parseOptionalString(input, "scope"),
        });
        return asTextResult(project);
    }));
    register("get_source_library", "List uploaded ScholarMark sources in your personal library, before or after attaching them to projects", {
        type: "object",
        properties: {
            search: { type: "string", description: "Optional case-insensitive filter over filename or summary" },
            limit: { type: "integer", description: "Optional result limit (default 100, max 300)" },
        },
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const rawSources = await client.requestJson("GET", "/api/documents/meta", token);
        const sources = Array.isArray(rawSources) ? rawSources : [];
        const search = parseOptionalString(input, "search")?.toLowerCase();
        const limit = typeof input.limit === "number" && Number.isFinite(input.limit)
            ? Math.max(1, Math.min(300, Math.floor(input.limit)))
            : 100;
        const filtered = search
            ? sources.filter((source) => {
                const filename = typeof source?.filename === "string" ? source.filename : "";
                const summary = typeof source?.summary === "string" ? source.summary : "";
                return `${filename}\n${summary}`.toLowerCase().includes(search);
            })
            : sources;
        return asTextResult({
            count: filtered.length,
            sources: filtered.slice(0, limit),
        });
    }));
    register("get_project_sources", "List sources attached to a specific ScholarMark project", {
        type: "object",
        properties: {
            project_id: { type: "string", description: "ScholarMark project ID" },
        },
        required: ["project_id"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const projectId = encodeURIComponent(parseRequiredString(input, "project_id"));
        const sources = await client.requestJson("GET", `/api/projects/${projectId}/documents`, token);
        return asTextResult(sources);
    }));
    register("search_project_sources", "Search across all sources and saved evidence in a ScholarMark project", {
        type: "object",
        properties: {
            project_id: { type: "string", description: "ScholarMark project ID" },
            query: { type: "string", description: "What to search for across the project" },
            limit: { type: "integer", description: "Optional result limit" },
        },
        required: ["project_id", "query"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const projectId = encodeURIComponent(parseRequiredString(input, "project_id"));
        const query = parseRequiredString(input, "query");
        const limit = typeof input.limit === "number" && Number.isFinite(input.limit)
            ? Math.max(1, Math.min(100, Math.floor(input.limit)))
            : undefined;
        const results = await client.requestJson("POST", `/api/projects/${projectId}/search`, token, {
            query,
            limit,
        });
        return asTextResult({
            projectId: decodeURIComponent(projectId),
            query,
            results,
        });
    }));
    register("add_source_to_project", "Attach an existing uploaded source from your library to a ScholarMark project", {
        type: "object",
        properties: {
            project_id: { type: "string", description: "ScholarMark project ID" },
            document_id: { type: "string", description: "Document ID from get_source_library" },
            folder_id: { type: "string", description: "Optional project folder ID" },
            source_role: {
                type: "string",
                description: "Optional role: evidence, background, or style_reference",
            },
            role_in_project: { type: "string", description: "Optional note about how this source should be used" },
            project_context: { type: "string", description: "Optional project-specific context for this source" },
        },
        required: ["project_id", "document_id"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const documentId = parseRequiredString(input, "document_id");
        const projectDocument = await addDocumentToProject(client, token, input, documentId);
        return asTextResult({
            documentId,
            projectDocument,
        });
    }));
    register("upload_text_to_project", "Create a ScholarMark source from pasted text and attach it to a project", {
        type: "object",
        properties: {
            project_id: { type: "string", description: "ScholarMark project ID" },
            title: { type: "string", description: "Source title or filename" },
            text: { type: "string", description: "Source text to save and index" },
            folder_id: { type: "string", description: "Optional project folder ID" },
            source_role: {
                type: "string",
                description: "Optional role: evidence, background, or style_reference",
            },
            role_in_project: { type: "string", description: "Optional note about how this source should be used" },
            project_context: { type: "string", description: "Optional project-specific context for this source" },
        },
        required: ["project_id", "text"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const text = parseRequiredString(input, "text");
        const formData = new FormData();
        const title = parseOptionalString(input, "title");
        if (title) {
            formData.append("title", title);
        }
        formData.append("text", text);
        const document = await client.requestFormData("POST", "/api/upload-text", token, formData);
        const documentId = typeof document?.id === "string" ? document.id : "";
        if (!documentId) {
            throw new Error("Text upload did not return a document ID.");
        }
        const projectDocument = await addDocumentToProject(client, token, input, documentId);
        return asTextResult({
            document,
            projectDocument,
        });
    }));
    register("upload_file_to_project", "Upload a base64-encoded file as a ScholarMark source and attach it to a project", {
        type: "object",
        properties: {
            project_id: { type: "string", description: "ScholarMark project ID" },
            filename: { type: "string", description: "Original filename, including extension" },
            file_base64: { type: "string", description: "Base64 file content, optionally as a data URL" },
            mime_type: { type: "string", description: "Optional MIME type, for example application/pdf" },
            ocr_mode: { type: "string", description: "Optional OCR mode: standard, advanced, vision, or vision_batch" },
            ocr_model: { type: "string", description: "Optional OCR model override for image or vision PDF processing" },
            folder_id: { type: "string", description: "Optional project folder ID" },
            source_role: {
                type: "string",
                description: "Optional role: evidence, background, or style_reference",
            },
            role_in_project: { type: "string", description: "Optional note about how this source should be used" },
            project_context: { type: "string", description: "Optional project-specific context for this source" },
        },
        required: ["project_id", "filename", "file_base64"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const filename = parseRequiredString(input, "filename");
        const mimeType = parseOptionalString(input, "mime_type") || "application/octet-stream";
        if (hostAiMode) {
            const isTextLayerFile = /\.(pdf|txt)$/i.test(filename);
            const ocrMode = parseOptionalOcrMode(input);
            if (!isTextLayerFile || ocrMode !== "standard") {
                return asErrorResult("Only PDFs with a text layer and .txt files can be uploaded directly. For scans, images, or other formats, read the file yourself and pass its text to save_source.");
            }
        }
        const fileBuffer = parseBase64FileContent(input);
        const formData = new FormData();
        formData.append("file", new Blob([fileBuffer], { type: mimeType }), filename);
        formData.append("ocrMode", parseOptionalOcrMode(input));
        const ocrModel = parseOptionalString(input, "ocr_model");
        if (ocrModel) {
            formData.append("ocrModel", ocrModel);
        }
        const document = await client.requestFormData("POST", "/api/upload", token, formData);
        const documentId = typeof document?.id === "string" ? document.id : "";
        if (!documentId) {
            throw new Error("File upload did not return a document ID.");
        }
        const projectDocument = await addDocumentToProject(client, token, input, documentId);
        return asTextResult({
            document,
            projectDocument,
        });
    }));
    register("get_source_status", "Check whether an uploaded ScholarMark source is ready, processing, or errored", {
        type: "object",
        properties: {
            project_document_id: { type: "string", description: "Project document ID from get_project_sources" },
            document_id: { type: "string", description: "Underlying document ID if you already have it" },
        },
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const { projectDocumentId, documentId } = await resolveSourceIds(client, token, input);
        const status = await client.requestJson("GET", `/api/documents/${encodeURIComponent(documentId)}/status`, token);
        return asTextResult({
            projectDocumentId: projectDocumentId ?? null,
            documentId,
            status,
        });
    }));
    register("get_source_summary", "Load a source summary, key concepts, and related project-document metadata", {
        type: "object",
        properties: {
            project_document_id: { type: "string", description: "Project document ID from get_project_sources" },
            document_id: { type: "string", description: "Underlying document ID if you already have it" },
        },
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const { projectDocumentId, documentId, projectDocument } = await resolveSourceIds(client, token, input);
        const summary = await client.requestJson("GET", `/api/documents/${encodeURIComponent(documentId)}/summary`, token);
        return asTextResult({
            projectDocumentId: projectDocumentId ?? null,
            documentId,
            projectDocument,
            summary,
        });
    }));
    register("get_source_annotations", "Load quote-bank annotations for a project source or a plain document", {
        type: "object",
        properties: {
            project_document_id: { type: "string", description: "Project document ID from get_project_sources" },
            document_id: { type: "string", description: "Underlying document ID if you want legacy document annotations" },
        },
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const { projectDocumentId, documentId } = await resolveSourceIds(client, token, input);
        if (projectDocumentId) {
            const annotations = await client.requestJson("GET", `/api/project-documents/${encodeURIComponent(projectDocumentId)}/annotations`, token);
            return asTextResult({
                scope: "project_document",
                projectDocumentId,
                documentId,
                annotations,
            });
        }
        const annotations = await client.requestJson("GET", `/api/documents/${encodeURIComponent(documentId)}/annotations`, token);
        return asTextResult({
            scope: "document",
            documentId,
            annotations,
        });
    }));
    register("get_source_chunks", "Search a source for relevant chunks/quotes and return the best matching passages", {
        type: "object",
        properties: {
            project_document_id: { type: "string", description: "Project document ID from get_project_sources" },
            document_id: { type: "string", description: "Underlying document ID if you want non-project document search" },
            query: { type: "string", description: "What you want to find in the source" },
        },
        required: ["query"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const query = parseRequiredString(input, "query");
        const { projectDocumentId, documentId } = await resolveSourceIds(client, token, input);
        if (projectDocumentId) {
            const results = await client.requestJson("POST", `/api/project-documents/${encodeURIComponent(projectDocumentId)}/search`, token, { query });
            return asTextResult({
                scope: "project_document",
                projectDocumentId,
                documentId,
                query,
                results,
            });
        }
        const results = await client.requestJson("POST", `/api/documents/${encodeURIComponent(documentId)}/search`, token, { query });
        return asTextResult({
            scope: "document",
            documentId,
            query,
            results,
        });
    }));
    register("find_quote_in_source", "Find an exact or OCR-tolerant quote in a source and return positions, related annotation data, and a jump path when available", {
        type: "object",
        properties: {
            project_document_id: { type: "string", description: "Project document ID from get_project_sources" },
            document_id: { type: "string", description: "Underlying document ID if you want non-project document lookup" },
            quote: { type: "string", description: "Exact quote text to locate inside the source" },
        },
        required: ["quote"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const quote = parseRequiredString(input, "quote");
        const { projectDocumentId, documentId, projectDocument } = await resolveSourceIds(client, token, input);
        const document = await client.requestJson("GET", `/api/documents/${encodeURIComponent(documentId)}`, token);
        const fullText = typeof document?.fullText === "string" ? document.fullText : "";
        const annotations = projectDocumentId
            ? await client.requestJson("GET", `/api/project-documents/${encodeURIComponent(projectDocumentId)}/annotations`, token)
            : await client.requestJson("GET", `/api/documents/${encodeURIComponent(documentId)}/annotations`, token);
        let textMatch = findTextRange(fullText, quote);
        const annotationMatch = findBestAnnotationMatch(annotations, quote, textMatch);
        if (!textMatch && annotationMatch) {
            const annotationStart = getNumericPosition(annotationMatch, "startPosition");
            const annotationEnd = getNumericPosition(annotationMatch, "endPosition");
            if (annotationStart !== null && annotationEnd !== null) {
                textMatch = {
                    startPosition: annotationStart,
                    endPosition: annotationEnd,
                    matchType: "annotation",
                };
            }
        }
        const projectId = typeof projectDocument?.projectId === "string" ? projectDocument.projectId : null;
        const anchorSourceText = typeof annotationMatch?.highlightedText === "string" && annotationMatch.highlightedText.trim().length > 0
            ? annotationMatch.highlightedText
            : quote;
        const anchorFingerprint = buildTextFingerprint(anchorSourceText) || null;
        const matchedText = textMatch && textMatch.endPosition > textMatch.startPosition && fullText.length > 0
            ? fullText.slice(textMatch.startPosition, textMatch.endPosition)
            : typeof annotationMatch?.highlightedText === "string"
                ? annotationMatch.highlightedText
                : null;
        const jumpPath = projectDocumentId && projectId && textMatch
            ? buildProjectAnnotationJumpPath({
                projectId,
                projectDocumentId,
                annotationId: typeof annotationMatch?.id === "string" ? annotationMatch.id : null,
                startPosition: textMatch.startPosition,
                anchorFingerprint,
            })
            : null;
        return asTextResult({
            found: Boolean(textMatch || annotationMatch),
            scope: projectDocumentId ? "project_document" : "document",
            projectId,
            projectDocumentId: projectDocumentId ?? null,
            documentId,
            quote,
            match: textMatch
                ? {
                    ...textMatch,
                    matchedText,
                    anchorFingerprint,
                }
                : null,
            annotation: annotationMatch
                ? {
                    id: typeof annotationMatch.id === "string" ? annotationMatch.id : null,
                    category: typeof annotationMatch.category === "string" ? annotationMatch.category : null,
                    note: typeof annotationMatch.note === "string" ? annotationMatch.note : null,
                    highlightedText: typeof annotationMatch.highlightedText === "string" ? annotationMatch.highlightedText : null,
                    startPosition: getNumericPosition(annotationMatch, "startPosition"),
                    endPosition: getNumericPosition(annotationMatch, "endPosition"),
                }
                : null,
            jumpPath,
        });
    }));
    register("get_web_clips", "Load saved web clips, optionally filtered to a project, URL, category, or text query", {
        type: "object",
        properties: {
            project_id: { type: "string", description: "Optional project ID to limit clips to one project" },
            source_url: { type: "string", description: "Optional exact source URL filter" },
            category: { type: "string", description: "Optional clip category filter" },
            search: { type: "string", description: "Optional text search across clip content and notes" },
            limit: { type: "integer", description: "Optional result limit (default 25, max 200)" },
            sort: { type: "string", description: "Optional sort: newest, oldest, or site" },
        },
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const projectId = parseOptionalString(input, "project_id");
        const sourceUrl = parseOptionalString(input, "source_url");
        const category = parseOptionalString(input, "category");
        const search = parseOptionalString(input, "search");
        const sort = parseOptionalString(input, "sort");
        const limit = typeof input.limit === "number" && Number.isFinite(input.limit)
            ? Math.max(1, Math.min(200, Math.floor(input.limit)))
            : 25;
        const query = buildQueryString({
            projectId,
            sourceUrl,
            category,
            search,
            sort,
            limit,
        });
        const clips = await client.requestJson("GET", `/api/web-clips${query}`, token);
        return asTextResult(clips);
    }));
    register("start_conversation", "Start a new ScholarMark conversation for a project", {
        type: "object",
        properties: {
            project_id: { type: "string", description: "ScholarMark project ID" },
            title: { type: "string", description: "Optional conversation title" },
        },
        required: ["project_id"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const projectId = parseRequiredString(input, "project_id");
        const title = typeof input.title === "string" ? input.title.trim() : undefined;
        const conversation = await client.requestJson("POST", "/api/chat/conversations", token, {
            projectId,
            title: title && title.length > 0 ? title : "New Chat",
            model: "claude-opus-4-6",
            writingModel: "precision",
        });
        return asTextResult(conversation);
    }));
    register("send_message", "Send a message to a ScholarMark conversation and return the full buffered answer", {
        type: "object",
        properties: {
            conversation_id: { type: "string", description: "Conversation ID" },
            message: { type: "string", description: "Message content" },
        },
        required: ["conversation_id", "message"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const conversationId = encodeURIComponent(parseRequiredString(input, "conversation_id"));
        const message = parseRequiredString(input, "message");
        const response = await client.requestSSE("POST", `/api/chat/conversations/${conversationId}/messages`, token, { content: message }, 300_000);
        const buffered = await consumeSSEStream(response, { timeoutMs: 300_000 });
        const fullResponse = formatSseOutput(buffered);
        return asTextResult({
            response: fullResponse,
            usage: buffered.usage,
        });
    }));
    register("get_conversations", "List conversations for a ScholarMark project", {
        type: "object",
        properties: {
            project_id: { type: "string", description: "ScholarMark project ID" },
        },
        required: ["project_id"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const projectId = encodeURIComponent(parseRequiredString(input, "project_id"));
        const conversations = await client.requestJson("GET", `/api/chat/conversations?projectId=${projectId}`, token);
        return asTextResult(conversations);
    }));
    register("compile_paper", "Compile a conversation into a finalized paper draft", {
        type: "object",
        properties: {
            conversation_id: { type: "string", description: "Conversation ID" },
        },
        required: ["conversation_id"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const conversationId = encodeURIComponent(parseRequiredString(input, "conversation_id"));
        const response = await client.requestSSE("POST", `/api/chat/conversations/${conversationId}/compile`, token, {}, 300_000);
        const buffered = await consumeSSEStream(response, { timeoutMs: 300_000 });
        return asTextResult({
            compiled_content: formatSseOutput(buffered),
            usage: buffered.usage,
        });
    }));
    register("verify_paper", "Verify citations and claims in a compiled paper", {
        type: "object",
        properties: {
            conversation_id: { type: "string", description: "Conversation ID" },
            compiled_content: { type: "string", description: "Compiled paper content to verify" },
        },
        required: ["conversation_id", "compiled_content"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const conversationId = encodeURIComponent(parseRequiredString(input, "conversation_id"));
        const compiledContent = parseRequiredString(input, "compiled_content");
        const response = await client.requestSSE("POST", `/api/chat/conversations/${conversationId}/verify`, token, { compiledContent }, 300_000);
        const buffered = await consumeSSEStream(response, { timeoutMs: 300_000 });
        return asTextResult({
            verification_report: formatSseOutput(buffered),
            usage: buffered.usage,
        });
    }));
    register("save_source", "Save a document the user pasted or shared as a ScholarMark source. Pass the full text exactly as given. Optionally attach it to a project and include your own summary, key concepts, and citation in the same call.", {
        type: "object",
        properties: {
            text: { type: "string", description: "Full source text, verbatim" },
            title: { type: "string", description: "Source title" },
            project_id: { type: "string", description: "Optional project ID to attach the source to" },
            source_role: {
                type: "string",
                enum: ["evidence", "background", "style_reference"],
                description: "Optional role in the project",
            },
            role_in_project: { type: "string", description: "Optional note on how the user wants to use this source" },
            summary: { type: "string", description: "Optional summary you wrote" },
            main_arguments: { type: "array", items: { type: "string" }, description: "Optional main arguments you identified" },
            key_concepts: { type: "array", items: { type: "string" }, description: "Optional key concepts you identified" },
            citation: { type: "object", description: "Optional citation metadata; same shape as save_citation.citation (requires project_id)" },
        },
        required: ["text"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const text = parseRequiredString(input, "text");
        const citation = parseOptionalCitation(input);
        const projectId = parseOptionalString(input, "project_id");
        if (citation && !projectId) {
            throw new Error("citation requires project_id, because citations are stored per project");
        }
        const formData = new FormData();
        const title = parseOptionalString(input, "title");
        if (title) {
            formData.append("title", title);
        }
        formData.append("text", text);
        const document = await client.requestFormData("POST", "/api/upload-text", token, formData);
        const documentId = typeof document?.id === "string" ? document.id : "";
        if (!documentId) {
            throw new Error("Text upload did not return a document ID.");
        }
        const summaryPayload = buildSummaryPayload(input);
        const summary = summaryPayload
            ? await client.requestJson("PUT", `/api/documents/${encodeURIComponent(documentId)}/summary`, token, summaryPayload)
            : null;
        let projectDocument = projectId ? await addDocumentToProject(client, token, input, documentId) : null;
        if (projectDocument && citation) {
            projectDocument = await client.requestJson("PUT", `/api/project-documents/${encodeURIComponent(projectDocument.id)}/citation`, token, citation);
        }
        return asTextResult({
            documentId,
            projectDocumentId: projectDocument?.id ?? null,
            title: document.filename,
            characters: typeof document.fullText === "string" ? document.fullText.length : text.length,
            summary,
            next: projectDocument
                ? "Ask the user what they are looking for in this source, then read it with read_source_text and save findings with save_annotations."
                : "Attach it to a project with add_source_to_project before saving annotations or a citation.",
        });
    }));
    register("read_source_text", "Read a stored source's text in pages. Character offsets are absolute positions in the source, so you can read long documents in several calls.", {
        type: "object",
        properties: {
            project_document_id: { type: "string", description: "Project document ID from get_project_sources" },
            document_id: { type: "string", description: "Underlying document ID if the source is not in a project" },
            offset: { type: "integer", description: "Character offset to start from (default 0)" },
            max_chars: { type: "integer", description: "Characters to return (default 20000, max 60000)" },
        },
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const { projectDocumentId, documentId } = await resolveSourceIds(client, token, input);
        const document = await client.requestJson("GET", `/api/documents/${encodeURIComponent(documentId)}`, token);
        const fullText = typeof document?.fullText === "string" ? document.fullText : "";
        const offset = parseBoundedInteger(input, "offset", 0, 0, fullText.length);
        const maxChars = parseBoundedInteger(input, "max_chars", 20_000, 1, 60_000);
        const endOffset = Math.min(fullText.length, offset + maxChars);
        return asTextResult({
            projectDocumentId: projectDocumentId ?? null,
            documentId,
            title: document?.filename ?? null,
            status: document?.status ?? null,
            totalCharacters: fullText.length,
            offset,
            endOffset,
            nextOffset: endOffset < fullText.length ? endOffset : null,
            text: fullText.slice(offset, endOffset),
        });
    }));
    register("save_source_summary", "Save your summary, main arguments, and key concepts for a source. Replaces the fields you pass.", {
        type: "object",
        properties: {
            project_document_id: { type: "string", description: "Project document ID from get_project_sources" },
            document_id: { type: "string", description: "Underlying document ID if the source is not in a project" },
            summary: { type: "string", description: "Summary of the source" },
            main_arguments: { type: "array", items: { type: "string" }, description: "Main arguments of the source" },
            key_concepts: { type: "array", items: { type: "string" }, description: "Key concepts or terms" },
        },
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const summaryPayload = buildSummaryPayload(input);
        if (!summaryPayload) {
            throw new Error("Pass at least one of summary, main_arguments, or key_concepts");
        }
        const { documentId } = await resolveSourceIds(client, token, input);
        const summary = await client.requestJson("PUT", `/api/documents/${encodeURIComponent(documentId)}/summary`, token, summaryPayload);
        return asTextResult({ documentId, summary });
    }));
    register("save_annotations", "Highlight passages in a project source and attach notes. Give each quote copied exactly from the source text; ScholarMark finds its position, tolerating case, whitespace, and OCR punctuation differences. Quotes that cannot be found are reported back and not saved.", {
        type: "object",
        properties: {
            project_document_id: { type: "string", description: "Project document ID from get_project_sources or save_source" },
            research_goal: { type: "string", description: "Optional: what the user said they are looking for, stored with each annotation" },
            annotations: {
                type: "array",
                description: "Passages to highlight (max 50 per call)",
                items: {
                    type: "object",
                    properties: {
                        quote: { type: "string", description: "Exact passage from the source" },
                        category: {
                            type: "string",
                            enum: ANNOTATION_CATEGORIES,
                            description: "key_quote, argument, evidence, methodology, or user_added",
                        },
                        note: { type: "string", description: "Why this passage matters for the user's goal" },
                        confidence: { type: "number", description: "Optional relevance from 0 to 1" },
                    },
                    required: ["quote", "category", "note"],
                },
            },
        },
        required: ["project_document_id", "annotations"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const projectDocumentId = parseRequiredString(input, "project_document_id");
        const requested = Array.isArray(input.annotations) ? input.annotations : [];
        if (requested.length === 0) {
            throw new Error("annotations must contain at least one passage");
        }
        if (requested.length > 50) {
            throw new Error("Save at most 50 annotations per call");
        }
        const researchGoal = parseOptionalString(input, "research_goal");
        const { documentId, projectDocument } = await resolveSourceIds(client, token, { project_document_id: projectDocumentId });
        const document = await client.requestJson("GET", `/api/documents/${encodeURIComponent(documentId)}`, token);
        const fullText = typeof document?.fullText === "string" ? document.fullText : "";
        const saved = [];
        const notFound = [];
        for (const entry of requested) {
            const quote = typeof entry?.quote === "string" ? entry.quote.trim() : "";
            const category = typeof entry?.category === "string" ? entry.category.trim() : "";
            const note = typeof entry?.note === "string" ? entry.note.trim() : "";
            if (!quote || !note || !ANNOTATION_CATEGORIES.includes(category)) {
                notFound.push({ quote, reason: "quote, note, and a valid category are required" });
                continue;
            }
            const range = findTextRange(fullText, quote);
            if (!range) {
                notFound.push({ quote, reason: "not found in source text" });
                continue;
            }
            const confidence = typeof entry.confidence === "number" && Number.isFinite(entry.confidence)
                ? Math.max(0, Math.min(1, entry.confidence))
                : undefined;
            const annotation = await client.requestJson("POST", `/api/project-documents/${encodeURIComponent(projectDocumentId)}/annotations`, token, {
                startPosition: range.startPosition,
                endPosition: range.endPosition,
                highlightedText: fullText.slice(range.startPosition, range.endPosition),
                category,
                note,
                isAiGenerated: true,
                ...(confidence !== undefined ? { confidenceScore: confidence } : {}),
                ...(researchGoal ? { promptText: researchGoal } : {}),
            });
            saved.push({
                id: annotation?.id ?? null,
                category,
                matchType: range.matchType,
                startPosition: range.startPosition,
                endPosition: range.endPosition,
            });
        }
        return asTextResult({
            projectDocumentId,
            savedCount: saved.length,
            saved,
            notFound,
            viewInApp: `${appBaseUrl}/projects/${projectDocument.projectId}/documents/${projectDocumentId}`,
        });
    }));
    register("update_annotation", "Change the note or category of a saved project annotation", {
        type: "object",
        properties: {
            annotation_id: { type: "string", description: "Annotation ID from get_source_annotations or save_annotations" },
            note: { type: "string", description: "New note" },
            category: { type: "string", enum: ANNOTATION_CATEGORIES, description: "New category" },
        },
        required: ["annotation_id"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const annotationId = parseRequiredString(input, "annotation_id");
        const note = parseOptionalString(input, "note");
        const category = parseOptionalString(input, "category");
        if (!note && !category) {
            throw new Error("Pass note, category, or both");
        }
        if (category && !ANNOTATION_CATEGORIES.includes(category)) {
            throw new Error(`category must be one of: ${ANNOTATION_CATEGORIES.join(", ")}`);
        }
        const annotation = await client.requestJson("PUT", `/api/project-annotations/${encodeURIComponent(annotationId)}`, token, {
            ...(note ? { note } : {}),
            ...(category ? { category } : {}),
        });
        return asTextResult(annotation);
    }));
    register("delete_annotation", "Delete a saved project annotation. Confirm with the user first.", {
        type: "object",
        properties: {
            annotation_id: { type: "string", description: "Annotation ID to delete" },
        },
        required: ["annotation_id"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const annotationId = parseRequiredString(input, "annotation_id");
        const response = await client.request("DELETE", `/api/project-annotations/${encodeURIComponent(annotationId)}`, token);
        if (!response.ok) {
            throw new BackendHttpError(response.status, await response.text().catch(() => null));
        }
        return asTextResult({ deleted: true, annotationId });
    }));
    register("save_citation", "Save citation metadata for a project source so ScholarMark can format footnotes and bibliography entries. Fill in what the source shows; leave unknown fields out.", {
        type: "object",
        properties: {
            project_document_id: { type: "string", description: "Project document ID" },
            citation: {
                type: "object",
                description: "Citation metadata",
                properties: {
                    sourceType: {
                        type: "string",
                        enum: ["book", "journal", "website", "newspaper", "chapter", "thesis", "other"],
                    },
                    authors: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                firstName: { type: "string" },
                                lastName: { type: "string" },
                            },
                            required: ["firstName", "lastName"],
                        },
                    },
                    title: { type: "string" },
                    containerTitle: { type: "string", description: "Journal, website, or book containing the work" },
                    publisher: { type: "string" },
                    publicationPlace: { type: "string" },
                    publicationDate: { type: "string" },
                    volume: { type: "string" },
                    issue: { type: "string" },
                    pageStart: { type: "string" },
                    pageEnd: { type: "string" },
                    url: { type: "string" },
                    accessDate: { type: "string" },
                    doi: { type: "string" },
                    edition: { type: "string" },
                },
                required: ["sourceType", "authors", "title"],
            },
        },
        required: ["project_document_id", "citation"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const projectDocumentId = parseRequiredString(input, "project_document_id");
        const citation = parseOptionalCitation(input);
        if (!citation) {
            throw new Error("citation is required");
        }
        const projectDocument = await client.requestJson("PUT", `/api/project-documents/${encodeURIComponent(projectDocumentId)}/citation`, token, citation);
        return asTextResult({ projectDocumentId, citationData: projectDocument?.citationData ?? citation });
    }));
    register("search", "Search everything saved in ScholarMark: sources, summaries, and annotations across all of the user's projects. Returns result IDs to open with fetch.", {
        type: "object",
        properties: {
            query: { type: "string", description: "Keywords to search for" },
        },
        required: ["query"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const query = parseRequiredString(input, "query");
        const projects = await client.requestJson("GET", "/api/projects", token);
        const projectRows = Array.isArray(projects) ? projects.slice(0, 25) : [];
        const results = [];
        const seen = new Set();
        for (const project of projectRows) {
            if (typeof project?.id !== "string") {
                continue;
            }
            const response = await client.requestJson("POST", `/api/projects/${encodeURIComponent(project.id)}/search`, token, { query, limit: 10 });
            for (const hit of Array.isArray(response?.results) ? response.results : []) {
                if (typeof hit?.documentId !== "string") {
                    continue;
                }
                const id = hit.type === "annotation" && typeof hit.annotationId === "string"
                    ? `annotation:${hit.documentId}:${hit.annotationId}`
                    : `source:${hit.documentId}`;
                if (seen.has(id)) {
                    continue;
                }
                seen.add(id);
                results.push({
                    id,
                    title: `${hit.documentFilename ?? "Source"}${hit.type === "annotation" ? " (annotation)" : ""} - ${project.name ?? "Project"}`,
                    url: `${appBaseUrl}/projects/${project.id}/documents/${hit.documentId}`,
                    text: truncateText(hit.highlightedText ?? hit.matchedText ?? "", 300),
                    score: hit.similarityScore ?? null,
                });
            }
        }
        const library = await client.requestJson("GET", "/api/documents/meta", token);
        const needle = query.toLowerCase();
        for (const source of Array.isArray(library) ? library : []) {
            const haystack = `${source?.filename ?? ""}\n${source?.summary ?? ""}`.toLowerCase();
            if (typeof source?.id !== "string" || !haystack.includes(needle)) {
                continue;
            }
            results.push({
                id: `document:${source.id}`,
                title: source.filename ?? "Source",
                url: `${appBaseUrl}/`,
                text: truncateText(source.summary ?? "", 300),
                score: null,
            });
        }
        results.sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
        return asRetrievalResult({ results: results.slice(0, 30) });
    }));
    register("fetch", "Open a search result by ID and return its full text and metadata", {
        type: "object",
        properties: {
            id: { type: "string", description: "Result ID from search" },
        },
        required: ["id"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const id = parseRequiredString(input, "id");
        const [kind, first, second] = id.split(":");
        if (kind === "annotation" && first && second) {
            const projectDocument = await client.requestJson("GET", `/api/project-documents/${encodeURIComponent(first)}`, token);
            const annotations = await client.requestJson("GET", `/api/project-documents/${encodeURIComponent(first)}/annotations`, token);
            const annotation = (Array.isArray(annotations) ? annotations : []).find((row) => row?.id === second);
            if (!annotation) {
                throw new Error("Annotation not found");
            }
            const document = await client.requestJson("GET", `/api/documents/${encodeURIComponent(projectDocument.documentId)}`, token);
            const fullText = typeof document?.fullText === "string" ? document.fullText : "";
            const contextStart = Math.max(0, annotation.startPosition - 600);
            const contextEnd = Math.min(fullText.length, annotation.endPosition + 600);
            return asRetrievalResult({
                id,
                title: `${document?.filename ?? "Source"} (annotation)`,
                url: `${appBaseUrl}/projects/${projectDocument.projectId}/documents/${first}?annotationId=${encodeURIComponent(second)}`,
                text: `${annotation.highlightedText}\n\nNote: ${annotation.note ?? ""}\n\nContext:\n${fullText.slice(contextStart, contextEnd)}`,
                metadata: {
                    category: annotation.category,
                    projectDocumentId: first,
                    documentId: projectDocument.documentId,
                    citation: projectDocument.citationData ?? null,
                },
            });
        }
        if ((kind === "source" || kind === "document") && first) {
            const projectDocument = kind === "source"
                ? await client.requestJson("GET", `/api/project-documents/${encodeURIComponent(first)}`, token)
                : null;
            const documentId = projectDocument ? projectDocument.documentId : first;
            const document = await client.requestJson("GET", `/api/documents/${encodeURIComponent(documentId)}`, token);
            const fullText = typeof document?.fullText === "string" ? document.fullText : "";
            return asRetrievalResult({
                id,
                title: document?.filename ?? "Source",
                url: projectDocument
                    ? `${appBaseUrl}/projects/${projectDocument.projectId}/documents/${first}`
                    : `${appBaseUrl}/`,
                text: truncateText(fullText, 100_000),
                metadata: {
                    documentId,
                    projectDocumentId: projectDocument?.id ?? null,
                    summary: document?.summary ?? null,
                    keyConcepts: document?.keyConcepts ?? null,
                    citation: projectDocument?.citationData ?? null,
                    totalCharacters: fullText.length,
                },
            });
        }
        throw new Error("Unknown result ID. Use an ID returned by search.");
    }));
}
