import type { Express, Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, inArray } from "drizzle-orm";
import {
  chatStorage,
  updateConversationClipboard,
  updateConversationCompaction,
} from "../chatStorage";
import { db } from "../db";
import { projectStorage } from "../projectStorage";
import { writingStyleStorage } from "../writingStyleStorage";
import { storage } from "../storage";
import { checkTokenBudget, requireAuth, requireTier } from "../auth";
import { aiLimiter } from "../rateLimits";
import { incrementTokenUsage } from "../authStorage";
import { logContextSnapshot, logToolCall } from "../analyticsLogger";
import {
  gatherEvidence,
  formatEvidenceBrief,
  type SourceStub,
  type EvidenceBrief,
} from "../gatherer";
import {
  createEmptyClipboard,
  deserializeClipboard,
  serializeClipboard,
  formatClipboardForPrompt,
  extractUsedEvidence,
  type EvidenceClipboard,
} from "../evidenceClipboard";
import { compactConversation, buildCompactedHistory } from "../contextCompaction";
import { type TieredSource, type WritingSource } from "../writingPipeline";
import { analyzeWritingStyle, isSourceRole, type SourceRole } from "../sourceRoles";
import { clipText, buildAuthorLabel } from "./shared";
import { applyJumpLinksToMarkdown } from "../quoteJumpLinks";
import { wrapGeneratedDocumentIfNeeded } from "../chatDocumentFormatting";
import { sanitizeSseError, startSseHeartbeat } from "../sseUtils";
import { extractRecentWritingTopic, runResearchAgent } from "../researchAgent";
import {
  projectDocuments,
  webClips,
  type CitationData,
  type Conversation,
  type Project,
} from "@shared/schema";
import {
  BASE_SYSTEM_PROMPT,
  CHAT_MAX_TOKENS,
  COMPILE_MAX_TOKENS,
  MAX_CONTEXT_ESCALATIONS,
  MAX_SOURCE_EXCERPT_CHARS,
  MAX_SOURCE_FULLTEXT_CHARS,
  MAX_SOURCE_TOTAL_FULLTEXT_CHARS,
  MODELS,
  VERIFY_MAX_TOKENS,
  buildCompilePrompt,
  buildQuoteJumpTargets,
  buildVerifyPrompt,
  buildWritingSystemPrompt,
  estimateContextUsage,
  getModelsForConversation,
  getWritingMode,
  isTieredSource,
  toAnthropicMessages,
  type AnthropicHistoryMessage,
  type ContextUsageEstimate,
  type ContextWarningLevel,
  type PromptSource,
  type WritingProjectContext,
  type WritingStyleContext,
} from "./promptBuilder";
import {
  createDocumentStreamParser,
  createToolRequestParser,
  type StreamTurnResult,
  type ToolRequest,
} from "./streamProtocol";
import {
  buildSourceTools,
  createSourceToolExecutor,
  formatDeepDiveFindings,
  loadSurroundingChunks,
} from "./toolRequests";
import { createLogger } from "../logger";

const logger = createLogger("chat/handlers");

async function getOwnedConversationOr404(
  req: Request,
  res: Response,
): Promise<Conversation | null> {
  const conv = await chatStorage.getConversation(req.params.id);
  if (!conv || conv.userId !== req.user!.userId) {
    res.status(404).json({ message: "Conversation not found" });
    return null;
  }
  return conv;
}

async function getOwnedProjectOr404(projectId: string, userId: string): Promise<Project | null> {
  const project = await projectStorage.getProject(projectId);
  return project?.userId === userId ? project : null;
}

function getUsageTokenTotal(
  usage: { input_tokens?: number; output_tokens?: number } | null | undefined,
): number {
  return (usage?.input_tokens || 0) + (usage?.output_tokens || 0);
}

async function recordUserTokenUsage(
  userId: string,
  tokensUsed: number,
  source: string,
): Promise<void> {
  if (!Number.isFinite(tokensUsed) || tokensUsed <= 0) return;
  try {
    await incrementTokenUsage(userId, tokensUsed);
  } catch (error) {
    logger.warn(
      {
        userId,
        source,
        tokensUsed,
        error: error instanceof Error ? error.message : String(error),
      },
      "[chatRoutes] failed to increment token usage",
    );
  }
}

function getAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

async function getOwnedWritingStyleOrNull(
  writingStyleId: string | null | undefined,
  userId: string,
): Promise<WritingStyleContext | null> {
  if (!writingStyleId) return null;
  const style = await writingStyleStorage.getWritingStyleForUser(writingStyleId, userId);
  if (!style) return null;
  return {
    name: style.name,
    description: style.description,
    voiceProfile: style.voiceProfile,
  };
}

