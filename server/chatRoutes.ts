import type { Express, Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { chatStorage } from "./chatStorage";
import { projectStorage } from "./projectStorage";
import { storage } from "./storage";
import { requireAuth } from "./auth";
import { formatSourceForPrompt, type WritingSource } from "./writingPipeline";
import { clipText, buildAuthorLabel, savePaperToProject } from "./writingRoutes";
import type { CitationData } from "@shared/schema";

const MAX_SOURCE_EXCERPT_CHARS = 700;
const MAX_SOURCE_FULLTEXT_CHARS = 7000;

const BASE_SYSTEM_PROMPT =
  "You are ScholarMark AI, a helpful academic writing assistant. You help students with research, writing, citations, and understanding academic sources. Be concise, accurate, and helpful.";

function getAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

async function loadProjectSources(
  projectId: string,
  selectedSourceIds?: string[] | null
): Promise<WritingSource[]> {
  const projectDocs = await projectStorage.getProjectDocumentsByProject(projectId);

  const filteredDocs = selectedSourceIds && selectedSourceIds.length > 0
    ? projectDocs.filter((pd) => selectedSourceIds.includes(pd.id))
    : projectDocs;

  const sources: WritingSource[] = [];

  for (const projectDoc of filteredDocs) {
    const fullDoc = await storage.getDocument(projectDoc.documentId);
    if (!fullDoc) continue;

    const citationData = (projectDoc.citationData as CitationData | null) || null;
    const summaryExcerpt =
      clipText(projectDoc.document.summary, MAX_SOURCE_EXCERPT_CHARS) ||
      clipText(fullDoc.fullText, MAX_SOURCE_EXCERPT_CHARS);

    sources.push({
      id: projectDoc.id,
      kind: "project_document",
      title: citationData?.title || projectDoc.document.filename,
      author: buildAuthorLabel(citationData),
      excerpt: summaryExcerpt || "No summary available.",
      fullText:
        clipText(fullDoc.fullText, MAX_SOURCE_FULLTEXT_CHARS) ||
        summaryExcerpt ||
        "No source text available.",
      category: "project_source",
      note: projectDoc.roleInProject || null,
      citationData,
      documentFilename: projectDoc.document.filename,
    });
  }

  return sources;
}

function buildWritingSystemPrompt(
  sources: WritingSource[],
  citationStyle?: string,
  tone?: string
): string {
  if (sources.length === 0) {
    return BASE_SYSTEM_PROMPT;
  }

  const sourceBlock = sources
    .map((source, i) => `--- Source ${i + 1} ---\n${formatSourceForPrompt(source)}`)
    .join("\n\n");

  const styleNote = citationStyle
    ? `Use ${citationStyle.toUpperCase()} format for in-text citations when referencing sources.`
    : "Use appropriate citation format when referencing sources.";

  const toneNote = tone
    ? `Match the following tone: ${tone}.`
    : "";

  return `You are ScholarMark AI, an academic writing assistant. You are helping a student write a paper using their project sources.

You have access to the following source materials. When the student asks you to write content, use these sources and include proper in-text citations.

${sourceBlock}

Instructions:
- ${styleNote}
- ${toneNote}
- When writing paper sections, use markdown formatting.
- Be conversational in your responses but produce polished academic prose when asked to write paper content.
- Do not fabricate quotations, page numbers, publication details, or source information.
- If uncertain about a source detail, cite conservatively and state uncertainty plainly.
- You can discuss, explain, and help refine content iteratively.`;
}

export function registerChatRoutes(app: Express) {
  // List all conversations (newest first)
  app.get("/api/chat/conversations", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = req.query.projectId as string | undefined;
      const convos = await chatStorage.getConversationsForUser(req.user!.userId, projectId);
      res.json(convos);
    } catch (error) {
      console.error("Error listing conversations:", error);
      res.status(500).json({ message: "Failed to list conversations" });
    }
  });

  // Create new conversation
  app.post("/api/chat/conversations", requireAuth, async (req: Request, res: Response) => {
    try {
      const { title, model, projectId, selectedSourceIds } = req.body || {};
      const conv = await chatStorage.createConversation({
        title: title || "New Chat",
        model: model || "claude-haiku-4-5",
        userId: req.user!.userId,
        projectId: projectId || null,
        selectedSourceIds: selectedSourceIds || null,
      });
      res.json(conv);
    } catch (error) {
      console.error("Error creating conversation:", error);
      res.status(500).json({ message: "Failed to create conversation" });
    }
  });

  // Get conversation with messages
  app.get("/api/chat/conversations/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const conv = await chatStorage.getConversation(req.params.id);
      if (!conv) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      if (conv.userId && conv.userId !== req.user!.userId) {
        return res.status(403).json({ message: "Access denied" });
      }
      const msgs = await chatStorage.getMessagesForConversation(conv.id);
      res.json({ ...conv, messages: msgs });
    } catch (error) {
      console.error("Error fetching conversation:", error);
      res.status(500).json({ message: "Failed to fetch conversation" });
    }
  });

  // Delete conversation
  app.delete("/api/chat/conversations/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const conv = await chatStorage.getConversation(req.params.id);
      if (!conv) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      if (conv.userId && conv.userId !== req.user!.userId) {
        return res.status(403).json({ message: "Access denied" });
      }
      await chatStorage.deleteConversation(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting conversation:", error);
      res.status(500).json({ message: "Failed to delete conversation" });
    }
  });

  // Update conversation (title, model, settings)
  app.put("/api/chat/conversations/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { title, model, citationStyle, tone, noEnDashes } = req.body;
      const updates: Record<string, any> = {};
      if (title !== undefined) updates.title = title;
      if (model !== undefined) updates.model = model;
      if (citationStyle !== undefined) updates.citationStyle = citationStyle;
      if (tone !== undefined) updates.tone = tone;
      if (noEnDashes !== undefined) updates.noEnDashes = noEnDashes;

      const conv = await chatStorage.updateConversation(req.params.id, updates);
      res.json(conv);
    } catch (error) {
      console.error("Error updating conversation:", error);
      res.status(500).json({ message: "Failed to update conversation" });
    }
  });

  // Update selected sources for a conversation
  app.put("/api/chat/conversations/:id/sources", requireAuth, async (req: Request, res: Response) => {
    try {
      const { selectedSourceIds } = req.body;
      if (!Array.isArray(selectedSourceIds)) {
        return res.status(400).json({ message: "selectedSourceIds must be an array" });
      }
      const conv = await chatStorage.updateSelectedSources(req.params.id, selectedSourceIds);
      res.json(conv);
    } catch (error) {
      console.error("Error updating sources:", error);
      res.status(500).json({ message: "Failed to update sources" });
    }
  });

  // Send message + get streaming response
  app.post("/api/chat/conversations/:id/messages", requireAuth, async (req: Request, res: Response) => {
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

      // Build messages array for Anthropic (filter out system messages)
      const anthropicMessages = history
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      // Build system prompt -- inject sources if this is a project conversation
      let systemPrompt = BASE_SYSTEM_PROMPT;
      if (conv.projectId) {
        const sources = await loadProjectSources(conv.projectId, conv.selectedSourceIds);
        systemPrompt = buildWritingSystemPrompt(
          sources,
          conv.citationStyle || undefined,
          conv.tone || undefined
        );
      }

      // Set up SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      const anthropic = getAnthropicClient();

      const stream = anthropic.messages.stream({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        system: systemPrompt,
        messages: anthropicMessages,
      });

      let fullText = "";

      stream.on("text", (text) => {
        fullText += text;
        res.write(`data: ${JSON.stringify({ type: "text", text })}\n\n`);
      });

      stream.on("message", async (message) => {
        try {
          const usage = message.usage;

          // Save complete assistant message to DB
          await chatStorage.createMessage({
            conversationId: conv.id,
            role: "assistant",
            content: fullText,
            tokensUsed: (usage?.input_tokens || 0) + (usage?.output_tokens || 0),
          });

          // Auto-generate conversation title from first user message
          const isFirstExchange = history.filter((m) => m.role === "user").length === 1;
          if (isFirstExchange && conv.title === "New Chat") {
            const firstUserMessage = content;
            const autoTitle =
              firstUserMessage.length <= 50
                ? firstUserMessage
                : firstUserMessage.slice(0, 47) + "...";
            await chatStorage.updateConversation(conv.id, { title: autoTitle });
          }

          res.write(`data: ${JSON.stringify({ type: "done", usage })}\n\n`);
          res.end();
        } catch (err) {
          console.error("Error saving assistant message:", err);
          res.write(`data: ${JSON.stringify({ type: "error", error: "Failed to save response" })}\n\n`);
          res.end();
        }
      });

      stream.on("error", (error) => {
        console.error("Anthropic stream error:", error);
        res.write(
          `data: ${JSON.stringify({ type: "error", error: error instanceof Error ? error.message : "Stream failed" })}\n\n`
        );
        res.end();
      });

      // Handle client disconnect
      req.on("close", () => {
        stream.abort();
      });
    } catch (error) {
      console.error("Error sending message:", error);
      // If headers haven't been sent yet, send a JSON error
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to send message" });
      } else {
        res.write(`data: ${JSON.stringify({ type: "error", error: "Internal server error" })}\n\n`);
        res.end();
      }
    }
  });

  // Compile paper from conversation
  app.post("/api/chat/conversations/:id/compile", requireAuth, async (req: Request, res: Response) => {
    try {
      const conv = await chatStorage.getConversation(req.params.id);
      if (!conv) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      if (conv.userId && conv.userId !== req.user!.userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { citationStyle, tone, noEnDashes } = req.body;
      const style = citationStyle || conv.citationStyle || "chicago";
      const writingTone = tone || conv.tone || "academic";
      const avoidDashes = noEnDashes ?? conv.noEnDashes ?? false;

      // Load conversation history
      const history = await chatStorage.getMessagesForConversation(conv.id);
      if (history.length === 0) {
        return res.status(400).json({ message: "No conversation to compile" });
      }

      // Build the conversation transcript
      const transcript = history
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => `[${m.role.toUpperCase()}]: ${m.content}`)
        .join("\n\n---\n\n");

      // Load sources for bibliography
      let sourcesBlock = "";
      if (conv.projectId) {
        const sources = await loadProjectSources(conv.projectId, conv.selectedSourceIds);
        if (sources.length > 0) {
          sourcesBlock = `\n\nAvailable source materials for citations and bibliography:\n${sources
            .map((s, i) => `--- Source ${i + 1} ---\n${formatSourceForPrompt(s)}`)
            .join("\n\n")}`;
        }
      }

      const noEnDashesLine = avoidDashes
        ? "\n- NEVER use em-dashes or en-dashes. Use commas, periods, or semicolons instead."
        : "";

      const compilePrompt = `You are an academic editor. Read the following conversation between a student and an AI writing assistant. The conversation contains paper content that the student has been developing iteratively.

Your job is to extract ALL paper content from the conversation and assemble it into a single, complete, polished academic paper.

Requirements:
1. Extract all paper sections, paragraphs, and arguments from the assistant's responses
2. Add smooth transitions between sections
3. Write a compelling introduction if one isn't already present
4. Write a conclusion that ties the argument together
5. Ensure consistent voice and tone (${writingTone}) throughout
6. Include proper in-text citations in ${style.toUpperCase()} format
7. Append a complete bibliography/works cited section in ${style.toUpperCase()} format${noEnDashesLine}
8. Do NOT include conversational back-and-forth -- only the polished paper content
9. Do not fabricate source details not supported by the source material
10. Output the complete paper in markdown format

CONVERSATION:
${transcript}${sourcesBlock}`;

      // Set up SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      const anthropic = getAnthropicClient();
      let compiledText = "";
      let aborted = false;

      req.on("close", () => {
        aborted = true;
      });

      const stream = anthropic.messages.stream({
        model: "claude-sonnet-4-5-20241022",
        max_tokens: 8192,
        messages: [{ role: "user", content: compilePrompt }],
      });

      stream.on("text", (text) => {
        compiledText += text;
        if (!aborted) {
          res.write(`data: ${JSON.stringify({ type: "text", text })}\n\n`);
        }
      });

      stream.on("message", async () => {
        if (aborted) return;

        // Save compiled paper to project if applicable
        let savedPaper = null;
        if (conv.projectId && compiledText.trim()) {
          try {
            savedPaper = await savePaperToProject(
              conv.projectId,
              conv.title || "Compiled Paper",
              compiledText
            );
          } catch (saveError) {
            console.error("Error saving compiled paper:", saveError);
          }
        }

        res.write(`data: ${JSON.stringify({ type: "done", savedPaper })}\n\n`);
        res.end();
      });

      stream.on("error", (error) => {
        console.error("Compile stream error:", error);
        if (!aborted) {
          res.write(`data: ${JSON.stringify({ type: "error", error: error instanceof Error ? error.message : "Compile failed" })}\n\n`);
          res.end();
        }
      });
    } catch (error) {
      console.error("Compile error:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to compile paper" });
      } else {
        res.write(`data: ${JSON.stringify({ type: "error", error: "Compile failed" })}\n\n`);
        res.end();
      }
    }
  });

  // Verify compiled paper
  app.post("/api/chat/conversations/:id/verify", requireAuth, async (req: Request, res: Response) => {
    try {
      const conv = await chatStorage.getConversation(req.params.id);
      if (!conv) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      if (conv.userId && conv.userId !== req.user!.userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { compiledContent } = req.body;
      if (!compiledContent || typeof compiledContent !== "string") {
        return res.status(400).json({ message: "compiledContent is required" });
      }

      const style = conv.citationStyle || "chicago";

      // Load sources for verification
      let sourcesBlock = "";
      if (conv.projectId) {
        const sources = await loadProjectSources(conv.projectId, conv.selectedSourceIds);
        if (sources.length > 0) {
          sourcesBlock = `\n\nOriginal source materials used:\n${sources
            .map((s, i) => `--- Source ${i + 1} ---\nTitle: ${s.title}\nAuthor: ${s.author}\nExcerpt: "${s.excerpt}"`)
            .join("\n\n")}`;
        }
      }

      const verifyPrompt = `You are an academic paper reviewer. Review the following paper for quality and accuracy.

Check for:
1. **Citation accuracy**: Are in-text citations properly formatted in ${style.toUpperCase()} style? Are bibliography entries complete and correctly formatted?
2. **Source fidelity**: Does the paper accurately represent the source materials? Are any claims unsupported?
3. **Logical coherence**: Does the argument flow logically? Are transitions smooth?
4. **Grammar and style**: Is the writing clear, consistent in tone, and free of errors?
5. **Completeness**: Does the paper have an introduction, body sections, conclusion, and bibliography?

For each issue found, provide:
- The specific location or passage
- What the issue is
- A suggested fix

If the paper is well-written, note its strengths.

PAPER TO REVIEW:
${compiledContent}${sourcesBlock}`;

      // Set up SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      const anthropic = getAnthropicClient();
      let aborted = false;

      req.on("close", () => {
        aborted = true;
      });

      const stream = anthropic.messages.stream({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        messages: [{ role: "user", content: verifyPrompt }],
      });

      stream.on("text", (text) => {
        if (!aborted) {
          res.write(`data: ${JSON.stringify({ type: "text", text })}\n\n`);
        }
      });

      stream.on("message", () => {
        if (!aborted) {
          res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
          res.end();
        }
      });

      stream.on("error", (error) => {
        console.error("Verify stream error:", error);
        if (!aborted) {
          res.write(`data: ${JSON.stringify({ type: "error", error: error instanceof Error ? error.message : "Verify failed" })}\n\n`);
          res.end();
        }
      });
    } catch (error) {
      console.error("Verify error:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to verify paper" });
      } else {
        res.write(`data: ${JSON.stringify({ type: "error", error: "Verify failed" })}\n\n`);
        res.end();
      }
    }
  });
}
