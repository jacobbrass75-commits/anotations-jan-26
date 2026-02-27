import type { Express, Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { chatStorage } from "./chatStorage";

const SYSTEM_PROMPT =
  "You are ScholarMark AI, a helpful academic writing assistant. You help students with research, writing, citations, and understanding academic sources. Be concise, accurate, and helpful.";

function getAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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
      const { title, model } = req.body || {};
      const conv = await chatStorage.createConversation({
        title: title || "New Chat",
        model: model || "claude-haiku-4-5",
        userId: null, // nullable until auth is merged
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

  // Send message + get streaming response
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

      // Build messages array for Anthropic (filter out system messages)
      const anthropicMessages = history
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

      const stream = anthropic.messages.stream({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
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
}
