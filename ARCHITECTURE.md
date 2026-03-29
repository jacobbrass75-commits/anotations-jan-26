# ScholarMark Architecture

Last verified against the live codebase on 2026-03-26.

## System Topology

```text
Browser / Chrome Extension
  |- React SPA (`client/src`)
  |- Chrome web clipper (`chrome-extension/`)
  |- Clerk session in browser
  v
Express App (`server/index.ts`) on :5001
  |- Auth and API keys (`server/auth.ts`, `server/authRoutes.ts`)
  |- Document ingest + OCR (`server/routes.ts`, `server/ocr*.ts`)
  |- Projects / search / citations (`server/projectRoutes.ts`)
  |- Chat + writing (`server/chatRoutes.ts`, `server/writingRoutes.ts`)
  |- Web clips + extension compatibility (`server/webClipRoutes.ts`, `server/extensionRoutes.ts`)
  |- Analytics + admin (`server/analytics*.ts`)
  |- OAuth authorization server for MCP (`server/oauthRoutes.ts`)
  v
Persistence
  |- SQLite database (`data/sourceannotator.db`)
  |- Uploaded source files (`data/uploads`)
  |- OCR queue/checkpoints in SQLite support tables
  v
External providers
  |- Clerk for end-user auth
  |- Anthropic for chat, compile, verify, research, and fallback humanizer
  |- OpenAI for document analysis, embeddings, OCR vision, and image generation
  |- Gemini for primary humanizer
  v
MCP resource server (`mcp-server/server.mjs`) on :5002
  |- Streamable HTTP + legacy SSE
  |- OAuth bearer passthrough to ScholarMark backend
```

## Architectural Boundaries

### 1. Frontend application

The SPA is a Vite + React application rooted at `client/`. `client/src/App.tsx` lazy-loads all pages and protects product routes with `ProtectedRoute`.

Primary user journeys:

- `Home.tsx`: dashboard and system health overview
- `Projects.tsx`: project list and creation
- `ProjectWorkspace.tsx`: folders, batch operations, search, citations, and embedded writing workspace
- `ProjectDocument.tsx`: project-scoped document reading, multi-prompt analysis, citation editing, and annotation management
- `Chat.tsx`: standalone and project-linked conversations
- `WritingPage.tsx`: writing workspace shell
- `WebClips.tsx`: clip review, filtering, promotion, and cleanup
- `ExtensionAuth.tsx`: one-time extension handshake that mints an API key
- `AdminAnalytics.tsx`: admin-only analytics dashboard
- `Pricing.tsx`: tier comparison and Venmo payment links

State is mostly server-driven through React Query hooks in `client/src/hooks`. Streaming features use raw `fetch()` readers over SSE-style responses rather than WebSockets.

### 2. Express application

`server/index.ts` is the application composition root. It:

- loads env vars
- configures CORS and malformed-URI guards
- installs Clerk middleware with API-key/JWT bypass support
- registers OAuth, auth, and product routes
- initializes analytics verification
- serves Vite in development or static assets in production

The route surface is split by domain:

- `routes.ts`: system status, uploads, OCR status, document CRUD, single-document annotations, document search, and document summaries
- `projectRoutes.ts`: projects, folders, prompt templates, project documents, project annotations, project search, batch analyze, citations, and view-state
- `chatRoutes.ts`: conversations, message streaming, source selection, compile, and verify
- `writingRoutes.ts`: one-shot writing pipeline SSE endpoint and generated-paper persistence
- `webClipRoutes.ts`: clip CRUD, filtering, citation generation, and promotion into project annotations
- `extensionRoutes.ts`: backward-compatible extension save endpoint
- `analyticsRoutes.ts`: admin analytics exports and timelines
- `humanizerRoutes.ts`: text humanization for paid tiers
- `oauthRoutes.ts`: OAuth discovery, client registration, authorization code flow, token minting, and revocation

### 3. Data layer

There are two categories of tables:

- Product tables defined in `shared/schema.ts`
- Support tables created imperatively in `server/db.ts`

Product tables cover:

- documents, chunks, and legacy annotations
- users and usage limits
- projects, folders, prompt templates, project documents, and project annotations
- web clips
- conversations and messages

Support tables cover:

- `api_keys`
- `mcp_tokens`
- `mcp_auth_codes`
- `mcp_oauth_clients`
- `analytics_tool_calls`
- `analytics_context_snapshots`
- `ocr_jobs`
- `ocr_page_results`

The repo uses a hybrid persistence style:

- Drizzle ORM for most product reads/writes
- raw `better-sqlite3` prepared statements for support tables and analytics-heavy queries

### 4. AI integration layer

The AI stack is intentionally split by task:

- `server/openai.ts`: embeddings, summaries, search, and legacy/V1 analysis helpers
- `server/pipelineV2.ts`: primary annotation pipeline
- `server/writingPipeline.ts`: structured writing pipeline
- `server/chatRoutes.ts`: Anthropic chat agent with tool use and iterative context escalation
- `server/researchAgent.ts`: deeper source mining during writing conversations
- `server/humanizer.ts`: Gemini-first, Anthropic-fallback rewrite service
- `server/ocrProcessor.ts`: OpenAI vision OCR, PaddleOCR orchestration, HEIC conversion, and PDF/image extraction

