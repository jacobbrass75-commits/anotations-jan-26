# TASK: Chat System (feature/chat)

**Workstream:** Chat Backend + UI
**Branch:** `feature/chat`
**Worktree:** `sm-chat/`
**Dependencies:** Auth (mock it during dev — use a hardcoded test userId)

---

## Objective

Build a ChatGPT-style chat interface with conversation history, streaming responses, and Anthropic Claude integration. The chat UI is a new top-level route `/chat`.

---

## Schema Changes (`shared/schema.ts`)

Add two new tables:

```typescript
export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey().$defaultFn(genId),
  userId: text("user_id"), // nullable until auth is merged
  title: text("title").notNull().default("New Chat"),
  model: text("model").notNull().default("claude-haiku-4-5"), // claude-haiku-4-5 or claude-sonnet-4-6
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey().$defaultFn(genId),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // "user" | "assistant" | "system"
  content: text("content").notNull(),
  tokensUsed: integer("tokens_used").default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});
```

Add relations:
```typescript
export const conversationsRelations = relations(conversations, ({ many }) => ({
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));
```

Add insert schemas:
```typescript
export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversations.$inferSelect;

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true, createdAt: true,
});
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;
```

---

## Files to Create/Modify

### 1. `server/chatStorage.ts` (NEW)

Storage layer for conversations and messages:
- `createConversation(data): Promise<Conversation>`
- `getConversation(id): Promise<Conversation | null>`
- `getConversationsForUser(userId?: string): Promise<Conversation[]>` — ordered by updatedAt desc
- `updateConversation(id, data): Promise<Conversation>`
- `deleteConversation(id): Promise<void>`
- `getMessagesForConversation(id): Promise<Message[]>` — ordered by createdAt asc
- `createMessage(data): Promise<Message>`

### 2. `server/chatRoutes.ts` (NEW)

Install Anthropic SDK: `npm install @anthropic-ai/sdk`

