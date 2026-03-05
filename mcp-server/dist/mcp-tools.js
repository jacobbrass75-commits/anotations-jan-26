import { BackendHttpError, ScholarMarkBackendClient } from "./backend-client.js";
import { consumeSSEStream } from "./sse-buffer.js";
import { z } from "zod";
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
function registerTool(server, name, description, inputSchema, handler) {
    if (typeof server.registerTool === "function") {
        const mcpInputSchema = toZodInputSchema(inputSchema);
        server.registerTool(name, { description, inputSchema: mcpInputSchema }, handler);
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
    else {
        field = z.any();
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
export function registerScholarMarkTools(server, options) {
    const client = new ScholarMarkBackendClient(options.backendBaseUrl);
    registerTool(server, "get_projects", "List your ScholarMark writing projects", {
        type: "object",
        properties: {},
        additionalProperties: false,
    }, async (_input, context) => withToken(context, async (token) => {
        const projects = await client.requestJson("GET", "/api/projects", token);
        return asTextResult(projects);
    }));
    registerTool(server, "get_project_sources", "List sources attached to a specific ScholarMark project", {
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
    registerTool(server, "start_conversation", "Start a new ScholarMark conversation for a project", {
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
    registerTool(server, "send_message", "Send a message to a ScholarMark conversation and return the full buffered answer", {
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
    registerTool(server, "get_conversations", "List conversations for a ScholarMark project", {
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
    registerTool(server, "compile_paper", "Compile a conversation into a finalized paper draft", {
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
    registerTool(server, "verify_paper", "Verify citations and claims in a compiled paper", {
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
}