## Core Runtime Flows

### Document ingest and OCR

1. The client uploads a file through `/api/upload` or `/api/upload-group`.
2. `server/routes.ts` validates file type and OCR mode.
3. For text-first documents, text is extracted immediately.
4. For scanned PDFs or images, the route stores the source file and enqueues OCR work in `ocr_jobs`.
5. `server/ocrQueue.ts` claims jobs, writes page-level checkpoints, and updates document status.
6. Once text exists, the server chunks the text, generates summary metadata, and persists chunk/summary state.
7. The client polls `/api/documents/:id/status` until the document reaches `ready` or `error`.

### Single-document analysis

1. The client sends an intent and thoroughness level to `/api/documents/:id/set-intent`.
2. `server/routes.ts` generates an embedding for the intent.
3. Chunks are ranked by cosine similarity.
4. `pipelineV2.ts` runs generator, verifier, and refiner phases.
5. Existing AI annotations are replaced, manual annotations remain separate.
6. Results are returned and rendered in `DocumentViewer` and `AnnotationSidebar`.

### Project analysis and retrieval

1. A document is attached to a project through `project_documents`.
2. Project storage enriches it with retrieval context and citation metadata.
3. Project-scoped annotations are stored separately from legacy document annotations.
4. Global project search (`server/projectSearch.ts`) blends text matches from project summaries, folder summaries, document context, and annotation searchable content.
5. Citation endpoints format Chicago footnotes and bibliographies from stored citation data or AI-extracted metadata.

### Chat and writing

There are two writing paths:

- `POST /api/write`: one-shot SSE pipeline that assembles sources up front and streams plan/section/final events
- `POST /api/chat/conversations/:id/messages`: conversational writing and research loop powered by Anthropic

The conversational path is the more advanced architecture:

1. A conversation is created with an optional project and selected source IDs.
2. The server builds a source stub list from project documents and web clips.
3. Anthropic can request tool calls such as `get_source_summary`, `get_source_annotations`, `get_source_chunks`, and `get_web_clips`.
4. Tool calls and context snapshots are logged to analytics tables.
5. If needed, the server escalates context or invokes `researchAgent.ts` for deep-dive findings.
6. Compile and verify endpoints use the same conversation context to generate a paper draft and review it against attached sources.
7. Quote jump links are injected into compiled markdown via `server/quoteJumpLinks.ts`.

### Web clips and extension flow

1. The extension or web UI submits a clip payload.
2. The backend normalizes URL/date/author metadata.
3. Website citation data, footnotes, and bibliography text are generated server-side.
4. Clips can remain standalone evidence or be promoted into project documents plus project annotations.
5. The extension compatibility endpoint keeps older clipper builds functional by writing directly to `web_clips`.

### OAuth and MCP flow

1. `server/oauthRoutes.ts` acts as the authorization server for ScholarMark MCP access.
2. OAuth clients are registered in SQLite support tables.
3. Authorization codes and MCP access/refresh tokens are minted and revoked server-side.
4. `mcp-server/server.mjs` exposes the MCP resource with Streamable HTTP and legacy SSE transports.
5. Bearer tokens are passed through to the backend, where API-key and MCP-token auth are resolved in `server/auth.ts`.

## Source-of-Truth Files

Use these files first when changing architecture-critical behavior:

- `server/index.ts`: process boot and middleware ordering
- `server/auth.ts`: authentication resolution, plan tiers, JWT/API-key bypass
- `server/routes.ts`: ingest, OCR, legacy document APIs
- `server/projectRoutes.ts`: project-domain API behavior
- `server/chatRoutes.ts`: message streaming, tool use, compile, verify
- `server/writingRoutes.ts`: writing pipeline entrypoint
- `server/db.ts`: database bootstrap and support tables
- `shared/schema.ts`: product schema contracts
- `mcp-server/server.mjs`: MCP edge service

## Deployment Model

- Main app default port: `5001`
- MCP server default port: `5002`
- SQLite and uploaded files live under `data/`
- Production builds emit `dist/index.cjs` and `dist/public/`
- The MCP server is designed for a reverse-proxy setup where `/mcp` accepts both JSON and SSE-style negotiation

## Architectural Risks To Resolve Before Production

- `server/chatRoutes.ts` and `server/projectRoutes.ts` are large, multi-responsibility modules and are the highest-maintenance hotspots.
- SQLite is currently the primary store for product, analytics, OCR queue, and OAuth state; concurrency and backup strategy need explicit production planning.
- OCR, chat, compile, and verify paths depend on third-party model providers but currently have limited automated contract coverage.
- The repo includes both root app code and a separate MCP service plus extension, but there is no unified end-to-end release suite covering all three.
- `server/auth.ts` currently defaults Clerk-derived tiers to `max` when metadata is absent, which is suitable for testing but not a production-safe default.

