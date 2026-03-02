# SourceAnnotator - Codebase Documentation

A full-stack AI-powered research annotation tool for analyzing documents, creating annotations, and managing research projects.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Project Structure](#project-structure)
3. [Frontend Architecture](#frontend-architecture)
4. [Backend Architecture](#backend-architecture)
5. [Shared Code](#shared-code)
6. [Database Schema](#database-schema)
7. [AI Pipeline](#ai-pipeline)
8. [Writing Assistant (Tool Use)](#writing-assistant-tool-use)
9. [API Endpoints](#api-endpoints)
10. [Key Features](#key-features)
11. [Development](#development)

---

## Tech Stack

### Backend
| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | - | Runtime |
| Express.js | 4.21.2 | Web framework |
| TypeScript | 5.6.3 | Type safety |
| SQLite | - | Database |
| better-sqlite3 | 12.6.2 | SQLite driver |
| Drizzle ORM | 0.39.3 | Database ORM |
| OpenAI API | - | AI analysis (gpt-4o-mini, text-embedding-3-small) |
| Anthropic SDK | 0.78.0 | Writing assistant chat (claude-haiku-4-5) with native tool use |
| pdf-parse | 2.4.5 | PDF text extraction |
| multer | 2.0.2 | File uploads |

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18.3.1 | UI framework |
| Vite | 7.3.0 | Build tool |
| TanStack Query | 5.60.5 | Server state management |
| wouter | 3.3.5 | Routing |
| Tailwind CSS | 3.4.17 | Styling |
| Radix UI | - | Accessible components |
| shadcn/ui | - | Component library |
| lucide-react | 0.453.0 | Icons |
| Zod | 3.25.76 | Validation |

---

## Project Structure

```
SourceAnnotator/
├── client/                    # React frontend
│   ├── index.html
│   └── src/
│       ├── main.tsx          # Entry point
│       ├── App.tsx           # Router setup
│       ├── index.css         # Global styles
│       ├── components/       # React components
│       │   ├── ui/           # shadcn/ui components (50+)
│       │   ├── chat/         # Chat UI components
│       │   │   ├── ChatInput.tsx
│       │   │   ├── ChatMessages.tsx
│       │   │   ├── ChatSidebar.tsx
│       │   │   ├── DocumentCard.tsx      # Renders document output cards
│       │   │   └── ThinkingIndicator.tsx # Animated tool status pills
│       │   └── *.tsx         # Feature components
│       ├── pages/            # Page components
│       ├── hooks/            # Custom React hooks
│       └── lib/              # Utilities
├── server/                    # Express backend
│   ├── index.ts              # Server entry
│   ├── db.ts                 # Database setup
│   ├── routes.ts             # Main API routes
│   ├── chatRoutes.ts         # Chat conversation + writing assistant routes
│   ├── chatStorage.ts        # Conversation/message storage layer
│   ├── projectRoutes.ts      # Project API routes
│   ├── storage.ts            # Document storage layer
│   ├── projectStorage.ts     # Project storage layer
│   ├── openai.ts             # OpenAI integration
│   ├── pipelineV2.ts         # AI annotation pipeline
│   ├── chunker.ts            # Text chunking
│   ├── citationGenerator.ts  # Chicago-style citations
│   ├── projectSearch.ts      # Search functionality
│   ├── contextGenerator.ts   # Context/embeddings
│   ├── toolDefinitions.ts    # 7 Anthropic tool schemas for writing assistant
│   ├── toolExecutor.ts       # Tool dispatch + execution logic
│   └── chunkLoader.ts        # Shared document/chunk loading utilities
├── shared/                    # Shared types
│   └── schema.ts             # Database schema + types
├── data/                      # SQLite database
│   └── sourceannotator.db
├── migrations/                # Drizzle migrations
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
└── drizzle.config.ts
```

---

## Frontend Architecture

### Pages

| File | Route | Purpose |
|------|-------|---------|
| `Home.tsx` | `/` | Single document annotation interface |
| `Projects.tsx` | `/projects` | Project list and creation |
| `ProjectWorkspace.tsx` | `/projects/:id` | Project view with documents/folders |
| `ProjectDocument.tsx` | `/projects/:projectId/documents/:docId` | Annotate document within project |
| `Chat.tsx` | `/chat/:conversationId?` | AI writing assistant with tool-use |

### Key Components

| Component | Purpose |
|-----------|---------|
| `DocumentViewer.tsx` | Displays document with scroll sync |
| `HighlightedText.tsx` | Renders text with color-coded highlights |
| `AnnotationSidebar.tsx` | Lists annotations with filtering/editing |
| `MultiPromptPanel.tsx` | Multi-prompt parallel analysis UI |
| `IntentPanel.tsx` | Single intent analysis input |
| `SearchPanel.tsx` | Document search interface |
| `FileUpload.tsx` | Drag-and-drop file upload |
| `ManualAnnotationDialog.tsx` | Create/edit annotations manually |
| `BatchAnalysisModal.tsx` | Batch analyze multiple documents |
| `BatchUploadModal.tsx` | Upload multiple documents at once |
| `ChatInput.tsx` | Expandable message input with send button |
| `ChatMessages.tsx` | Message display with markdown, document cards, thinking indicators |
| `ChatSidebar.tsx` | Conversation list with search, rename, delete |
| `DocumentCard.tsx` | Renders AI-written document sections with copy button |
| `ThinkingIndicator.tsx` | Animated status pill shown during tool execution |

### Custom Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useDocuments` | `useDocument.ts` | Document CRUD operations |
| `useAnnotations` | `useDocument.ts` | Annotation management |
| `useProjects` | `useProjects.ts` | Project CRUD |
| `useProjectAnnotations` | `useProjects.ts` | Project annotation management |
| `useAnalyzeMultiPrompt` | `useProjects.ts` | Multi-prompt analysis |
| `usePromptTemplates` | `useProjects.ts` | Prompt template CRUD |
| `useProjectSearch` | `useProjectSearch.ts` | Search within projects |
| `useConversations` | `useChat.ts` | Conversation CRUD operations |
| `useSendMessage` | `useChat.ts` | SSE streaming with tool status + document events |

### State Management

- **Server State**: TanStack React Query handles all API data
- **Local State**: React useState for UI state
- **Query Keys**: Path-based (`/api/documents`, `/api/projects/:id/annotations`)

---

## Backend Architecture

### Server Entry (`index.ts`)

```typescript
// Initializes Express app
// Registers routes
// Serves static files in production
// Starts on port 5001
```

### Route Files

| File | Base Path | Purpose |
|------|-----------|---------|
| `routes.ts` | `/api` | Documents, annotations, basic operations |
| `projectRoutes.ts` | `/api` | Projects, folders, batch analysis, templates |
| `chatRoutes.ts` | `/api/chat` | Conversations, messages, writing assistant with tool-use loop |

### Storage Layers

| File | Tables | Operations |
|------|--------|------------|
| `storage.ts` | documents, textChunks, annotations | CRUD for documents/annotations |
| `projectStorage.ts` | projects, folders, projectDocuments, projectAnnotations, promptTemplates | Project-scoped CRUD |
| `chatStorage.ts` | conversations, messages | Conversation/message CRUD |

### AI Integration

| File | Purpose |
|------|---------|
| `openai.ts` | OpenAI API client, embeddings, analysis prompts |
| `pipelineV2.ts` | 3-phase annotation pipeline (Generator→Verifier→Refiner) |
| `chunker.ts` | Split documents into analyzable chunks |
| `contextGenerator.ts` | Generate document summaries and embeddings |

### Writing Assistant (Tool Use)

| File | Purpose |
|------|---------|
| `toolDefinitions.ts` | 7 Anthropic tool schemas (search_sources, write_section, etc.) |
| `toolExecutor.ts` | Dispatches tool calls to appropriate handler functions |
| `chunkLoader.ts` | Shared utilities for loading document text and surrounding context |

### Other Modules

| File | Purpose |
|------|---------|
| `citationGenerator.ts` | Chicago-style footnotes and bibliographies |
| `projectSearch.ts` | Semantic search with embeddings |
| `vite.ts` | Vite dev server integration |
| `static.ts` | Static file serving |

---

## Shared Code

### `shared/schema.ts`

Contains all database schemas and TypeScript types using Drizzle ORM + Zod.

#### Database Tables

| Table | Purpose |
|-------|---------|
| `documents` | Uploaded documents (filename, fullText, summary, embedding) |
| `textChunks` | Document segments for analysis |
| `annotations` | Highlights with notes and categories |
| `projects` | Research projects |
| `folders` | Hierarchical folder structure |
| `projectDocuments` | Links documents to projects |
| `projectAnnotations` | Project-scoped annotations |
| `promptTemplates` | Saved prompt sets per project |
| `conversations` | Chat conversations (optional projectId for writing mode) |
| `messages` | Chat messages (user + assistant, stores `<document>` tags inline) |
| `users` | Legacy user management |

#### Key Types

```typescript
// Annotation categories
type AnnotationCategory =
  | 'key_quote'
  | 'argument'
  | 'evidence'
  | 'methodology'
  | 'user_added';

// Citation data for Chicago style
interface CitationData {
  sourceType: 'book' | 'journal' | 'website' | 'newspaper' | 'chapter' | 'thesis' | 'other';
  authors: Array<{ firstName: string; lastName: string }>;
  title: string;
  publisher?: string;
  publicationDate?: string;
  // ... more fields
}

// Search result
interface SearchResult {
  chunkId: string;
  text: string;
  similarity: number;
  startPosition: number;
  endPosition: number;
}
```

---

## Database Schema

### Entity Relationship

```
documents (1) ─────────────── (N) textChunks
     │
     │ (N)
     ▼
annotations

projects (1) ─────────────── (N) folders
     │                            │
     │ (N)                        │ (N)
     ▼                            ▼
projectDocuments ◄────────────────┘
     │
     │ (N)
     ▼
projectAnnotations

projects (1) ─────────────── (N) promptTemplates

projects (1) ─────────────── (N) conversations
                                      │
                                      │ (N)
                                      ▼
                                   messages
```

### Key Fields

**documents**
- `id`, `filename`, `fullText`, `summary`, `embedding`, `createdAt`

**annotations**
- `id`, `documentId`, `startPosition`, `endPosition`, `highlightedText`
- `category`, `note`, `isAiGenerated`, `confidenceScore`
- `promptText`, `promptIndex`, `promptColor`, `analysisRunId` (multi-prompt support)

**projects**
- `id`, `name`, `description`, `thesis`, `scope`
- `contextSummary`, `contextEmbedding`

**projectAnnotations**
- Same as annotations + `projectDocumentId`

**promptTemplates**
- `id`, `projectId`, `name`, `prompts` (JSON array of {text, color})

**conversations**
- `id`, `userId`, `projectId` (nullable — links to project for writing mode), `title`, `model`, `createdAt`, `updatedAt`

**messages**
- `id`, `conversationId`, `role` (user/assistant/system), `content` (may contain `<document>` tags), `tokensUsed`, `createdAt`

---

## AI Pipeline

### Pipeline V2 Architecture (`pipelineV2.ts`)

```
Document Text
     │
     ▼
┌─────────────┐
│   Chunker   │  Split into ~2000 char chunks
└─────────────┘
     │
     ▼
┌─────────────┐
│  Generator  │  Create up to 3 candidate annotations per chunk
└─────────────┘  Model: gpt-4o-mini
     │
     ▼
┌─────────────┐
│  Verifier   │  Validate against hard/soft criteria
└─────────────┘  Hard: must pass | Soft: quality metrics
     │
     ▼
┌─────────────┐
│   Refiner   │  Improve approved candidates
└─────────────┘  Enhance notes, adjust positions
     │
     ▼
Final Annotations (with confidence scores)
```

### Multi-Prompt Analysis

```typescript
// Runs multiple prompts in parallel
async function processChunksWithMultiplePrompts(
  chunks: Chunk[],
  prompts: Array<{ text: string; color: string; index: number }>,
  documentId: string,
  fullText: string,
  existingAnnotations: Annotation[]
): Promise<Map<number, PipelineAnnotation[]>>

// Each prompt gets its own color for visual distinction
const PROMPT_COLORS = [
  '#ef4444', // red
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
];
```

### Thoroughness Levels

| Level | Chunks Analyzed | Use Case |
|-------|-----------------|----------|
| `quick` | 25% | Fast preview |
| `standard` | 50% | Default |
| `thorough` | 75% | Detailed analysis |
| `exhaustive` | 100% | Complete coverage |

---

## Writing Assistant (Tool Use)

### Overview

The writing assistant uses **Anthropic native tool_use** — Claude picks the right tool for each situation rather than relying on regex-parsed XML tags. Conversations linked to a project get access to 7 writing tools; conversations without a project work as a simple chat.

### Architecture

```
POST /api/chat/conversations/:id/messages
  → Save user message
  → Load history, project context, sources
  → Build system prompt (with tool guidance if project-linked)
  → SSE headers

  LOOP (max 5 iterations):
    → anthropic.messages.stream({ tools, messages })
    → Stream text → SSE "text" events
    → If stop_reason === "end_turn" → break
    → If stop_reason === "tool_use":
        → For each tool call:
            → Emit SSE tool_status { status: "running", label }
            → Execute tool via toolExecutor
            → If isDocument → emit document_start/text/end SSE
            → Emit SSE tool_status { status: "complete" }
        → Append assistant message + tool_results to messages
        → Continue loop

  → Save final message to DB (text + <document> tags)
  → SSE "done" event
```

### 7 Tools

| Tool | Purpose | Returns Document? |
|------|---------|:-----------------:|
| `search_sources` | Search project sources by topic/keyword | No |
| `request_annotation_context` | Get surrounding text for a passage | No |
| `deep_source_analysis` | In-depth analysis of a full source document | No |
| `propose_outline` | Create structured paper outline | No |
| `write_section` | Write a specific paper section | Yes |
| `compile_paper` | Stitch sections into final paper | Yes |
| `verify_citations` | Check citations against loaded sources | No |

### Tool Execution Flow

```
toolDefinitions.ts          toolExecutor.ts              Existing Modules
┌──────────────┐    ┌────────────────────────┐    ┌──────────────────┐
│ WRITING_TOOLS│    │ executeToolCall()       │    │                  │
│ (7 schemas)  │───►│   search_sources ──────────► │ globalSearch()   │
│              │    │   request_annotation ──────► │ loadSurrounding  │
│ STATUS_LABELS│    │   deep_source_analysis ────► │ loadDocumentText │
│              │    │   propose_outline ─────────► │ Anthropic API    │
│              │    │   write_section ───────────► │ Anthropic API    │
│              │    │   compile_paper ───────────► │ Anthropic API    │
│              │    │   verify_citations ────────► │ globalSearch()   │
└──────────────┘    └────────────────────────┘    └──────────────────┘
```

### SSE Event Types

| Event | Fields | Purpose |
|-------|--------|---------|
| `text` | `{ type, text }` | Streamed text from Claude |
| `tool_status` | `{ type, tool, status, label? }` | Tool running/complete indicator |
| `document_start` | `{ type, title }` | Document card starting |
| `document_text` | `{ type, text }` | Document content |
| `document_end` | `{ type, title }` | Document card complete |
| `done` | `{ type, usage }` | Stream finished |
| `error` | `{ type, error }` | Error occurred |

### Client Rendering

- **ThinkingIndicator**: Animated pill with per-tool icon (Search, Brain, PenLine, etc.) shown during tool execution
- **DocumentCard**: Renders `<document title="...">` blocks from stored messages with title bar, word count, preview, and copy button
- **parseMessageContent()**: Regex splits assistant messages into text segments and document blocks for mixed rendering

### System Prompt (Project-Linked Conversations)

When a conversation has a `projectId`, the system prompt includes:
- Project name and thesis
- List of loaded source documents with summaries
- Tool guidance explaining when to use each tool
- Conversation flow phases: Discover → Research → Plan → Write → Compile → Verify
- Quoting rules for citation formatting

### DB Storage

- Tool calls happen within a single request's agentic loop — tool_use blocks are not persisted
- Document-producing tools wrap output in `<document title="...">...</document>` tags in the stored message content
- Old messages render correctly — `parseMessageContent()` handles both plain text and tagged content

---

## API Endpoints

### Document APIs (`routes.ts`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/upload` | Upload document (PDF/TXT) |
| GET | `/api/documents` | List all documents |
| GET | `/api/documents/:id` | Get document by ID |
| DELETE | `/api/documents/:id` | Delete document |
| GET | `/api/documents/:id/annotations` | Get document annotations |
| POST | `/api/annotations` | Create annotation |
| PUT | `/api/annotations/:id` | Update annotation |
| DELETE | `/api/annotations/:id` | Delete annotation |
| POST | `/api/intent` | Run single-intent analysis |
| POST | `/api/search` | Search across documents |

### Project APIs (`projectRoutes.ts`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/projects` | List projects |
| POST | `/api/projects` | Create project |
| GET | `/api/projects/:id` | Get project |
| PUT | `/api/projects/:id` | Update project |
| DELETE | `/api/projects/:id` | Delete project |
| GET | `/api/projects/:id/folders` | Get project folders |
| POST | `/api/projects/:id/folders` | Create folder |
| GET | `/api/projects/:id/documents` | Get project documents |
| POST | `/api/projects/:id/documents` | Add document to project |
| POST | `/api/projects/:id/documents/batch` | Add multiple documents |
| POST | `/api/projects/:id/batch-analyze` | Batch analyze documents |
| GET | `/api/project-documents/:id` | Get project document |
| POST | `/api/project-documents/:id/analyze` | Analyze single document |
| POST | `/api/project-documents/:id/analyze-multi` | Multi-prompt analysis |
| POST | `/api/project-documents/:id/search` | Search within document |
| GET | `/api/project-documents/:id/annotations` | Get annotations |
| POST | `/api/project-documents/:id/annotations` | Create annotation |
| GET | `/api/projects/:id/prompt-templates` | Get prompt templates |
| POST | `/api/projects/:id/prompt-templates` | Save prompt template |
| DELETE | `/api/prompt-templates/:id` | Delete template |

### Chat APIs (`chatRoutes.ts`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/chat/conversations` | List all conversations (newest first) |
| POST | `/api/chat/conversations` | Create conversation (optional `projectId` for writing mode) |
| GET | `/api/chat/conversations/:id` | Get conversation with messages |
| PUT | `/api/chat/conversations/:id` | Update title/model |
| DELETE | `/api/chat/conversations/:id` | Delete conversation |
| POST | `/api/chat/conversations/:id/messages` | Send message + stream response (SSE, tool-use loop) |

### Citation APIs

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/citations/generate` | Generate citation from metadata |
| POST | `/api/citations/ai` | Extract citation from document with AI |
| POST | `/api/project-annotations/:id/footnote` | Generate footnote with quote |

---

## Key Features

### 1. Document Upload & Processing
- Supports PDF and TXT files
- Extracts text and creates searchable chunks
- Generates document summaries and embeddings

### 2. AI-Powered Annotation
- 3-phase pipeline ensures quality
- Confidence scores for each annotation
- Categories: Key Quote, Argument, Evidence, Methodology, User Note

### 3. Multi-Prompt Analysis
- Add multiple focused research questions
- Run all prompts in parallel
- Color-coded results by prompt
- Filter annotations by prompt source
- Save prompt sets as reusable templates

### 4. Project Management
- Organize documents into projects
- Hierarchical folders within projects
- Project-level context (thesis, scope)
- Batch analysis across multiple documents

### 5. Search & Retrieval
- Semantic search using embeddings
- Search within document or across project
- Cosine similarity ranking

### 6. Citation Generation
- Chicago-style footnotes and bibliographies
- AI-assisted metadata extraction
- Copy footnotes with quotes

### 7. Manual Annotation
- Highlight text to annotate
- Edit AI-generated annotations
- Add personal notes

### 8. AI Writing Assistant
- Chat-based writing interface with Anthropic Claude
- 7 native tools for source research, outlining, writing, compiling, and citation verification
- Project-linked conversations automatically get access to uploaded sources
- Agentic tool-use loop (up to 5 iterations per message)
- Real-time thinking indicators show which tool is running
- Document cards for reviewable section output with copy functionality
- Conversation history with auto-titling, search, rename, delete

---

## Development

### Scripts

```bash
npm run dev        # Start development server (port 5001)
npm run build      # Build for production
npm run start      # Run production server
npm run check      # TypeScript type checking
npm run db:push    # Apply database migrations (IMPORTANT: run after schema changes)
npm run db:generate # Generate migration files
```

### Important: After Schema Changes

When modifying `shared/schema.ts` (adding columns, tables, etc.), you **must** run:

```bash
npm run db:push
```

This syncs the TypeScript schema definitions with the actual SQLite database. Without this step, you'll get errors like `no such column: "column_name"`.

### Environment Variables

```env
OPENAI_API_KEY=sk-...       # Required for annotation pipeline + embeddings
ANTHROPIC_API_KEY=sk-ant-...  # Required for writing assistant chat
DATABASE_URL=./data/sourceannotator.db
```

### Path Aliases

```typescript
// In imports:
import { Button } from "@/components/ui/button";  // client/src/...
import { schema } from "@shared/schema";          // shared/...
```

### Type Safety

- Strict TypeScript throughout
- Zod validation on API boundaries
- Shared types between frontend/backend
- Drizzle ORM for type-safe queries

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                     Frontend (React + Vite)                       │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  ┌──────────────────┐ │
│  │  Pages  │  │Components│  │   Hooks   │  │  TanStack Query  │ │
│  │         │  │  chat/   │  │ useChat.ts│  │                  │ │
│  └────┬────┘  └────┬─────┘  └─────┬─────┘  └────────┬─────────┘ │
└───────┼────────────┼──────────────┼──────────────────┼───────────┘
        │            │              │                  │
        └────────────┴──────────────┴──────────────────┘
                            │
                  HTTP/REST + SSE (streaming)
                            │
┌───────────────────────────┼──────────────────────────────────────┐
│                     Backend (Express)                             │
│                                                                  │
│  ┌──────────────┐  ┌────────────────────────────────────────┐    │
│  │   routes.ts  │  │         chatRoutes.ts                  │    │
│  │  projectRts  │  │  ┌─────────────────────────────────┐   │    │
│  └──────┬───────┘  │  │   runToolUseLoop() (agentic)    │   │    │
│         │          │  │   ┌─────────────┐ ┌───────────┐ │   │    │
│         │          │  │   │ toolDefs.ts │ │toolExec.ts│ │   │    │
│         │          │  │   │ (7 schemas) │ │(dispatch) │ │   │    │
│         │          │  │   └──────┬──────┘ └─────┬─────┘ │   │    │
│         │          │  └──────────┼──────────────┼───────┘   │    │
│         │          └─────────────┼──────────────┼───────────┘    │
│         │                        │              │                │
│  ┌──────┴───────┐  ┌────────────┴──┐  ┌────────┴─────────┐      │
│  │   Storage    │  │    OpenAI     │  │    Anthropic     │      │
│  │  (Drizzle)   │  │  (gpt-4o-mini)│  │(claude-haiku-4-5)│      │
│  └──────┬───────┘  └───────────────┘  └──────────────────┘      │
└─────────┼────────────────────────────────────────────────────────┘
          │
    Drizzle ORM
          │
┌─────────┼────────────────────────────────────────────────────────┐
│                    Database (SQLite)                              │
│  documents │ annotations │ projects │ conversations │ messages   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Recent Changes

### Writing Assistant with Anthropic Tool Use (Latest)

Converted the chat system to use **Anthropic native tool_use** for an agentic writing assistant:

- **New files**: `toolDefinitions.ts` (7 tool schemas), `toolExecutor.ts` (dispatch + execution), `chunkLoader.ts` (shared doc loading)
- **chatRoutes.ts**: Complete rewrite with `runToolUseLoop()` — agentic loop that streams text + executes tools + sends results back to Claude (max 5 iterations)
- **Schema**: Added `projectId` to `conversations` table (nullable FK to `projects`) — conversations linked to a project get tool access
- **SSE events**: New `tool_status`, `document_start`, `document_text`, `document_end` events for real-time UI feedback
- **Client**: `useSendMessage` hook handles new events; `ThinkingIndicator` component shows animated status pills during tool execution; `DocumentCard` renders `<document>` tagged content; `ChatMessages` uses `parseMessageContent()` to split text vs document blocks
- **Tools**: search_sources, request_annotation_context, deep_source_analysis, propose_outline, write_section (document), compile_paper (document), verify_citations

### Multi-Prompt Parallel Annotation System

Added the ability to run multiple analysis prompts in parallel:

- **Schema**: Added `promptText`, `promptIndex`, `promptColor`, `analysisRunId` to annotations
- **Backend**: `processChunksWithMultiplePrompts()` runs prompts via `Promise.all`
- **Frontend**: `MultiPromptPanel` component for managing multiple prompts
- **Templates**: Save/load prompt sets per project
- **Filtering**: Filter annotations by source prompt in sidebar
- **Visual**: Color-coded highlights based on prompt source

---

*Last updated: March 2026*