Endpoints:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/chat/conversations` | List all conversations (newest first) |
| POST | `/api/chat/conversations` | Create new conversation |
| GET | `/api/chat/conversations/:id` | Get conversation with messages |
| DELETE | `/api/chat/conversations/:id` | Delete conversation |
| PUT | `/api/chat/conversations/:id` | Update conversation (title, model) |
| POST | `/api/chat/conversations/:id/messages` | Send message + get streaming response |

**The streaming endpoint (`POST /api/chat/conversations/:id/messages`):**

1. Receive `{ content: string }` in body
2. Save user message to DB
3. Load full conversation history from DB
4. Build Anthropic API request:
   ```typescript
   const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

   const stream = anthropic.messages.stream({
     model: "claude-haiku-4-5-20251001", // or claude-sonnet-4-5-20250929 for Max
     max_tokens: 4096,
     system: "You are ScholarMark AI, a helpful academic writing assistant. You help students with research, writing, citations, and understanding academic sources. Be concise, accurate, and helpful.",
     messages: conversationHistory.map(m => ({
       role: m.role as "user" | "assistant",
       content: m.content,
     })),
   });
   ```
5. Stream response via SSE:
   ```typescript
   res.setHeader("Content-Type", "text/event-stream");
   res.setHeader("Cache-Control", "no-cache");
   res.setHeader("Connection", "keep-alive");

   stream.on("text", (text) => {
     res.write(`data: ${JSON.stringify({ type: "text", text })}\n\n`);
   });

   stream.on("message", (message) => {
     // Save complete assistant message to DB
     // Send final event with token usage
     res.write(`data: ${JSON.stringify({ type: "done", usage: message.usage })}\n\n`);
     res.end();
   });
   ```
6. Auto-generate conversation title from first message (use first 50 chars or ask Claude for a title)

### 3. Register routes in `server/routes.ts`

Add at end of `registerRoutes`:
```typescript
import { registerChatRoutes } from "./chatRoutes";
registerChatRoutes(app);
```

### 4. Frontend: `client/src/pages/Chat.tsx` (NEW)

The main chat page at route `/chat`. Layout:

```
┌────────────────┬─────────────────────────────────────┐
│  SIDEBAR       │  MAIN CHAT AREA                     │
│  250px fixed   │                                     │
│                │  ┌─────────────────────────────────┐ │
│  [+ New Chat]  │  │  Messages scroll area           │ │
│                │  │                                  │ │
│  Search...     │  │  User bubble (right-aligned)     │ │
│                │  │  AI bubble (left-aligned)        │ │
│  Today         │  │  User bubble                     │ │
│  - Chat title  │  │  AI bubble (streaming...)        │ │
│  - Chat title  │  │                                  │ │
│                │  └─────────────────────────────────┘ │
│  Yesterday     │  ┌─────────────────────────────────┐ │
│  - Chat title  │  │  Input area                     │ │
│  - Chat title  │  │  [textarea] [Send button]       │ │
│                │  └─────────────────────────────────┘ │
└────────────────┴─────────────────────────────────────┘
```

**Components to create:**

### 5. `client/src/components/chat/ChatSidebar.tsx` (NEW)
- List of conversations grouped by date (Today, Yesterday, Previous 7 Days, Older)
- New Chat button at top
- Search/filter conversations
- Click to switch conversation
- Right-click or hover menu to rename/delete
- Active conversation highlighted
- Use shadcn ScrollArea, Input, Button

### 6. `client/src/components/chat/ChatMessages.tsx` (NEW)
- Renders list of messages
- User messages: right-aligned, primary color background
- Assistant messages: left-aligned, card background
- Markdown rendering for assistant messages using `react-markdown` (install: `npm install react-markdown`)
- Code blocks with syntax highlighting
- Streaming text with cursor animation
- Auto-scroll to bottom on new messages
- Empty state: "Start a new conversation" with suggested prompts

### 7. `client/src/components/chat/ChatInput.tsx` (NEW)
- Auto-resizing textarea (grows up to 6 lines)
- Send button (or Enter to send, Shift+Enter for newline)
- Disabled while streaming
- Character count indicator

### 8. `client/src/hooks/useChat.ts` (NEW)
- `useConversations()` — TanStack Query for conversation list
- `useConversation(id)` — single conversation with messages
- `useSendMessage()` — mutation that handles SSE streaming
- `useCreateConversation()` — creates new conversation
- `useDeleteConversation()` — deletes conversation

SSE streaming hook pattern:
```typescript
function useSendMessage(conversationId: string) {
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  const send = async (content: string) => {
    setIsStreaming(true);
    setStreamingText("");

    const response = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      // Parse SSE events, accumulate text
      // Update streamingText state
    }

    setIsStreaming(false);
    // Invalidate conversation query to refresh messages
  };

  return { send, streamingText, isStreaming };
}
```

### 9. Modify `client/src/App.tsx`

Add route:
```typescript
<Route path="/chat" component={Chat} />
<Route path="/chat/:conversationId" component={Chat} />
```

Add navigation link to chat in the header/nav.

---

## Install Dependencies

```bash
npm install @anthropic-ai/sdk react-markdown
```

---

## Environment Variables

Add to `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
```

---

## After Implementation

```bash
npm run db:push
npm run check
npm run dev
```

Test:
1. Navigate to `/chat`
2. Create new conversation
3. Send a message, verify streaming response
4. Check sidebar shows conversation with auto-generated title
5. Switch between conversations
6. Delete a conversation

---

## Important Notes

- Until auth is merged, userId is nullable. Use a hardcoded test userId or leave null.
- The system prompt positions ScholarMark as an academic assistant, not a general chatbot.
- Model selection: default to `claude-haiku-4-5-20251001`. The model field on conversations allows upgrading later per tier.
- Keep the SSE format simple: `data: {"type":"text","text":"..."}\n\n` for chunks, `data: {"type":"done","usage":{...}}\n\n` for completion.
- Auto-title: after the first assistant response, update the conversation title to the first ~50 chars of the user's first message, or ask Claude to generate a 3-5 word title.