async function assertOwnedWritingStyle(
  writingStyleId: unknown,
  userId: string,
  res: Response,
): Promise<string | null | undefined> {
  if (writingStyleId === undefined) return undefined;
  if (writingStyleId === null || writingStyleId === "") return null;
  if (typeof writingStyleId !== "string") {
    res.status(400).json({ message: "writingStyleId must be a string or null" });
    return undefined;
  }
  const style = await writingStyleStorage.getWritingStyleForUser(writingStyleId, userId);
  if (!style) {
    res.status(404).json({ message: "Writing style not found" });
    return undefined;
  }
  return style.id;
}

async function loadProjectSourcesTiered(
  projectId: string,
  selectedSourceIds?: string[] | null,
): Promise<TieredSource[]> {
  const projectDocs = await projectStorage.getProjectDocumentsByProject(projectId);
  const filteredDocs =
    selectedSourceIds && selectedSourceIds.length > 0
      ? projectDocs.filter((projectDoc) => selectedSourceIds.includes(projectDoc.id))
      : projectDocs;

  const sources: TieredSource[] = [];

  for (const projectDoc of filteredDocs) {
    const fullDoc = await storage.getDocument(projectDoc.documentId);
    if (!fullDoc) continue;

    const annotations = await projectStorage.getProjectAnnotationsByDocument(projectDoc.id);
    const citationData = (projectDoc.citationData as CitationData | null) || null;
    const sourceRole: SourceRole = isSourceRole(projectDoc.sourceRole)
      ? projectDoc.sourceRole
      : "evidence";
    let styleAnalysis = projectDoc.styleAnalysis || null;

    if (sourceRole === "style_reference" && !styleAnalysis) {
      try {
        const analysis = await analyzeWritingStyle(
          getAnthropicClient(),
          fullDoc.fullText,
          citationData?.title || projectDoc.document.filename,
        );
        styleAnalysis = JSON.stringify(analysis);
        await db
          .update(projectDocuments)
          .set({ styleAnalysis })
          .where(eq(projectDocuments.id, projectDoc.id));
      } catch (error) {
        logger.warn(
          {
            projectDocumentId: projectDoc.id,
            error: error instanceof Error ? error.message : String(error),
          },
          "[chatRoutes] style analysis failed",
        );
      }
    }

    const excerpt =
      clipText(fullDoc.summary, MAX_SOURCE_EXCERPT_CHARS) ||
      clipText(fullDoc.fullText, MAX_SOURCE_EXCERPT_CHARS) ||
      "No summary available.";

    sources.push({
      id: projectDoc.id,
      kind: "project_document",
      title: citationData?.title || projectDoc.document.filename,
      author: buildAuthorLabel(citationData),
      category: "project_source",
      citationData,
      documentFilename: projectDoc.document.filename,
      summary: fullDoc.summary,
      mainArguments: fullDoc.mainArguments || null,
      keyConcepts: fullDoc.keyConcepts || null,
      roleInProject: projectDoc.roleInProject || null,
      projectContext: projectDoc.projectContext || null,
      sourceRole,
      styleAnalysis,
      chunkCount: fullDoc.chunkCount,
      annotations,
      excerpt,
      documentId: fullDoc.id,
    });
  }

  return sources;
}

