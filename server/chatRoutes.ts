import type { Express, Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, inArray } from "drizzle-orm";
import { chatStorage } from "./chatStorage";
import { db } from "./db";
import { projectStorage } from "./projectStorage";
import { storage } from "./storage";
import { requireAuth } from "./auth";
import { formatSourceForPrompt, type WritingSource } from "./writingPipeline";
import { clipText, buildAuthorLabel, savePaperToProject } from "./writingRoutes";
import {
  webClips,
  type CitationData,
  type Conversation,
  type Project,
} from "@shared/schema";

const MAX_SOURCE_EXCERPT_CHARS = 2000;
const MAX_SOURCE_FULLTEXT_CHARS = 30000;
const MAX_SOURCE_TOTAL_FULLTEXT_CHARS = 150000;

const CHAT_MODEL = "claude-opus-4-6";
const COMPILE_MODEL = "claude-opus-4-6";
const VERIFY_MODEL = "claude-opus-4-6";
const CHAT_MAX_TOKENS = 8192;
const COMPILE_MAX_TOKENS = 8192;
const VERIFY_MAX_TOKENS = 8192;

const BASE_SYSTEM_PROMPT =
  "You are ScholarMark AI, a helpful academic writing assistant. You help students with research, writing, citations, and understanding academic sources. Be concise, accurate, and helpful.";

type WritingProjectContext = Pick<Project, "name" | "thesis" | "scope" | "contextSummary">;
type WritingStreamEventType =
  | "chat_text"
  | "document_start"
  | "document_text"
  | "document_end"
  | "done"
  | "error";

function getAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function normalizedPromptValue(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "Not provided.";
}

function prettyToneLabel(tone?: string): string {
  if (!tone) return "academic";
  if (tone === "ap_style") return "AP style";
  return tone;
}

function buildProjectContextBlock(project: WritingProjectContext | null): string {
  if (!project) {
    return "PROJECT CONTEXT:\nProject: Standalone writing mode\nThesis: Not provided.\nScope: Not provided.\nSummary: Not provided.";
  }

  return `PROJECT CONTEXT:
Project: ${normalizedPromptValue(project.name)}
Thesis: ${normalizedPromptValue(project.thesis)}
Scope: ${normalizedPromptValue(project.scope)}
Summary: ${normalizedPromptValue(project.contextSummary)}`;
}

function buildSourceBlock(sources: WritingSource[]): string {
  if (sources.length === 0) {
    return "No explicit source materials are attached to this conversation.";
  }
  return sources
    .map((source, i) => `--- Source ${i + 1} ---\n${formatSourceForPrompt(source)}`)
    .join("\n\n");
}

function normalizeTitle(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "Draft";
}

function matchOpenDocumentTag(tagText: string): string | null {
  const match = tagText.match(/^<document\s+title="([^"]*)"\s*>$/i);
  if (!match) return null;
  return normalizeTitle(match[1] || "");
}

function isCloseDocumentTag(tagText: string): boolean {
  return /^<\/document\s*>$/i.test(tagText);
}

function createDocumentStreamParser(
  emit: (event: { type: WritingStreamEventType; [key: string]: unknown }) => void
) {
  let inDocument = false;
  let tagMode = false;
  let tagBuffer = "";
  let chatBuffer = "";
  let documentBuffer = "";
  let activeDocumentTitle = "";

  const flushChat = () => {
    if (!chatBuffer) return;
    emit({ type: "chat_text", text: chatBuffer });
    chatBuffer = "";
  };

  const flushDocument = () => {
    if (!documentBuffer) return;
    emit({ type: "document_text", text: documentBuffer });
    documentBuffer = "";
  };

  const appendVisible = (text: string) => {
    if (!text) return;
    if (inDocument) {
      documentBuffer += text;
      return;
    }
    chatBuffer += text;
  };

  const processCompletedTag = (tagText: string) => {
    const openTitle = matchOpenDocumentTag(tagText);
    if (!inDocument && openTitle) {
      flushChat();
      activeDocumentTitle = openTitle;
      emit({ type: "document_start", title: activeDocumentTitle });
      inDocument = true;
      return;
    }

    if (inDocument && isCloseDocumentTag(tagText)) {
      flushDocument();
      emit({ type: "document_end", title: activeDocumentTitle || "Draft" });
      activeDocumentTitle = "";
      inDocument = false;
      return;
    }

    appendVisible(tagText);
  };

  const pushText = (chunk: string) => {
    for (const ch of chunk) {
      if (!tagMode) {
        if (ch === "<") {
          tagMode = true;
          tagBuffer = "<";
        } else {
          appendVisible(ch);
        }
        continue;
      }

      tagBuffer += ch;
      if (ch === ">") {
        processCompletedTag(tagBuffer);
        tagBuffer = "";
        tagMode = false;
        continue;
      }

      // If this no longer looks like a document tag, flush immediately as plain text.
      if (
        tagBuffer.length > 60 ||
        (!"<document".startsWith(tagBuffer.toLowerCase()) && !"</document".startsWith(tagBuffer.toLowerCase()))
      ) {
        appendVisible(tagBuffer);
        tagBuffer = "";
        tagMode = false;
      }
    }
  };

  const finish = () => {
    if (tagMode && tagBuffer) {
      appendVisible(tagBuffer);
      tagBuffer = "";
      tagMode = false;
    }

    flushChat();
    flushDocument();

    if (inDocument) {
      emit({ type: "document_end", title: activeDocumentTitle || "Draft" });
      inDocument = false;
      activeDocumentTitle = "";
    }
  };

  return { pushText, finish };
}

