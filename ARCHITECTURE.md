# ScholarMark Architecture Reference

> Generated 2026-02-27. Covers the full codebase of `anotations-jan-26`.

---

## Table of Contents

1. [Tech Stack](#1-tech-stack)
2. [App Routes & Pages](#2-app-routes--pages)
3. [Server Entry & Middleware](#3-server-entry--middleware)
4. [Database Schema](#4-database-schema)
5. [Authentication System](#5-authentication-system)
6. [Document Upload & Processing](#6-document-upload--processing)
7. [Project System](#7-project-system)
8. [Annotation System](#8-annotation-system)
9. [Chat System (Standalone)](#9-chat-system-standalone)
10. [Writing System (Chat-Based)](#10-writing-system-chat-based)
11. [Writing System (One-Shot Pipeline)](#11-writing-system-one-shot-pipeline)
12. [Source Injection & Formatting](#12-source-injection--formatting)
13. [Citation System](#13-citation-system)
14. [Document Export (PDF / DOCX)](#14-document-export-pdf--docx)
15. [Web Clips & Chrome Extension](#15-web-clips--chrome-extension)
16. [Environment Variables](#16-environment-variables)
17. [All API Endpoints](#17-all-api-endpoints)

---

## 1. Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | React + TypeScript | React 18.3, TS 5.6 |
| Routing | Wouter | 3.3 |
| Data fetching | TanStack React Query | 5.60 |
| UI | Radix UI / Shadcn | - |
| Build | Vite | 7.3 |
| Backend | Express.js | 4.21 |
| Database | SQLite via Drizzle ORM | drizzle-orm 0.39 |
| AI | Anthropic SDK | 0.78 |
| Auth | JWT + bcrypt | jsonwebtoken 9, bcrypt 6 |
| PDF gen | pdf-lib | 1.17 |
| DOCX gen | JSZip | - |
| File uploads | Multer | 2.0 (50 MB limit) |
| Image processing | Sharp | 0.34 |
| PDF text extraction | pdf-parse | 2.4 |
| Markdown rendering | react-markdown | - |

**Database file:** `data/sourceannotator.db`
**Default port:** `5001`

---

## 2. App Routes & Pages

Defined in `client/src/App.tsx`. All content routes are wrapped in `<ProtectedRoute>`.

| Route | Component | Auth | Purpose |
|-------|-----------|------|---------|
| `/login` | Login | No | Sign in |
| `/register` | Register | No | Create account |
| `/` | Home | Yes | Dashboard |
| `/projects` | Projects | Yes | Project list |
| `/web-clips` | WebClips | Yes | Web clip collection |
| `/projects/:id` | ProjectWorkspace | Yes | Project workspace (Documents + Write tabs) |
| `/projects/:projectId/documents/:docId` | ProjectDocument | Yes | Document viewer with annotations |
| `/chat` | Chat | Yes | Standalone chatbot |
| `/chat/:conversationId` | Chat | Yes | Specific conversation |
| `/write` | WritingPage | Yes | Chat-based writing (alias) |
| `/writing` | WritingPage | Yes | Chat-based writing |

---

## 3. Server Entry & Middleware

**File:** `server/index.ts`

Startup order:
1. Load `.env` via dotenv
2. Create Express app + HTTP server
3. CORS (allows chrome-extension, localhost, 89.167.10.34, `ALLOWED_ORIGINS`)
4. `express.json()` with raw body capture
5. Passport auth setup
6. Auth routes registered first
7. All other routes via `registerRoutes()`
8. Vite dev server (dev) or static file serving (prod)
9. Listen on port 5001

**Request logging:** All `/api` endpoints logged with duration, status code, and truncated response body.

---

## 4. Database Schema

**File:** `shared/schema.ts`

### users
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| email | TEXT UNIQUE | |
| username | TEXT UNIQUE | |
| password | TEXT | bcrypt hash (12 rounds) |
| firstName, lastName | TEXT | Optional |
| tier | TEXT | "free" / "pro" / "max" |
| tokensUsed | INT | AI token counter |
| tokenLimit | INT | Default: 50,000 (free) |
| storageUsed | INT | Bytes |
| storageLimit | INT | Default: 50 MB (free) |
| emailVerified | BOOL | |
| billingCycleStart | INT | Timestamp |
| createdAt, updatedAt | INT | Timestamps |

### documents
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| userId | TEXT | Owner |
| filename | TEXT | Original filename |
| fullText | TEXT | Extracted text content |
| uploadDate | INT | Timestamp |
| userIntent | TEXT | Analysis goal |
| summary | TEXT | AI-generated summary |
| mainArguments | JSON | string[] |
| keyConcepts | JSON | string[] |
| chunkCount | INT | Number of text chunks |
| status | TEXT | "ready" / "processing" / "error" |
| processingError | TEXT | Error message if failed |

### text_chunks
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| documentId | TEXT FK | -> documents(id) CASCADE |
| text | TEXT | Chunk content |
| startPosition | INT | Absolute char offset |
| endPosition | INT | Absolute char offset |
| sectionTitle | TEXT | Optional heading |
| embedding | JSON | number[] (vector) |

### annotations (document-level)
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| documentId | TEXT FK | -> documents(id) CASCADE |
| chunkId | TEXT | Optional source chunk |
| startPosition, endPosition | INT | Text positions |
| highlightedText | TEXT | Quoted text |
| category | TEXT | key_quote / argument / evidence / methodology / user_added |
| note | TEXT | Annotation content |
| isAiGenerated | BOOL | |
| confidenceScore | REAL | 0-1 |
| promptText | TEXT | Source prompt (multi-prompt) |
| promptIndex | INT | Which prompt in batch |
| promptColor | TEXT | UI color grouping |
| analysisRunId | TEXT | Batch job ID |
| createdAt | INT | |

### projects
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| userId | TEXT | Owner |
| name | TEXT | Project name |
| description | TEXT | |
| thesis | TEXT | Research thesis |
| scope | TEXT | Project scope |
| contextSummary | TEXT | AI-generated context |
| contextEmbedding | JSON | number[] |
| createdAt, updatedAt | INT | |

### folders
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| projectId | TEXT FK | -> projects(id) CASCADE |
| parentFolderId | TEXT | Self-referential (nested) |
| name | TEXT | |
| description | TEXT | |
| sortOrder | INT | |
| createdAt | INT | |

### project_documents (links documents to projects)
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| projectId | TEXT FK | -> projects(id) CASCADE |
| documentId | TEXT FK | -> documents(id) CASCADE |
| folderId | TEXT FK | -> folders(id) SET NULL |
| projectContext | TEXT | Role/context within project |
| roleInProject | TEXT | e.g. "primary source" |
| citationData | JSON | Structured citation metadata |
| lastViewedAt | INT | |
| scrollPosition | INT | |
| addedAt | INT | |

### project_annotations (project-scoped)
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| projectDocumentId | TEXT FK | -> project_documents(id) CASCADE |
| startPosition, endPosition | INT | |
| highlightedText | TEXT | |
| category | TEXT | Same 5 categories |
| note | TEXT | |
| isAiGenerated | BOOL | |
| confidenceScore | REAL | |
| promptText, promptIndex, promptColor | TEXT/INT/TEXT | Multi-prompt |
| analysisRunId | TEXT | |
| searchableContent | TEXT | Full-text search index |
| searchEmbedding | JSON | number[] |
| createdAt | INT | |

### conversations
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| userId | TEXT | Owner |
| projectId | TEXT FK | -> projects(id) SET NULL |
| title | TEXT | Default: "New Chat" |
| model | TEXT | Default: "claude-haiku-4-5" |
| selectedSourceIds | JSON | string[] (project doc IDs) |
| citationStyle | TEXT | Default: "chicago" |
| tone | TEXT | Default: "academic" |
| noEnDashes | BOOL | Default: false |
| createdAt, updatedAt | INT | |

### messages
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| conversationId | TEXT FK | -> conversations(id) CASCADE |
| role | TEXT | "user" / "assistant" / "system" |
| content | TEXT | Message text |
| tokensUsed | INT | Default: 0 |
| createdAt | INT | |

### prompt_templates
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| projectId | TEXT FK | -> projects(id) CASCADE |
| name | TEXT | Template name |
| prompts | JSON | Array<{text, color}> |
| createdAt | INT | |

### web_clips
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| userId | TEXT | |
| highlightedText | TEXT | |
| note, category | TEXT | |
| sourceUrl, pageTitle, siteName | TEXT | |
| authorName, publishDate | TEXT | |
| citationData | JSON | CitationData |
| footnote, bibliography | TEXT | Generated |
| projectId | TEXT FK | Optional |
| projectDocumentId | TEXT FK | Optional |
| surroundingContext | TEXT | |
| tags | JSON | string[] |
| createdAt | INT | |

---

## 5. Authentication System

**Files:** `server/auth.ts`, `server/authRoutes.ts`, `server/authStorage.ts`, `client/src/lib/auth.ts`

- **Method:** Stateless JWT (7-day expiry)
- **Password:** bcrypt with 12 salt rounds
- **Client storage:** `localStorage` key `scholarmark_token`
- **Header format:** `Authorization: Bearer <token>`
- **Middleware:** `requireAuth` (rejects 401) and `optionalAuth` (attaches user if present)
- **Tiers:** free (50K tokens, 50MB storage), pro, max

---

## 6. Document Upload & Processing

**File:** `server/routes.ts`

### Supported formats
- **PDF:** Standard text extraction via pdf-parse, or OCR modes (advanced, vision, vision_batch)
- **TXT:** Direct text extraction
- **Images:** PNG, JPG, JPEG, WEBP, GIF, BMP, TIF, TIFF, HEIC, HEIF -- always OCR'd

### Processing flow

**Synchronous (TXT, standard PDF):**
1. Extract text
2. Check for garbled text (scanned PDF detection)
3. Create document record with fullText
4. Save source file to `data/uploads/`
5. Chunk text (V2: 500 chars, 50 char overlap, sentence boundaries)
6. Store chunks in DB
7. Generate AI summary in background

**Async (OCR modes):**
1. Create document with empty fullText, status="processing"
2. Save source file
3. Enqueue OCR job
4. Return 202 Accepted
5. Job fills fullText, updates status -> "ready"

### Text chunking (V2)
- Target size: 500 characters
- Overlap: 50 characters between chunks
- Boundary: attempts sentence-end (". ", ".\n", "? ", "! ")
- Stored with absolute start/end positions

---

## 7. Project System

**Files:** `server/projectRoutes.ts`, `client/src/hooks/useProjects.ts`

A project contains:
- **Metadata:** name, description, thesis, scope
- **Documents:** linked via `project_documents` join table
- **Folders:** nested organization within the project
- **Annotations:** project-scoped annotations on project documents
- **Prompt templates:** saved multi-prompt analysis configurations
- **Web clips:** optional association
- **Conversations:** chat conversations linked to project

### Key operations
- **Add document to project:** Creates `project_document` record with optional citation data
- **Batch add:** Add multiple documents at once
- **Analyze document:** AI generates project annotations with categories and confidence
- **Multi-prompt analysis:** Run multiple prompts with color coding
- **Batch analyze:** Analyze multiple documents with constraints (categories, max per doc, min confidence)
- **Search:** Full-text search across all project documents with relevance ranking

---

## 8. Annotation System

### Categories
| Category | Description |
|----------|-------------|
| `key_quote` | Important quote from source |
| `argument` | Main argument or claim |
| `evidence` | Supporting evidence/data |
| `methodology` | Research method/approach |
| `user_added` | Manual user annotation |

### Two annotation layers

1. **Document-level** (`annotations` table): Global annotations on a document
2. **Project-level** (`project_annotations` table): Project-scoped, with search embedding

### AI Analysis Pipeline (V2)

```
Input: Document chunks + user intent
  |
Phase 1: Generator -- processes chunks, extracts candidate annotations (up to 5/chunk)
  |
Phase 2: Hard Verifier -- reviews candidates, approves/rejects, adjusts categories
  |
Phase 3: Soft Verifier & Refiner -- final scoring, position correction
  |
Output: Stored annotations with confidence scores
```

Thoroughness levels: quick, standard, thorough, exhaustive (controls how many chunks are analyzed)

---

## 9. Chat System (Standalone)

**Files:** `server/chatRoutes.ts`, `client/src/pages/Chat.tsx`, `client/src/hooks/useChat.ts`

**Route:** `/chat`

A simple conversational chatbot with no project context.

| Aspect | Detail |
|--------|--------|
| Model | `claude-haiku-4-5-20251001` |
| Max tokens | 4096 |
| System prompt | Generic ScholarMark AI assistant |
| Streaming | SSE with `{type: "text"/"done"/"error"}` events |
| Auto-title | Generated from first user message |

No source injection, no citation tracking. Just a helpful assistant.

---

## 10. Writing System (Chat-Based)

**Files:** `server/chatRoutes.ts`, `client/src/components/WritingChat.tsx`, `client/src/hooks/useWritingChat.ts`

**Route:** `/writing` (standalone) or Project Workspace -> Write tab

This is the primary writing workflow -- an iterative chat where the AI has access to project sources and can write paper sections on request.

### Layout (3-column)

```
+---------------+------------------+------------------+
|  Sidebar      |  Chat            |  Right Panel     |
|  (250px)      |  (flex)          |  (380px)         |
|               |                  |                  |
|  [New Chat]   |  Messages        |  Settings        |
|  Conv. list   |  + streaming     |  Sources         |
|  Search       |                  |  Compile/Verify  |
|  Rename/Del   |  [Input]         |  Compiled Paper  |
|               |                  |  Export buttons   |
+---------------+------------------+------------------+
```

### Chat Message Flow

1. User sends message
2. Server loads conversation history
3. Server loads project sources (filtered by `selectedSourceIds`)
4. Sources formatted and injected into system prompt
5. Claude responds with source-aware content

| Aspect | Detail |
|--------|--------|
| Model | `claude-haiku-4-5-20251001` |
| Max tokens | 4096 |
| System prompt | Source-aware (see [Section 12](#12-source-injection--formatting)) |
| Streaming | SSE |

### Compile Flow

User clicks "Compile Paper" -> server reads full conversation -> assembles into polished paper.

| Aspect | Detail |
|--------|--------|
| Model | `claude-sonnet-4-5-20241022` |
| Max tokens | 8192 |
| Endpoint | `POST /api/chat/conversations/:id/compile` |

**Compile prompt instructs Claude to:**
1. Extract ALL paper content from the conversation
2. Add smooth transitions between sections
3. Write introduction if missing
4. Write conclusion
5. Ensure consistent voice/tone
6. Include in-text citations in chosen style
7. Append complete bibliography
8. Strip conversational back-and-forth
9. Output markdown

**After compilation:** Paper auto-saved to project as a document.

### Verify Flow

User clicks "Verify" -> server sends compiled paper for review.

| Aspect | Detail |
|--------|--------|
| Model | `claude-haiku-4-5-20251001` |
| Max tokens | 4096 |
| Endpoint | `POST /api/chat/conversations/:id/verify` |

**Verify prompt checks for:**
1. Citation accuracy (format, bibliography completeness)
2. Source fidelity (accurate representation of sources)
3. Logical coherence (argument flow, transitions)
4. Grammar and style consistency
5. Completeness (intro, body, conclusion, bibliography)

### Settings (stored per conversation)

| Setting | Options | Effect |
|---------|---------|--------|
| Tone | academic, casual, ap_style | Controls writing register and formality |
| Citation style | chicago, mla, apa | Determines citation format in-text and bibliography |
| No en-dashes | true/false | Adds instruction: "NEVER use em-dashes or en-dashes" |

### Source Selection

- All project documents auto-selected on first conversation creation
- User can deselect/reselect individual sources via checkboxes
- Selection saved to conversation's `selectedSourceIds` field
- Only selected sources are injected into AI context

### Props

```typescript
interface WritingChatProps {
  initialProjectId?: string;  // Pre-select project
  lockProject?: boolean;      // Hide project selector (used in ProjectWorkspace)
}
```

---

## 11. Writing System (One-Shot Pipeline)

**Files:** `server/writingPipeline.ts`, `server/writingRoutes.ts`, `client/src/components/WritingPane.tsx`, `client/src/hooks/useWriting.ts`

**Endpoint:** `POST /api/write`

Accessible via "Quick Generate" dialog in WritingChat. Generates a complete paper in one pass through 3 phases.

### Phase 1: Planner

| Aspect | Detail |
|--------|--------|
| Model | Haiku (default) or Sonnet (deepWrite) |
| Max tokens | 4096 |
| Output | JSON: `{ thesis, sections[], bibliography[] }` |

**Target word counts:**
- short: ~1500 words (3 pages)
- medium: ~2500 words (5 pages)
- long: ~4000 words (8 pages)

The planner creates a structured outline with thesis, section titles, descriptions, source assignments, and target word counts per section.

### Phase 2: Writer (per section)

| Aspect | Detail |
|--------|--------|
| Model | Haiku (default) or Sonnet (deepWrite) |
| Max tokens | 2x target words (or 8192+ with deepWrite) |
| Thinking | 4096 budget tokens (deepWrite only) |
| Output | Markdown section with heading |

Each section is written independently with the full outline for context. Sources assigned to each section are injected.

### Phase 3: Stitcher

| Aspect | Detail |
|--------|--------|
| Model | Haiku (default) or Sonnet (deepWrite) |
| Max tokens | 8192 |
| Output | Complete markdown paper |

Combines all sections, adds transitions, introduction, conclusion, and bibliography.

### Deep Write Mode

When `deepWrite: true`:
- Uses `claude-sonnet-4-5-20241022` instead of Haiku
- Enables extended thinking (4096 budget tokens)
- Increases max output tokens to 8192+
- Produces higher quality but costs more

### SSE Event Types

| Event | Payload | When |
|-------|---------|------|
| `status` | `{ message, phase }` | Phase transitions |
| `plan` | `{ plan }` | After planning complete |
| `section` | `{ index, title, content }` | After each section written |
| `complete` | `{ fullText }` | Final assembled paper |
| `saved` | `{ savedPaper }` | Paper saved to project |
| `error` | `{ error }` | On failure |

---

## 12. Source Injection & Formatting

### How sources get into the AI's context

```
User selects project + sources
  |
loadProjectSources(projectId, selectedSourceIds)     [chatRoutes.ts:21-60]
  | Fetches project_documents + full document text
  | Filters to selectedSourceIds
  |
formatSourceForPrompt(source)                        [writingPipeline.ts:86-116]
  | Formats each source as structured text block
  |
buildWritingSystemPrompt(sources, citationStyle, tone) [chatRoutes.ts:62-97]
  | Embeds all formatted sources into system prompt
  |
anthropic.messages.stream({ system: prompt, ... })
```

### Source format template

Each source is formatted as:

```
[SOURCE projectdoc-{id}]
Type: project_document
Document: {filename}
Title: {title}
Author(s): {author}
Category: project_source
Citation Author(s): {firstName lastName, ...}
Citation Title: {title: subtitle}
Date: {publicationDate}
Publisher: {publisher}
In: {containerTitle}
Pages: {pageStart}-{pageEnd}
URL: {url}
Excerpt: "{summary or first 700 chars}"
Content Snippet:
{first 7000 chars of fullText}
```

### Size limits
- Excerpt: max 700 characters
- Content snippet: max 7000 characters

### System prompt (with sources)

```
You are ScholarMark AI, an academic writing assistant. You are helping a student
write a paper using their project sources.

You have access to the following source materials. When the student asks you to
write content, use these sources and include proper in-text citations.

{all formatted sources}

Instructions:
- Use {STYLE} format for in-text citations when referencing sources.
- Match the following tone: {tone}.
- When writing paper sections, use markdown formatting.
- Be conversational in your responses but produce polished academic prose when asked.
- Do not fabricate quotations, page numbers, publication details, or source information.
- If uncertain about a source detail, cite conservatively and state uncertainty plainly.
- You can discuss, explain, and help refine content iteratively.
```

### System prompt (no sources)

```
You are ScholarMark AI, a helpful academic writing assistant. You help students
with research, writing, citations, and understanding academic sources. Be concise,
accurate, and helpful.
```

---

## 13. Citation System

**File:** `server/citationGenerator.ts`

### CitationData structure

```typescript
{
  sourceType: "book" | "journal" | "website" | "newspaper" | "chapter" | "thesis" | "other"
  authors: Array<{ firstName: string, lastName: string, suffix?: string }>
  title: string
  subtitle?: string
  containerTitle?: string    // Journal or book name
  publisher?: string
  publicationPlace?: string
  publicationDate?: string
  volume?: string
  issue?: string
  pageStart?: string
  pageEnd?: string
  url?: string
  accessDate?: string
  doi?: string
  edition?: string
  editors?: Array<{ firstName: string, lastName: string }>
}
```

### Supported styles
- **Chicago** -- footnotes + bibliography
- **MLA** -- in-text parenthetical + works cited
- **APA** -- in-text parenthetical + references

### Where citations appear

1. **Project documents** -- `citationData` JSON field on `project_documents`
2. **Web clips** -- auto-generated `footnote` and `bibliography` fields
3. **AI writing** -- prompted to use citation style in system prompt
4. **Compile** -- bibliography assembled from conversation context + sources
5. **Verify** -- checks citation format accuracy

---

## 14. Document Export (PDF / DOCX)

**File:** `client/src/lib/documentExport.ts`

All export happens **client-side** -- no server round-trip needed.

### PDF (pdf-lib)

- Font: Times Roman (body 11pt), Times Roman Bold (heading 15pt)
- Page: Letter (612x792), margins 48px (~0.67")
- Line height: 15px
- Auto word-wrap based on font metrics
- Auto page breaks
- Color: dark gray `rgb(0.08, 0.08, 0.08)`

### DOCX (JSZip)

- Minimal Office Open XML structure
- Page: 8.5"x11" with 1" margins
- Plain text paragraphs (no rich formatting)
- Files: `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`

### Utilities

| Function | Purpose |
|----------|---------|
| `stripMarkdown(md)` | Remove all markdown syntax -> plain text |
| `toSafeFilename(s)` | Escape illegal filename chars, max 80 chars |
| `downloadBlob(blob, name)` | Trigger browser download |
| `buildDocxBlob(title, content)` | Generate DOCX blob |
| `buildPdfBlob(title, content)` | Generate PDF blob |
| `getDocTypeLabel(filename)` | Return "PDF" / "TXT" / "IMAGE" / "DOC" |

---

## 15. Web Clips & Chrome Extension

**Files:** `server/webClipRoutes.ts`, `server/extensionRoutes.ts`

### Web Clips
- Store webpage highlights with URL, title, author, date
- Support categories and tags
- Optional project/document association
- Can be promoted to full project annotations

### Chrome Extension
- `POST /api/extension/save` -- saves highlight from browser
- Auto-generates citation data from webpage metadata
- Auto-assigns to first project (or creates "Web Highlights" project)

---

## 16. Environment Variables

### Required

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API key |
| `JWT_SECRET` | JWT signing key (has dev fallback) |

### Optional

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | 5001 | Server port |
| `NODE_ENV` | - | development / production |
| `ALLOWED_ORIGINS` | "" | CORS whitelist (comma-separated) |
| `VISION_OCR_MODEL` | "gpt-4o" | OCR model |
| `MAX_COMBINED_UPLOAD_FILES` | 25 | Max batch upload files |

---

## 17. All API Endpoints

### Auth (`server/authRoutes.ts`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Sign in -> JWT |
| POST | `/api/auth/logout` | Sign out (client-side) |
| GET | `/api/auth/me` | Current user profile |
| PUT | `/api/auth/me` | Update profile |
| GET | `/api/auth/usage` | Token/storage usage |

### Documents (`server/routes.ts`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/upload` | Upload single file |
| POST | `/api/upload-group` | Batch image upload |
| GET | `/api/documents` | List all documents |
| GET | `/api/documents/meta` | Lightweight metadata |
| GET | `/api/documents/:id` | Full document |
| GET | `/api/documents/:id/status` | Processing status |
| GET | `/api/documents/:id/source-meta` | Source file metadata |
| GET | `/api/documents/:id/source` | Stream original file |
| POST | `/api/documents/:id/set-intent` | Trigger AI analysis |
| GET | `/api/documents/:id/annotations` | List annotations |
| POST | `/api/documents/:id/annotate` | Create manual annotation |
| PUT | `/api/annotations/:id` | Update annotation |
| DELETE | `/api/annotations/:id` | Delete annotation |
| POST | `/api/documents/:id/search` | Semantic search |
| GET | `/api/documents/:id/summary` | Get AI summary |
| GET | `/api/system/status` | System diagnostics |

### Projects (`server/projectRoutes.ts`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List projects |
| POST | `/api/projects` | Create project |
| GET | `/api/projects/:id` | Get project |
| PUT | `/api/projects/:id` | Update project |
| DELETE | `/api/projects/:id` | Delete project |
| GET | `/api/projects/:id/documents` | List project documents |
| POST | `/api/projects/:id/documents` | Add document to project |
| POST | `/api/projects/:id/documents/batch` | Batch add documents |
| DELETE | `/api/projects/:id/documents/:docId` | Remove document |
| GET | `/api/projects/:id/documents/:docId/annotations` | List project annotations |
| POST | `/api/projects/:id/documents/:docId/annotations` | Create annotation |
| POST | `/api/projects/:id/documents/:docId/analyze` | AI analyze document |
| POST | `/api/projects/:id/documents/:docId/analyze-multi` | Multi-prompt analysis |
| POST | `/api/projects/:id/documents/:docId/search` | Search document |
| PUT | `/api/projects/:id/annotations/:annId` | Update annotation |
| DELETE | `/api/projects/:id/annotations/:annId` | Delete annotation |
| POST | `/api/projects/:id/batch-analysis` | Batch analyze documents |
| POST | `/api/projects/:id/search` | Search across project |
| POST | `/api/projects/:id/citations/generate` | Generate citations |
| POST | `/api/projects/:id/citations/compile-bibliography` | Compile bibliography |
| GET | `/api/projects/:id/folders` | List folders |
| POST | `/api/projects/:id/folders` | Create folder |
| PUT | `/api/projects/:id/folders/:folderId` | Update folder |
| DELETE | `/api/projects/:id/folders/:folderId` | Delete folder |

### Chat (`server/chatRoutes.ts`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/chat/conversations` | List conversations (optional `?projectId=`) |
| POST | `/api/chat/conversations` | Create conversation |
| GET | `/api/chat/conversations/:id` | Get conversation + messages |
| PUT | `/api/chat/conversations/:id` | Update settings/title |
| DELETE | `/api/chat/conversations/:id` | Delete conversation |
| PUT | `/api/chat/conversations/:id/sources` | Update source selection |
| POST | `/api/chat/conversations/:id/messages` | Send message (SSE stream) |
| POST | `/api/chat/conversations/:id/compile` | Compile paper (SSE stream) |
| POST | `/api/chat/conversations/:id/verify` | Verify paper (SSE stream) |

### Writing (`server/writingRoutes.ts`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/write` | One-shot paper generation (SSE stream) |

### Web Clips (`server/webClipRoutes.ts`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/web-clips` | List clips (with pagination/filtering) |
| POST | `/api/web-clips` | Create clip |
| GET | `/api/web-clips/:id` | Get single clip |
| PUT | `/api/web-clips/:id` | Update clip |
| DELETE | `/api/web-clips/:id` | Delete clip |
| POST | `/api/web-clips/:id/promote` | Promote to project annotation |

### Extension (`server/extensionRoutes.ts`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/extension/save` | Save highlight from Chrome extension |

---

## Model Usage Summary

| Feature | Model | Max Tokens | Notes |
|---------|-------|-----------|-------|
| Chat (standalone) | `claude-haiku-4-5-20251001` | 4096 | No sources |
| Chat (project) | `claude-haiku-4-5-20251001` | 4096 | Sources in system prompt |
| Compile paper | `claude-sonnet-4-5-20241022` | 8192 | Reads full conversation |
| Verify paper | `claude-haiku-4-5-20251001` | 4096 | Reviews compiled paper |
| Planning (default) | `claude-haiku-4-5-20251001` | 4096 | Generates outline |
| Planning (deep) | `claude-sonnet-4-5-20241022` | 4096 | With extended thinking |
| Section writing (default) | `claude-haiku-4-5-20251001` | 2x target words | Per section |
| Section writing (deep) | `claude-sonnet-4-5-20241022` | 8192+ | Extended thinking (4096 budget) |
| Stitching (default) | `claude-haiku-4-5-20251001` | 8192 | Assembles final paper |
| Stitching (deep) | `claude-sonnet-4-5-20241022` | 8192 | Better assembly |
| Auto-title | `claude-haiku-4-5-20251001` | 30 | Short title from first message |

---

## Key Architectural Patterns

1. **SSE Streaming** -- All AI responses streamed via Server-Sent Events with JSON payloads
2. **Source Clipping** -- Excerpts max 700 chars, full text max 7000 chars per source
3. **Two annotation layers** -- Document-global + project-scoped
4. **Per-conversation settings** -- Citation style, tone, source selection persist per chat
5. **Client-side export** -- PDF/DOCX generated in browser, no server needed
6. **React Query invalidation** -- Mutations automatically refresh related queries
7. **V2 AI pipeline** -- Generator -> Hard Verifier -> Soft Verifier for annotation quality