async function loadStandaloneWebClipSources(
  userId: string,
  selectedSourceIds?: string[] | null,
): Promise<WritingSource[]> {
  if (!selectedSourceIds || selectedSourceIds.length === 0) {
    return [];
  }

  const clipIds = Array.from(
    new Set(selectedSourceIds.map((id) => id?.trim()).filter(Boolean)),
  ) as string[];
  if (clipIds.length === 0) {
    return [];
  }

  const clips = await db
    .select()
    .from(webClips)
    .where(and(eq(webClips.userId, userId), inArray(webClips.id, clipIds)));

  const perSourceFullTextLimit =
    clips.length > 0
      ? Math.min(
          MAX_SOURCE_FULLTEXT_CHARS,
          Math.max(2000, Math.floor(MAX_SOURCE_TOTAL_FULLTEXT_CHARS / clips.length)),
        )
      : MAX_SOURCE_FULLTEXT_CHARS;

  const byId = new Map(clips.map((clip) => [clip.id, clip]));
  const orderedClips = clipIds
    .map((id) => byId.get(id))
    .filter((clip): clip is (typeof clips)[number] => Boolean(clip));

  return orderedClips.map((clip) => {
    const citationData = (clip.citationData as CitationData | null) || null;
    const excerpt =
      clipText(
        clip.note || clip.highlightedText || clip.surroundingContext,
        MAX_SOURCE_EXCERPT_CHARS,
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
  conv: Pick<Conversation, "projectId" | "selectedSourceIds" | "writingStyleId">,
  userId: string,
): Promise<{
  project: WritingProjectContext | null;
  sources: PromptSource[];
  writingStyle: WritingStyleContext | null;
}> {
  const writingStylePromise = getOwnedWritingStyleOrNull(conv.writingStyleId, userId);

  if (conv.projectId) {
    const ownedProject = await getOwnedProjectOr404(conv.projectId, userId);
    if (!ownedProject) {
      return { project: null, sources: [], writingStyle: await writingStylePromise };
    }

    const [project, sources, writingStyle] = await Promise.all([
      Promise.resolve(ownedProject),
      loadProjectSourcesTiered(conv.projectId, conv.selectedSourceIds),
      writingStylePromise,
    ]);

    return {
      project: project
        ? {
            name: project.name,
            thesis: project.thesis,
            scope: project.scope,
            contextSummary: project.contextSummary,
            voiceProfile: project.voiceProfile,
          }
        : null,
      sources,
      writingStyle,
    };
  }

  return {
    project: null,
    sources: await loadStandaloneWebClipSources(userId, conv.selectedSourceIds),
    writingStyle: await writingStylePromise,
  };
}

export function registerChatRoutes(app: Express) {
  app.get(
    "/api/chat/conversations",
    requireAuth,
    requireTier("pro"),
    async (req: Request, res: Response) => {
      try {
        const rawProjectId =
          typeof req.query.projectId === "string" ? req.query.projectId : undefined;
        const projectId = rawProjectId && rawProjectId !== "null" ? rawProjectId : undefined;
        const standaloneOnly = req.query.standalone === "true";
        if (projectId) {
          const project = await getOwnedProjectOr404(projectId, req.user!.userId);
          if (!project) {
            return res.status(404).json({ message: "Project not found" });
          }
        }
        const conversations = standaloneOnly
          ? await chatStorage.getStandaloneConversations(req.user!.userId)
          : await chatStorage.getConversationsForUser(req.user!.userId, projectId);
        res.json(conversations);
      } catch (error) {
        logger.error({ err: error }, "Error listing conversations:");
        res.status(500).json({ message: "Failed to list conversations" });
      }
    },
  );

  app.post(
    "/api/chat/conversations",
    requireAuth,
    requireTier("pro"),
    async (req: Request, res: Response) => {
      try {
        const {
          title,
          model,
          projectId,
          selectedSourceIds,
          citationStyle,
          tone,
          humanize,
          noEnDashes,
          writingModel,
          writingStyleId,
        } = req.body || {};

        const normalizedWritingModel = writingModel === "extended" ? "extended" : "precision";
        if (projectId) {
          const project = await getOwnedProjectOr404(projectId, req.user!.userId);
          if (!project) {
            return res.status(404).json({ message: "Project not found" });
          }
        }
        const normalizedWritingStyleId = await assertOwnedWritingStyle(
          writingStyleId,
          req.user!.userId,
          res,
        );
        if (writingStyleId !== undefined && normalizedWritingStyleId === undefined) return;

        const conv = await chatStorage.createConversation({
          title: title || "New Chat",
          model: model || MODELS.precision.chat,
          writingModel: normalizedWritingModel,
          userId: req.user!.userId,
          projectId: projectId || null,
          selectedSourceIds: selectedSourceIds || null,
          writingStyleId: normalizedWritingStyleId ?? null,
          citationStyle: citationStyle || "chicago",
          tone: tone || "academic",
          humanize: humanize ?? true,
          noEnDashes: noEnDashes ?? false,
        });
        res.json(conv);
      } catch (error) {
        logger.error({ err: error }, "Error creating conversation:");
        res.status(500).json({ message: "Failed to create conversation" });
      }
    },
  );

  app.get(
    "/api/chat/conversations/:id",
    requireAuth,
    requireTier("pro"),
    async (req: Request, res: Response) => {
      try {
        const conv = await getOwnedConversationOr404(req, res);
        if (!conv) return;
        const messages = await chatStorage.getMessagesForConversation(conv.id);
        res.json({ ...conv, messages });
      } catch (error) {
        logger.error({ err: error }, "Error fetching conversation:");
        res.status(500).json({ message: "Failed to fetch conversation" });
      }
    },
  );

  app.delete(
    "/api/chat/conversations/:id",
    requireAuth,
    requireTier("pro"),
    async (req: Request, res: Response) => {
      try {
        const conv = await getOwnedConversationOr404(req, res);
        if (!conv) return;
        await chatStorage.deleteConversation(req.params.id);
        res.json({ success: true });
      } catch (error) {
        logger.error({ err: error }, "Error deleting conversation:");
        res.status(500).json({ message: "Failed to delete conversation" });
      }
    },
  );

  app.put(
    "/api/chat/conversations/:id",
    requireAuth,
    requireTier("pro"),
    async (req: Request, res: Response) => {
      try {
        const {
          title,
          model,
          writingModel,
          citationStyle,
          tone,
          humanize,
          noEnDashes,
          writingStyleId,
        } = req.body;

        const updates: Record<string, unknown> = {};
        if (title !== undefined) updates.title = title;
        if (model !== undefined) updates.model = model;
        if (writingModel !== undefined)
          updates.writingModel = writingModel === "extended" ? "extended" : "precision";
        if (citationStyle !== undefined) updates.citationStyle = citationStyle;
        if (tone !== undefined) updates.tone = tone;
        if (humanize !== undefined) updates.humanize = humanize;
        if (noEnDashes !== undefined) updates.noEnDashes = noEnDashes;

        const existing = await getOwnedConversationOr404(req, res);
        if (!existing) return;

        if (writingStyleId !== undefined) {
          const normalizedWritingStyleId = await assertOwnedWritingStyle(
            writingStyleId,
            req.user!.userId,
            res,
          );
          if (normalizedWritingStyleId === undefined) return;
          updates.writingStyleId = normalizedWritingStyleId;
        }

        const conv = await chatStorage.updateConversation(req.params.id, updates);
        res.json(conv);
      } catch (error) {
        logger.error({ err: error }, "Error updating conversation:");
        res.status(500).json({ message: "Failed to update conversation" });
      }
    },
  );

  app.put(
    "/api/chat/conversations/:id/sources",
    requireAuth,
    requireTier("pro"),
    async (req: Request, res: Response) => {
      try {
        const { selectedSourceIds } = req.body;
        if (!Array.isArray(selectedSourceIds)) {
          return res.status(400).json({ message: "selectedSourceIds must be an array" });
        }
        const existing = await getOwnedConversationOr404(req, res);
        if (!existing) return;
        const conv = await chatStorage.updateSelectedSources(req.params.id, selectedSourceIds);
        res.json(conv);
      } catch (error) {
        logger.error({ err: error }, "Error updating sources:");
        res.status(500).json({ message: "Failed to update sources" });
      }
    },
  );

  app.post(
    "/api/chat/conversations/:id/messages",
    requireAuth,
    aiLimiter,
    requireTier("pro"),
    checkTokenBudget,
    async (req: Request, res: Response) => {
      let stopHeartbeat: (() => void) | null = null;

      try {
        const { content } = req.body;
        if (!content || typeof content !== "string") {
          return res.status(400).json({ message: "Content is required" });
        }

        const conv = await getOwnedConversationOr404(req, res);
        if (!conv) return;

        await chatStorage.createMessage({
          conversationId: conv.id,
          role: "user",
          content,
        });

        let history = await chatStorage.getMessagesForConversation(conv.id);
        let anthropicMessages = toAnthropicMessages(history);
        const mode = getWritingMode(conv);
        const models = getModelsForConversation(conv);

        const { project, sources, writingStyle } = await loadConversationContext(
          conv,
          req.user!.userId,
        );
        const isWritingConversation = Boolean(
          conv.projectId || conv.selectedSourceIds !== null || conv.writingStyleId,
        );
        let systemPrompt = BASE_SYSTEM_PROMPT;
        if (isWritingConversation) {
          systemPrompt = buildWritingSystemPrompt(
            sources,
            project,
            writingStyle,
            conv.citationStyle || undefined,
            conv.tone || undefined,
            conv.humanize ?? true,
            conv.noEnDashes || false,
          );
          if (mode === "precision") {
            systemPrompt += `\n\nPRECISION MODE:
A research gatherer has already collected the best evidence for this turn.
Do NOT emit <chunk_request> or <context_request> tags.
Use the gathered evidence, the accumulated clipboard, and the recent conversation context to answer directly.`;
          }
        }

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");

        let closed = false;
        let activeStream: { abort: () => void } | null = null;

        req.on("close", () => {
          closed = true;
          stopHeartbeat?.();
          stopHeartbeat = null;
          activeStream?.abort();
        });

        stopHeartbeat = startSseHeartbeat(res, { isClosed: () => closed });

        const sendEvent = (payload: Record<string, unknown>) => {
          if (closed || res.writableEnded) return;
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        };

        const sendWritingStatus = (message: string, phase: string, progress?: number) => {
          sendEvent({
            type: "writing_status",
            phase,
            message,
            ...(typeof progress === "number" ? { progress } : {}),
          });
        };

        const anthropic = getAnthropicClient();
        const tieredSources = sources.filter((source): source is TieredSource =>
          isTieredSource(source),
        );
        const allowedSourceDocumentIds = new Set(tieredSources.map((source) => source.documentId));
        const allowedProjectDocumentIds = new Set(tieredSources.map((source) => source.id));
        const sourceTools = buildSourceTools();
        const executeSourceTool = createSourceToolExecutor(tieredSources);
        const clipboard: EvidenceClipboard = conv.evidenceClipboard
          ? deserializeClipboard(conv.evidenceClipboard)
          : createEmptyClipboard(project?.thesis || "");
        if (!clipboard.thesis && project?.thesis) {
          clipboard.thesis = project.thesis;
        }

        let effectiveCompactionSummary = conv.compactionSummary || null;
        let effectiveCompactedAtTurn = conv.compactedAtTurn || 0;
        sendWritingStatus("Preparing selected project sources...", "preparing", 5);
        if (mode === "precision") {
          sendWritingStatus("Condensing earlier chat context...", "preparing", 12);
          const compactionResult = await compactConversation(
            anthropic,
            history.map((message) => ({ role: message.role, content: message.content })),
            effectiveCompactionSummary,
            effectiveCompactedAtTurn,
          );
          if (compactionResult) {
            effectiveCompactionSummary = compactionResult.summary;
            effectiveCompactedAtTurn = compactionResult.compactedAtTurn;
            await updateConversationCompaction(conv.id, {
              compactionSummary: compactionResult.summary,
              compactedAtTurn: compactionResult.compactedAtTurn,
            });
          }
        }

        let evidenceBrief: EvidenceBrief | null = null;
        let evidenceBriefText = "[No new evidence gathered for this turn]";
        let messagesForTurn = anthropicMessages;
        if (mode === "precision") {
          const sourceStubs: SourceStub[] = tieredSources.map((source) => ({
            docId: source.documentId,
            title: source.title || source.documentFilename,
            role: source.sourceRole || "evidence",
            summary: source.summary || undefined,
            annotationCount: source.annotations.length,
            chunkCount: source.chunkCount || 0,
          }));

          sendWritingStatus(
            sourceStubs.length > 0
              ? "Finding the strongest evidence in the selected sources..."
              : "Preparing the draft request...",
            "evidence",
            25,
          );
          evidenceBrief = await gatherEvidence(
            anthropic,
            content,
            sourceStubs,
            clipboard,
            project?.thesis || "",
            sourceTools,
            executeSourceTool,
          );
          evidenceBriefText = formatEvidenceBrief(evidenceBrief);

          const compactedHistory = buildCompactedHistory(
            history
              .slice(0, -1)
              .map((message) => ({ role: message.role, content: message.content })),
            formatClipboardForPrompt(clipboard),
            effectiveCompactionSummary,
            effectiveCompactedAtTurn,
          ).map((message) => ({
            role: message.role === "system" ? "assistant" : message.role,
            content: message.content,
          })) as AnthropicHistoryMessage[];

          const latestUserMessage = anthropicMessages[anthropicMessages.length - 1];
          messagesForTurn = latestUserMessage
            ? [
                ...compactedHistory,
                { role: "user", content: `[EVIDENCE GATHERED THIS TURN]\n${evidenceBriefText}` },
                {
                  role: "assistant",
                  content:
                    "I have the evidence gathered for this turn and will use it selectively.",
                },
                latestUserMessage,
              ]
            : compactedHistory;
        }

        sendWritingStatus("Building the draft with project context...", "drafting", 40);

        let sentWarningLevel: ContextWarningLevel = "ok";

        const sendContextWarningIfNeeded = (usage: ContextUsageEstimate) => {
          if (usage.warningLevel === "ok") return;
          if (usage.warningLevel === sentWarningLevel) return;
          sentWarningLevel = usage.warningLevel;

          if (usage.warningLevel === "critical") {
            sendEvent({
              type: "context_warning",
              message:
                "Context window is nearly full. Deep source analysis is disabled. Consider starting a new conversation.",
              available: usage.available,
            });
            return;
          }

          sendEvent({
            type: "context_warning",
            message: "Context is getting large. Source analysis may be limited.",
            available: usage.available,
          });
        };

        let usageEstimate = estimateContextUsage(systemPrompt, messagesForTurn, mode);
        sendContextWarningIfNeeded(usageEstimate);
        let deepDiveAllowed = usageEstimate.warningLevel !== "critical";

        const runTurn = async (
          messagesForTurn: AnthropicHistoryMessage[],
        ): Promise<StreamTurnResult> => {
          return new Promise<StreamTurnResult>((resolve, reject) => {
            let fullText = "";
            const detectedRequests: ToolRequest[] = [];
            const parser = createDocumentStreamParser((event) => {
              if (closed || res.writableEnded) return;
              sendEvent(event as Record<string, unknown>);
            });
            const toolParser = createToolRequestParser((request) => {
              detectedRequests.push(request);
            });

            const stream = anthropic.messages.stream({
              model: models.chat,
              max_tokens: CHAT_MAX_TOKENS,
              system: systemPrompt,
              messages: messagesForTurn,
            });

            activeStream = stream;

            stream.on("text", (text) => {
              fullText += text;
              parser.pushText(text);
              toolParser.pushText(text);
            });

            stream.on("message", (message) => {
              parser.finish();
              toolParser.finish();
              activeStream = null;

              resolve({
                fullText,
                usage: message.usage || {},
                toolRequests: detectedRequests,
              });
            });

            stream.on("error", (error) => {
              parser.finish({ finalizeDocument: false });
              toolParser.finish();
              activeStream = null;

              if (closed) {
                resolve({
                  fullText,
                  usage: {},
                  toolRequests: detectedRequests,
                });
                return;
              }
              reject(error);
            });
          });
        };

        const isFirstExchange = history.filter((message) => message.role === "user").length === 1;
        let hasAutoTitled = false;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let escalationCount = 0;

        while (!closed) {
          sendWritingStatus(
            escalationCount === 0
              ? "Writing the draft..."
              : "Continuing the draft with additional source context...",
            "drafting",
            escalationCount === 0 ? 50 : 70,
          );
          const turn = await runTurn(messagesForTurn);
          const inputTokens = turn.usage.input_tokens || 0;
          const outputTokens = turn.usage.output_tokens || 0;
          totalInputTokens += inputTokens;
          totalOutputTokens += outputTokens;

          sendWritingStatus("Saving the generated draft...", "saving", 88);
          const assistantContent = wrapGeneratedDocumentIfNeeded(
            applyJumpLinksToMarkdown(turn.fullText, buildQuoteJumpTargets(conv.projectId, sources)),
          );

          await chatStorage.createMessage({
            conversationId: conv.id,
            role: "assistant",
            content: assistantContent,
            tokensUsed: inputTokens + outputTokens,
          });
          await recordUserTokenUsage(req.user!.userId, inputTokens + outputTokens, "chat_message");

          if (!hasAutoTitled && isFirstExchange && conv.title === "New Chat") {
            const autoTitle = content.length <= 50 ? content : `${content.slice(0, 47)}...`;
            await chatStorage.updateConversation(conv.id, { title: autoTitle });
            hasAutoTitled = true;
          }

          if (mode === "precision") {
            sendWritingStatus("Remembering which evidence was used...", "saving", 92);
            const updatedClipboard = await extractUsedEvidence(
              anthropic,
              turn.fullText,
              evidenceBriefText,
              clipboard,
              history.filter((message) => message.role === "user").length,
            );
            await updateConversationClipboard(conv.id, serializeClipboard(updatedClipboard));
            break;
          }

          const request = turn.toolRequests[turn.toolRequests.length - 1];
          if (!request || escalationCount >= MAX_CONTEXT_ESCALATIONS) {
            break;
          }

          let contextMessage = "";

          if (request.type === "chunk_request") {
            sendWritingStatus("Loading nearby source text...", "retrieving", 62);
            sendEvent({ type: "context_loading", level: 2, documentId: request.documentId });

            if (!request.annotationId) {
              contextMessage =
                "[CONTEXT RETRIEVAL - ERROR]\nMissing annotation_id in chunk request.";
            } else {
              const annotation = await projectStorage.getProjectAnnotation(request.annotationId);
              if (!annotation) {
                contextMessage = `[CONTEXT RETRIEVAL - ERROR]\nAnnotation "${request.annotationId}" was not found.`;
              } else {
                const projectDocument = await projectStorage.getProjectDocument(
                  annotation.projectDocumentId,
                );
                if (!projectDocument || !allowedProjectDocumentIds.has(projectDocument.id)) {
                  contextMessage = `[CONTEXT RETRIEVAL - ERROR]\nAnnotation "${request.annotationId}" is not attached to this conversation.`;
                } else {
                  const resolvedDocumentId = projectDocument.documentId;
                  const chunkContext = await loadSurroundingChunks(
                    resolvedDocumentId,
                    annotation.startPosition,
                    annotation.endPosition,
                  );
                  contextMessage = `[CONTEXT RETRIEVAL - Surrounding text for annotation ${request.annotationId}]
Reason: ${request.reason || "No reason provided."}

${chunkContext}`;
                }
              }
            }

            sendEvent({ type: "context_loaded", level: 2, documentId: request.documentId });
            void logToolCall({
              conversationId: conv.id,
              userId: req.user!.userId,
              projectId: conv.projectId ?? null,
              toolName: "chunk_request",
              documentId: request.documentId || null,
              escalationRound: escalationCount + 1,
              turnNumber: history.filter((m) => m.role === "user").length,
              resultSizeChars: contextMessage.length,
              success: !contextMessage.includes("ERROR"),
              timestamp: Date.now(),
            }).catch((err) => logger.warn({ err: err }, "[analytics] logToolCall error:"));
          } else if (request.type === "context_request") {
            if (!deepDiveAllowed) {
              sendEvent({
                type: "context_warning",
                message:
                  "Deep source analysis is disabled because the context window is nearly full.",
                available: usageEstimate.available,
              });
              break;
            }

            sendWritingStatus("Running a deeper source check...", "retrieving", 62);
            sendEvent({ type: "context_loading", level: 3, documentId: request.documentId });

            try {
              history = await chatStorage.getMessagesForConversation(conv.id);
              const recentWritingTopic = extractRecentWritingTopic(history);
              const sourceDocument = allowedSourceDocumentIds.has(request.documentId)
                ? await storage.getDocument(request.documentId)
                : null;

              if (!sourceDocument) {
                contextMessage = `[DEEP DIVE FINDINGS - ERROR]\nDocument "${request.documentId}" was not found.`;
                sendEvent({ type: "context_loaded", level: 3, findingCount: 0 });
              } else {
                const researchResult = await runResearchAgent(
                  request.documentId,
                  request.reason || "Comprehensive source review requested.",
                  {
                    thesis: project?.thesis || null,
                    scope: project?.scope || null,
                    recentWritingTopic,
                  },
                );
                contextMessage = formatDeepDiveFindings(
                  sourceDocument.filename,
                  researchResult.findings,
                );
                sendEvent({
                  type: "context_loaded",
                  level: 3,
                  findingCount: researchResult.findings.length,
                  tokensUsed: researchResult.tokensUsed,
                });
              }
            } catch (researchError) {
              logger.error({ err: researchError }, "Research agent error:");
              contextMessage = `[DEEP DIVE FINDINGS - ERROR]\n${
                researchError instanceof Error ? researchError.message : "Research agent failed."
              }`;
              sendEvent({ type: "context_loaded", level: 3, findingCount: 0 });
            }
            void logToolCall({
              conversationId: conv.id,
              userId: req.user!.userId,
              projectId: conv.projectId ?? null,
              toolName: "context_request",
              documentId: request.documentId || null,
              escalationRound: escalationCount + 1,
              turnNumber: history.filter((m) => m.role === "user").length,
              resultSizeChars: contextMessage.length,
              success: !contextMessage.includes("ERROR"),
              timestamp: Date.now(),
            }).catch((err) => logger.warn({ err: err }, "[analytics] logToolCall error:"));
          }

          if (!contextMessage.trim()) {
            break;
          }

          await chatStorage.createMessage({
            conversationId: conv.id,
            role: "user",
            content: contextMessage,
          });

          history = await chatStorage.getMessagesForConversation(conv.id);
          anthropicMessages = toAnthropicMessages(history);
          messagesForTurn = anthropicMessages;
          usageEstimate = estimateContextUsage(systemPrompt, messagesForTurn, mode);
          void logContextSnapshot({
            conversationId: conv.id,
            turnNumber: history.filter((m) => m.role === "user").length,
            escalationRound: escalationCount + 1,
            estimatedTokens: usageEstimate.totalUsed,
            warningLevel: usageEstimate.warningLevel,
            trigger: request.type,
            timestamp: Date.now(),
            metadata: { documentId: request.documentId || null },
          }).catch((err) => logger.warn({ err: err }, "[analytics] logContextSnapshot error:"));
          sendContextWarningIfNeeded(usageEstimate);
          deepDiveAllowed = usageEstimate.warningLevel !== "critical";
          escalationCount += 1;
        }

        if (!closed && !res.writableEnded) {
          sendWritingStatus("Writing complete.", "complete", 100);
          sendEvent({
            type: "done",
            usage: {
              input_tokens: totalInputTokens,
              output_tokens: totalOutputTokens,
            },
          });
          stopHeartbeat?.();
          stopHeartbeat = null;
          res.end();
        }
      } catch (error) {
        logger.error({ err: error }, "Error sending message:");
        stopHeartbeat?.();
        stopHeartbeat = null;
        if (!res.headersSent) {
          res.status(500).json({ message: sanitizeSseError(error, "Failed to send message") });
        } else {
          res.write(
            `data: ${JSON.stringify({ type: "error", error: sanitizeSseError(error, "Failed to send message") })}\n\n`,
          );
          res.end();
        }
      }
    },
  );

  app.post(
    "/api/chat/conversations/:id/compile",
    requireAuth,
    aiLimiter,
    requireTier("pro"),
    checkTokenBudget,
    async (req: Request, res: Response) => {
      let stopHeartbeat: (() => void) | null = null;

      try {
        const conv = await getOwnedConversationOr404(req, res);
        if (!conv) return;

        const { citationStyle, tone, noEnDashes } = req.body;
        const style = citationStyle || conv.citationStyle || "chicago";
        const writingTone = tone || conv.tone || "academic";
        const avoidDashes = noEnDashes ?? conv.noEnDashes ?? false;
        const models = getModelsForConversation(conv);

        const history = await chatStorage.getMessagesForConversation(conv.id);
        if (history.length === 0) {
          return res.status(400).json({ message: "No conversation to compile" });
        }

        const transcript = history
          .filter((message) => message.role === "user" || message.role === "assistant")
          .map((message) => `[${message.role.toUpperCase()}]: ${message.content}`)
          .join("\n\n---\n\n");

        const { project, sources, writingStyle } = await loadConversationContext(
          conv,
          req.user!.userId,
        );
        const compilePrompt = buildCompilePrompt({
          transcript,
          project,
          sources,
          writingStyle,
          style,
          tone: writingTone,
          noEnDashes: avoidDashes,
        });

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");

        const anthropic = getAnthropicClient();
        let aborted = false;

        req.on("close", () => {
          aborted = true;
          stopHeartbeat?.();
          stopHeartbeat = null;
        });

        stopHeartbeat = startSseHeartbeat(res, { isClosed: () => aborted });

        const stream = anthropic.messages.stream({
          model: models.compile,
          max_tokens: COMPILE_MAX_TOKENS,
          messages: [{ role: "user", content: compilePrompt }],
        });

        stream.on("text", (text) => {
          if (!aborted) {
            res.write(`data: ${JSON.stringify({ type: "text", text })}\n\n`);
          }
        });

        stream.on("message", async (message) => {
          await recordUserTokenUsage(
            req.user!.userId,
            getUsageTokenTotal(message?.usage),
            "chat_compile",
          );
          if (aborted) return;
          stopHeartbeat?.();
          stopHeartbeat = null;
          res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
          res.end();
        });

        stream.on("error", (error) => {
          logger.error({ err: error }, "Compile stream error:");
          if (!aborted) {
            stopHeartbeat?.();
            stopHeartbeat = null;
            res.write(
              `data: ${JSON.stringify({ type: "error", error: sanitizeSseError(error, "Compile failed") })}\n\n`,
            );
            res.end();
          }
        });
      } catch (error) {
        logger.error({ err: error }, "Compile error:");
        stopHeartbeat?.();
        stopHeartbeat = null;
        if (!res.headersSent) {
          res.status(500).json({ message: sanitizeSseError(error, "Failed to compile paper") });
        } else {
          res.write(
            `data: ${JSON.stringify({ type: "error", error: sanitizeSseError(error, "Compile failed") })}\n\n`,
          );
          res.end();
        }
      }
    },
  );

  app.post(
    "/api/chat/conversations/:id/verify",
    requireAuth,
    aiLimiter,
    requireTier("pro"),
    checkTokenBudget,
    async (req: Request, res: Response) => {
      let stopHeartbeat: (() => void) | null = null;

      try {
        const conv = await getOwnedConversationOr404(req, res);
        if (!conv) return;

        const { compiledContent } = req.body;
        if (!compiledContent || typeof compiledContent !== "string") {
          return res.status(400).json({ message: "compiledContent is required" });
        }

        const models = getModelsForConversation(conv);
        const style = conv.citationStyle || "chicago";
        const { project, sources } = await loadConversationContext(conv, req.user!.userId);
        const verifyPrompt = buildVerifyPrompt({
          compiledContent,
          project,
          sources,
          style,
        });

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");

        const anthropic = getAnthropicClient();
        let aborted = false;

        req.on("close", () => {
          aborted = true;
          stopHeartbeat?.();
          stopHeartbeat = null;
        });

        stopHeartbeat = startSseHeartbeat(res, { isClosed: () => aborted });

        const stream = anthropic.messages.stream({
          model: models.verify,
          max_tokens: VERIFY_MAX_TOKENS,
          messages: [{ role: "user", content: verifyPrompt }],
        });

        stream.on("text", (text) => {
          if (!aborted) {
            res.write(`data: ${JSON.stringify({ type: "text", text })}\n\n`);
          }
        });

        stream.on("message", async (message) => {
          await recordUserTokenUsage(
            req.user!.userId,
            getUsageTokenTotal(message?.usage),
            "chat_verify",
          );
          if (!aborted) {
            stopHeartbeat?.();
            stopHeartbeat = null;
            res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
            res.end();
          }
        });

        stream.on("error", (error) => {
          logger.error({ err: error }, "Verify stream error:");
          if (!aborted) {
            stopHeartbeat?.();
            stopHeartbeat = null;
            res.write(
              `data: ${JSON.stringify({ type: "error", error: sanitizeSseError(error, "Verify failed") })}\n\n`,
            );
            res.end();
          }
        });
      } catch (error) {
        logger.error({ err: error }, "Verify error:");
        stopHeartbeat?.();
        stopHeartbeat = null;
        if (!res.headersSent) {
          res.status(500).json({ message: sanitizeSseError(error, "Failed to verify paper") });
        } else {
          res.write(
            `data: ${JSON.stringify({ type: "error", error: sanitizeSseError(error, "Verify failed") })}\n\n`,
          );
          res.end();
        }
      }
    },
  );
}
