import type { Express, Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { chatStorage } from "./chatStorage";
import { projectStorage } from "./projectStorage";
import { WRITING_TOOLS, TOOL_STATUS_LABELS } from "./toolDefinitions";
import { executeToolCall } from "./toolExecutor";

const MAX_TOOL_ITERATIONS = 5;

const BASE_SYSTEM_PROMPT =
  "You are ScholarMark AI, a helpful academic writing assistant. You help students with research, writing, citations, and understanding academic sources. Be concise, accurate, and helpful.";

function buildWritingSystemPrompt(
  projectName?: string,
  thesis?: string,
  sourceList?: string
): string {
  if (!projectName) return BASE_SYSTEM_PROMPT;

  return `You are ScholarMark AI, an academic writing assistant helping a student with their research project.

PROJECT: ${projectName}
${thesis ? `THESIS: ${thesis}` : ""}

${sourceList ? `LOADED SOURCES:\n${sourceList}\n` : ""}

TOOL GUIDANCE:
You have access to tools for researching and writing. Use them proactively:

- Use "search_sources" to find relevant evidence from the student's uploaded documents before making claims or writing content.
- Use "request_annotation_context" when you need to see surrounding text for a specific passage.
- Use "deep_source_analysis" when you need comprehensive understanding of a single source.
- Use "propose_outline" to create a structured plan before writing a full paper.
- Use "write_section" to produce polished section drafts that appear as document cards the student can review.
- Use "compile_paper" to stitch approved sections into a final paper.
- Use "verify_citations" to check citation accuracy after writing.

CONVERSATION FLOW:
1. DISCOVER: Ask clarifying questions about the assignment, audience, and goals.
2. RESEARCH: Use search_sources and deep_source_analysis to gather evidence.
3. PLAN: Use propose_outline to create structure. Wait for approval.
4. WRITE: Use write_section for each section. Each produces a reviewable document card.
5. COMPILE: Use compile_paper to create the final paper.
6. VERIFY: Use verify_citations to check all references.

You can skip phases when the student says "just write it" or gives specific instructions.
For simple edits and revisions, respond directly without re-running tools.

QUOTING RULES:
- Always cite sources when referencing them
- Use (Author, Year) in-text citations
- Quote directly when the exact wording matters
- Paraphrase with citation for general ideas`;
}

function getAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function emitSSE(res: Response, data: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function registerChatRoutes(app: Express) {
  // List all conversations (newest first)
  app.get("/api/chat/conversations", async (_req: Request, res: Response) => {
    try {
      const convos = await chatStorage.getConversationsForUser();
      res.json(convos);
    } catch (error) {
      console.error("Error listing conversations:", error);
      res.status(500).json({ message: "Failed to list conversations" });
    }
  });

  // Create new conversation
  app.post("/api/chat/conversations", async (req: Request, res: Response) => {
    try {
      const { title, model, projectId } = req.body || {};
      const conv = await chatStorage.createConversation({
        title: title || "New Chat",
        model: model || "claude-haiku-4-5",
        userId: null,
        projectId: projectId || null,
      });
      res.json(conv);
    } catch (error) {
      console.error("Error creating conversation:", error);
      res.status(500).json({ message: "Failed to create conversation" });
    }
  });

  // Get conversation with messages
  app.get("/api/chat/conversations/:id", async (req: Request, res: Response) => {
    try {
      const conv = await chatStorage.getConversation(req.params.id);
      if (!conv) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      const msgs = await chatStorage.getMessagesForConversation(conv.id);
      res.json({ ...conv, messages: msgs });
    } catch (error) {
      console.error("Error fetching conversation:", error);
      res.status(500).json({ message: "Failed to fetch conversation" });
    }
  });

  // Delete conversation
  app.delete("/api/chat/conversations/:id", async (req: Request, res: Response) => {
    try {
      await chatStorage.deleteConversation(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting conversation:", error);
      res.status(500).json({ message: "Failed to delete conversation" });
    }
  });

  // Update conversation (title, model)
  app.put("/api/chat/conversations/:id", async (req: Request, res: Response) => {
    try {
      const { title, model } = req.body;
      const updates: Record<string, string> = {};
      if (title !== undefined) updates.title = title;
      if (model !== undefined) updates.model = model;

      const conv = await chatStorage.updateConversation(req.params.id, updates);
      res.json(conv);
    } catch (error) {
      console.error("Error updating conversation:", error);
      res.status(500).json({ message: "Failed to update conversation" });
    }
  });

  // Send message + get streaming response with tool-use loop
  app.post("/api/chat/conversations/:id/messages", async (req: Request, res: Response) => {
    try {
      const { content } = req.body;
      if (!content || typeof content !== "string") {
        return res.status(400).json({ message: "Content is required" });
      }

      const conv = await chatStorage.getConversation(req.params.id);
      if (!conv) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      // Save user message
      await chatStorage.createMessage({
        conversationId: conv.id,
        role: "user",
        content,
      });

      // Load full conversation history
      const history = await chatStorage.getMessagesForConversation(conv.id);

      // Build system prompt based on project context
      let systemPrompt = BASE_SYSTEM_PROMPT;
      const hasProject = !!conv.projectId;

      if (hasProject && conv.projectId) {
        const project = await projectStorage.getProject(conv.projectId);
        if (project) {
          const projectDocs = await projectStorage.getProjectDocumentsByProject(project.id);
          const sourceList = projectDocs
            .map((pd) => `- ${pd.document.filename}${pd.document.summary ? ` — ${pd.document.summary.slice(0, 100)}` : ""}`)
            .join("\n");
          systemPrompt = buildWritingSystemPrompt(project.name, project.thesis || undefined, sourceList || undefined);
        }
      }

      // Build messages array for Anthropic
      const anthropicMessages: Anthropic.MessageParam[] = history
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      // Set up SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      const anthropic = getAnthropicClient();
      let clientDisconnected = false;

      req.on("close", () => {
        clientDisconnected = true;
      });

      // Run the tool-use loop
      const tools = hasProject ? WRITING_TOOLS : undefined;
      let totalTokens = 0;
      let fullAssistantText = "";

      try {
        await runToolUseLoop({
          anthropic,
          model: "claude-haiku-4-5-20251001",
          maxTokens: 4096,
          systemPrompt,
          messages: anthropicMessages,
          tools,
          res,
          projectId: hasProject ? conv.projectId : null,
          conversationHistory: history.map((m) => ({ role: m.role, content: m.content })),
          isDisconnected: () => clientDisconnected,
          onText: (text) => {
            fullAssistantText += text;
          },
          onTokens: (tokens) => {
            totalTokens += tokens;
          },
        });
      } catch (loopError) {
        console.error("Tool-use loop error:", loopError);
        if (!clientDisconnected) {
          emitSSE(res, {
            type: "error",
            error: loopError instanceof Error ? loopError.message : "Stream failed",
          });
        }
      }

      // Save the complete assistant message
      if (fullAssistantText && !clientDisconnected) {
        try {
          await chatStorage.createMessage({
            conversationId: conv.id,
            role: "assistant",
            content: fullAssistantText,
            tokensUsed: totalTokens,
          });

          // Auto-generate title from first user message
          const isFirstExchange = history.filter((m) => m.role === "user").length === 1;
          if (isFirstExchange && conv.title === "New Chat") {
            const autoTitle =
              content.length <= 50 ? content : content.slice(0, 47) + "...";
            await chatStorage.updateConversation(conv.id, { title: autoTitle });
          }
        } catch (err) {
          console.error("Error saving assistant message:", err);
        }
      }

      if (!clientDisconnected) {
        emitSSE(res, { type: "done", usage: { total_tokens: totalTokens } });
        res.end();
      }
    } catch (error) {
      console.error("Error sending message:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to send message" });
      } else {
        emitSSE(res, { type: "error", error: "Internal server error" });
        res.end();
      }
    }
  });
}

interface ToolUseLoopOptions {
  anthropic: Anthropic;
  model: string;
  maxTokens: number;
  systemPrompt: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  res: Response;
  projectId: string | null;
  conversationHistory: Array<{ role: string; content: string }>;
  isDisconnected: () => boolean;
  onText: (text: string) => void;
  onTokens: (tokens: number) => void;
}

async function runToolUseLoop(opts: ToolUseLoopOptions): Promise<void> {
  const {
    anthropic,
    model,
    maxTokens,
    systemPrompt,
    messages,
    tools,
    res,
    projectId,
    conversationHistory,
    isDisconnected,
    onText,
    onTokens,
  } = opts;

  // Working copy of messages that we mutate during the loop
  const loopMessages = [...messages];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    if (isDisconnected()) return;

    // Create the streaming request
    const requestParams: Anthropic.MessageCreateParams = {
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: loopMessages,
      ...(tools && tools.length > 0 ? { tools } : {}),
    };

    const stream = anthropic.messages.stream(requestParams);

    // Collect this iteration's response
    let iterationText = "";
    const toolUseBlocks: Array<{
      id: string;
      name: string;
      input: Record<string, unknown>;
    }> = [];

    // Stream text events to client
    stream.on("text", (text) => {
      if (isDisconnected()) return;
      iterationText += text;
      onText(text);
      emitSSE(res, { type: "text", text });
    });

    // Wait for the full message
    const message = await stream.finalMessage();

    // Track token usage
    if (message.usage) {
      onTokens(
        (message.usage.input_tokens || 0) + (message.usage.output_tokens || 0)
      );
    }

    // Collect tool_use blocks from the response
    for (const block of message.content) {
      if (block.type === "tool_use") {
        toolUseBlocks.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    // If no tool calls, we're done
    if (message.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
      return;
    }

    // Execute each tool call and build tool_result messages
    const assistantContent: Anthropic.ContentBlockParam[] = [];

    // Add the text block if there was text before tool calls
    if (iterationText) {
      assistantContent.push({ type: "text", text: iterationText });
    }

    // Add the tool_use blocks
    for (const toolCall of toolUseBlocks) {
      assistantContent.push({
        type: "tool_use",
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.input,
      });
    }

    // Append assistant message with tool_use blocks
    loopMessages.push({ role: "assistant", content: assistantContent });

    // Execute tools and build tool_result messages
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolCall of toolUseBlocks) {
      if (isDisconnected()) return;

      // Emit tool_status running
      const label = TOOL_STATUS_LABELS[toolCall.name] || `Running ${toolCall.name}...`;
      emitSSE(res, {
        type: "tool_status",
        tool: toolCall.name,
        status: "running",
        label,
      });

      try {
        const result = await executeToolCall(toolCall.name, toolCall.input, {
          projectId,
          conversationHistory,
          anthropicClient: anthropic,
        });

        // If this is a document-producing tool, emit document events
        if (result.isDocument) {
          const docTitle = result.documentTitle || "Document";
          emitSSE(res, {
            type: "document_start",
            title: docTitle,
          });
          emitSSE(res, {
            type: "document_text",
            text: result.content,
          });
          emitSSE(res, {
            type: "document_end",
            title: docTitle,
          });

          // Wrap the document content in <document> tags for storage/rendering
          const docTag = `<document title="${docTitle}">${result.content}</document>`;
          onText(docTag);
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: result.content,
        });
      } catch (toolError) {
        console.error(`Tool ${toolCall.name} failed:`, toolError);
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: `Error executing ${toolCall.name}: ${toolError instanceof Error ? toolError.message : "Unknown error"}`,
          is_error: true,
        });
      }

      // Emit tool_status complete
      emitSSE(res, {
        type: "tool_status",
        tool: toolCall.name,
        status: "complete",
      });
    }

    // Append tool results as a user message
    loopMessages.push({ role: "user", content: toolResults });
  }
}