async function loadProjectSources(
  projectId: string,
  selectedSourceIds?: string[] | null
): Promise<WritingSource[]> {
  const projectDocs = await projectStorage.getProjectDocumentsByProject(projectId);

  const filteredDocs = selectedSourceIds && selectedSourceIds.length > 0
    ? projectDocs.filter((pd) => selectedSourceIds.includes(pd.id))
    : projectDocs;

  const perSourceFullTextLimit = filteredDocs.length > 0
    ? Math.min(
      MAX_SOURCE_FULLTEXT_CHARS,
      Math.max(2000, Math.floor(MAX_SOURCE_TOTAL_FULLTEXT_CHARS / filteredDocs.length))
    )
    : MAX_SOURCE_FULLTEXT_CHARS;

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
        clipText(fullDoc.fullText, perSourceFullTextLimit) ||
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

async function loadStandaloneWebClipSources(
  userId: string,
  selectedSourceIds?: string[] | null
): Promise<WritingSource[]> {
  if (!selectedSourceIds || selectedSourceIds.length === 0) {
    return [];
  }

  const clipIds = [...new Set(selectedSourceIds.map((id) => id?.trim()).filter(Boolean))] as string[];
  if (clipIds.length === 0) {
    return [];
  }

  const clips = await db
    .select()
    .from(webClips)
    .where(and(eq(webClips.userId, userId), inArray(webClips.id, clipIds)));

  const perSourceFullTextLimit = clips.length > 0
    ? Math.min(
      MAX_SOURCE_FULLTEXT_CHARS,
      Math.max(2000, Math.floor(MAX_SOURCE_TOTAL_FULLTEXT_CHARS / clips.length))
    )
    : MAX_SOURCE_FULLTEXT_CHARS;

  const byId = new Map(clips.map((clip) => [clip.id, clip]));
  const orderedClips = clipIds
    .map((id) => byId.get(id))
    .filter((clip): clip is typeof clips[number] => Boolean(clip));

  return orderedClips.map((clip) => {
    const citationData = (clip.citationData as CitationData | null) || null;
    const excerpt = clipText(
      clip.note || clip.highlightedText || clip.surroundingContext,
      MAX_SOURCE_EXCERPT_CHARS
    ) || "No summary available.";
    const mergedText = [
      `Page: ${clip.pageTitle}`,
      `URL: ${clip.sourceUrl}`,
      clip.authorName ? `Author: ${clip.authorName}` : "",
      clip.publishDate ? `Published: ${clip.publishDate}` : "",
      "",
      "Highlighted text:",
      clip.highlightedText,
      clip.surroundingContext ? `\nSurrounding context:\n${clip.surroundingContext}` : "",
      clip.note ? `\nUser note:\n${clip.note}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      id: clip.id,
      kind: "web_clip",
      title: citationData?.title || clip.pageTitle,
      author: buildAuthorLabel(citationData) || clip.authorName || "Unknown Author",
      excerpt,
      fullText: clipText(mergedText, perSourceFullTextLimit) || excerpt,
      category: "web_clip",
      note: clip.note || null,
      citationData,
      documentFilename: `${clip.pageTitle || "Web Clip"}.txt`,
    } satisfies WritingSource;
  });
}

async function loadConversationContext(
  conv: Pick<Conversation, "projectId" | "selectedSourceIds">,
  userId: string
): Promise<{ project: WritingProjectContext | null; sources: WritingSource[] }> {
  if (conv.projectId) {
    const [project, sources] = await Promise.all([
      projectStorage.getProject(conv.projectId),
      loadProjectSources(conv.projectId, conv.selectedSourceIds),
    ]);

    return {
      project: project
        ? {
          name: project.name,
          thesis: project.thesis,
          scope: project.scope,
          contextSummary: project.contextSummary,
        }
        : null,
      sources,
    };
  }

  return {
    project: null,
    sources: await loadStandaloneWebClipSources(userId, conv.selectedSourceIds),
  };
}

function buildWritingSystemPrompt(
  sources: WritingSource[],
  project: WritingProjectContext | null,
  citationStyle?: string,
  tone?: string,
  humanize?: boolean,
  noEnDashes?: boolean
): string {
  const styleLabel = (citationStyle || "chicago").toUpperCase();
  const noEnDashesRule = noEnDashes
    ? "\n9. NEVER use em-dashes or en-dashes. Use commas, periods, or semicolons instead."
    : "";
  const includeHumanStyle = humanize ?? true;
  const writingStyleBlock = includeHumanStyle
    ? `
WRITING STYLE:
- Vary sentence length. Mix short punchy sentences with longer analytical ones.
- Use active voice by default. Passive only when actor is unknown.
- Avoid cliche phrases: "It is important to note", "Furthermore", "In conclusion".
- Start paragraphs with substance, not meta-commentary.
- Write as a knowledgeable human expert, not as an AI summarizing.`
    : "";

  return `You are ScholarMark AI, an expert academic writing partner. You are collaborating with a student on a research paper.

${buildProjectContextBlock(project)}

You have access to ${sources.length} source document(s).

SOURCE MATERIALS:
${buildSourceBlock(sources)}

BEHAVIOR RULES:
1. When asked to write, draft, expand, or revise: PRODUCE THE CONTENT IMMEDIATELY. Do not ask clarifying questions unless the request is genuinely ambiguous.
2. Write in ${prettyToneLabel(tone)} register with ${styleLabel} citations.
3. Ground claims in the provided sources. Cite page numbers when available.
4. Use exact source text for direct quotations.
5. Flag claims that go beyond source support.
6. Build on prior conversation and maintain the student's argument thread.
7. Produce complete, publication-ready prose, not outlines.
8. Use footnotes for citations: [^1], [^2], etc. with footnote definitions at the end.${noEnDashesRule}

Do not fabricate quotations, publication details, page numbers, or bibliography metadata. If source detail is uncertain, state uncertainty clearly and cite conservatively.${writingStyleBlock}

OUTPUT FORMAT:
When producing substantial written content (a full paragraph or more of paper content), wrap it in document tags:

<document title="Section Title">
Your written content here in markdown...
</document>

Brief conversational responses (questions, acknowledgments, short clarifications) should NOT use document tags.`;
}

export function registerChatRoutes(app: Express) {
  // List all conversations (newest first)
  app.get("/api/chat/conversations", requireAuth, async (req: Request, res: Response) => {
    try {
      const rawProjectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
      const projectId = rawProjectId && rawProjectId !== "null" ? rawProjectId : undefined;
      const standaloneOnly = req.query.standalone === "true";
      const convos = standaloneOnly
        ? await chatStorage.getStandaloneConversations(req.user!.userId)
        : await chatStorage.getConversationsForUser(req.user!.userId, projectId);
      res.json(convos);
    } catch (error) {
      console.error("Error listing conversations:", error);
      res.status(500).json({ message: "Failed to list conversations" });
    }
  });

  // Create new conversation
  app.post("/api/chat/conversations", requireAuth, async (req: Request, res: Response) => {
    try {
      const { title, model, projectId, selectedSourceIds, humanize } = req.body || {};
      const conv = await chatStorage.createConversation({
        title: title || "New Chat",
        model: model || "claude-opus-4-6",
        userId: req.user!.userId,
        projectId: projectId || null,
        selectedSourceIds: selectedSourceIds || null,
        humanize: humanize ?? true,
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
      const { title, model, citationStyle, tone, humanize, noEnDashes } = req.body;
      const updates: Record<string, any> = {};
      if (title !== undefined) updates.title = title;
      if (model !== undefined) updates.model = model;
      if (citationStyle !== undefined) updates.citationStyle = citationStyle;
      if (tone !== undefined) updates.tone = tone;
      if (humanize !== undefined) updates.humanize = humanize;
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

      // Build system prompt with project context + sources (project docs or selected web clips)
      let systemPrompt = BASE_SYSTEM_PROMPT;
      const { project, sources } = await loadConversationContext(conv, req.user!.userId);
      const isWritingConversation = Boolean(conv.projectId || conv.selectedSourceIds !== null);
      if (isWritingConversation) {
        systemPrompt = buildWritingSystemPrompt(
          sources,
          project,
          conv.citationStyle || undefined,
          conv.tone || undefined,
          conv.humanize ?? true,
          conv.noEnDashes || false
        );
      }

      // Set up SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      const anthropic = getAnthropicClient();

      const stream = anthropic.messages.stream({
        model: CHAT_MODEL,
        max_tokens: CHAT_MAX_TOKENS,
        system: systemPrompt,
        messages: anthropicMessages,
      });

      let fullText = "";
      let closed = false;
      const parser = createDocumentStreamParser((event) => {
        if (closed || res.writableEnded) return;
        if (event.type === "chat_text") {
          const text = String(event.text ?? "");
          // Backward compatibility for legacy chat clients still listening for `text`.
          res.write(`data: ${JSON.stringify({ type: "text", text })}\n\n`);
        }
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });

      stream.on("text", (text) => {
        fullText += text;
        parser.pushText(text);
      });

      stream.on("message", async (message) => {
        try {
          parser.finish();
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

          if (!closed && !res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: "done", usage })}\n\n`);
            res.end();
          }
        } catch (err) {
          console.error("Error saving assistant message:", err);
          if (!closed && !res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: "error", error: "Failed to save response" })}\n\n`);
            res.end();
          }
        }
      });

      stream.on("error", (error) => {
        console.error("Anthropic stream error:", error);
        if (!closed && !res.writableEnded) {
          res.write(
            `data: ${JSON.stringify({ type: "error", error: error instanceof Error ? error.message : "Stream failed" })}\n\n`
          );
          res.end();
        }
      });

      // Handle client disconnect
      req.on("close", () => {
        closed = true;
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

      const { project, sources } = await loadConversationContext(conv, req.user!.userId);
      const projectContextBlock = buildProjectContextBlock(project);
      const sourcesBlock = sources.length > 0
        ? `\n\nSOURCE MATERIALS:\n${buildSourceBlock(sources)}`
        : "";

      const noEnDashesRule = avoidDashes
        ? "\n11. NEVER use em-dashes or en-dashes. Use commas, periods, or semicolons instead."
        : "";

      const compilePrompt = `You are assembling a final academic paper from a writing conversation.
The student and AI have been collaboratively drafting sections.

${projectContextBlock}
Target citation style: ${style.toUpperCase()}
Target tone: ${prettyToneLabel(writingTone)}

RULES:
1. Include every piece of substantive writing the assistant produced.
2. Preserve the student's thesis and argument structure.
3. Do NOT summarize or shorten sections. Include draft content in full unless superseded by a later revision.
4. If the same topic or section was revised multiple times, use the LATEST version.
5. Remove conversational chatter and keep only polished paper content.
6. Add only what is required to unify the paper: transitions, a unified introduction (if missing), and a conclusion that synthesizes the argument.
7. Use footnotes for citations ([^1], [^2], etc.) throughout the paper.
8. Include footnote definitions immediately before the bibliography.
9. Compile a bibliography from all cited sources using ${style.toUpperCase()} format.
10. Write naturally: vary sentence length, prefer active voice, and avoid filler phrases.
11. Do not fabricate source details not grounded in the provided sources.${noEnDashesRule}
12. Output clean markdown using ## section headings.

CONVERSATION TRANSCRIPT:
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
        model: COMPILE_MODEL,
        max_tokens: COMPILE_MAX_TOKENS,
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
      const { project, sources } = await loadConversationContext(conv, req.user!.userId);
      const projectContextBlock = buildProjectContextBlock(project);
      const sourcesBlock = sources.length > 0
        ? `\n\nSOURCE MATERIALS FOR VERIFICATION:\n${buildSourceBlock(sources)}`
        : "\n\nSOURCE MATERIALS FOR VERIFICATION:\nNo attached source materials were provided.";

      const verifyPrompt = `You are an academic paper reviewer performing strict source and citation verification.

${projectContextBlock}
Citation style to enforce: ${style.toUpperCase()}

Verification requirements:
1. Cross-reference every direct quote against the provided source text.
2. Check whether paraphrases accurately reflect the source content.
3. Verify page numbers or section references where they are provided.
4. Flag any citation that does not correspond to the provided sources.
5. Check footnote numbering consistency and formatting correctness.
6. Check citation and bibliography formatting consistency in ${style.toUpperCase()}.
7. Identify unsupported or over-claimed assertions.
8. Review logical flow, argument coherence, tone consistency, and major grammar issues.

Output format:
- Executive summary (2-4 sentences)
- Findings (numbered, highest severity first)
- Each finding must include: location/passage, issue, and concrete fix
- Strengths (optional)

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
        model: VERIFY_MODEL,
        max_tokens: VERIFY_MAX_TOKENS,
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
