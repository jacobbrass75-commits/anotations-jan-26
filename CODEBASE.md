# ScholarMark Codebase Guide

Public technical reference for the current codebase in `/Users/brass/Documents/New project/anotations-jan-26`.

## What This Repo Contains

ScholarMark is a multi-surface product:

- a React research workspace
- an Express backend
- a Chrome clipping extension
- a separate MCP resource server
- SQLite-backed product and support data

This repo is not a thin frontend shell. Most business logic, AI orchestration, search, OCR queueing, and OAuth behavior live here.

## Repository Map

| Path | Role |
| --- | --- |
| `client/` | Vite + React SPA |
| `server/` | Express API, AI integrations, storage, OAuth, OCR, analytics |
| `shared/` | Drizzle schema and shared Zod types |
| `chrome-extension/` | Web clipper extension |
| `mcp-server/` | Standalone MCP service that proxies to the backend |
| `scripts/` | build and maintenance scripts |
| `prompts/` | prompt templates such as the humanizer prompt |
| `data/` | runtime SQLite DB and uploaded source files |
| `.claude-docs/` | older internal docs and snapshots |
| `.claude/agents/` | reusable Claude subagent definitions |

## Frontend Surface

### Router and page ownership

`client/src/App.tsx` is the route switch and lazy-load boundary.

| Route | Page | Purpose |
| --- | --- | --- |
| `/` | `Home.tsx` | Dashboard and system health |
| `/projects` | `Projects.tsx` | Project list and creation |
| `/projects/:id` | `ProjectWorkspace.tsx` | Project hub with folders, search, and writing |
| `/projects/:projectId/documents/:docId` | `ProjectDocument.tsx` | Project-scoped document reading and analysis |
| `/chat` and `/chat/:conversationId` | `Chat.tsx` | Conversation UI |
| `/write` and `/writing` | `WritingPage.tsx` | Writing workspace shell |
| `/web-clips` | `WebClips.tsx` | Web clip management |
| `/extension-auth` | `ExtensionAuth.tsx` | Extension API-key handshake |
| `/admin/analytics` | `AdminAnalytics.tsx` | Admin analytics dashboard |
| `/pricing` | `Pricing.tsx` | Tier comparison |
| `/sign-in`, `/sign-up` | `Login.tsx`, `Register.tsx` | Clerk auth views |

### Frontend building blocks

- `components/`: feature components for annotations, writing, analytics, and chat
- `components/ui/`: shadcn/Radix wrappers
- `hooks/`: React Query hooks for API domains plus SSE client logic
- `lib/`: auth helpers, export utilities, markdown helpers, and fetch wrappers

High-value components:

- `DocumentViewer.tsx` and `HighlightedText.tsx`
- `AnnotationSidebar.tsx`
- `MultiPromptPanel.tsx`
- `WritingChat.tsx`
- `components/chat/*`
- `components/analytics/*`

## Backend Surface

### Entry points

- `server/index.ts`: main app bootstrap
- `mcp-server/server.mjs`: MCP service bootstrap

### Route modules

| File | Domain |
| --- | --- |
| `server/routes.ts` | document ingest, OCR, single-document APIs |
| `server/projectRoutes.ts` | projects, folders, prompt templates, project docs, project annotations, project search, citations |
| `server/chatRoutes.ts` | conversations, streaming messages, compile, verify |
| `server/writingRoutes.ts` | one-shot writing pipeline |
| `server/webClipRoutes.ts` | clip CRUD and promotion |
| `server/extensionRoutes.ts` | legacy extension save path |
| `server/authRoutes.ts` | current user and API-key management |
| `server/analyticsRoutes.ts` | admin analytics export and timeline |
| `server/humanizerRoutes.ts` | paid rewrite endpoint |
| `server/oauthRoutes.ts` | OAuth discovery, authorize, token, revoke |

### Support modules by concern

| Concern | Files |
| --- | --- |
| Auth and user resolution | `server/auth.ts`, `server/authStorage.ts` |
| Database bootstrap | `server/db.ts` |
| Legacy document storage | `server/storage.ts` |
| Project storage | `server/projectStorage.ts` |
| Chat storage | `server/chatStorage.ts` |
| Project search | `server/projectSearch.ts` |
| Citation formatting | `server/citationGenerator.ts` |
| Context generation | `server/contextGenerator.ts` |
| Annotation pipeline | `server/openai.ts`, `server/pipelineV2.ts` |
| OCR processing and jobs | `server/ocrProcessor.ts`, `server/ocrQueue.ts` |
| File persistence | `server/sourceFiles.ts` |
| Writing logic | `server/writingPipeline.ts`, `server/researchAgent.ts` |
| Analytics logging | `server/analyticsLogger.ts` |
| Markdown quote jumps | `server/quoteJumpLinks.ts` |

## Data Model

### Shared schema tables

Defined in `shared/schema.ts`:

- `documents`
- `text_chunks`
- `annotations`
- `users`
- `projects`
- `prompt_templates`
- `folders`
- `project_documents`
- `project_annotations`
- `web_clips`
- `conversations`
- `messages`

### Support tables created in `server/db.ts`

- `api_keys`
- `mcp_tokens`
- `mcp_auth_codes`
- `mcp_oauth_clients`
- `analytics_tool_calls`
- `analytics_context_snapshots`
- `ocr_jobs`
- `ocr_page_results`

## External Integrations

### Authentication

- Clerk browser/session auth
- legacy JWT support
- user API keys prefixed `sk_sm_`
- MCP access tokens prefixed `mcp_sm_`

### Model providers

- Anthropic: chat, compile, verify, research, humanizer fallback
- OpenAI: embeddings, summaries, document analysis, vision OCR, image generation
- Gemini: primary humanizer

### Browser extension

The Chrome extension posts clips to:

- `/api/web-clips`
- `/api/extension/save` for older clients

### MCP

The MCP service exposes:

- Streamable HTTP on `/mcp`
- discovery docs on `/.well-known/oauth-protected-resource`
- legacy SSE on `/sse` and `/messages`

## Build and Run Workflow

### NPM scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | start the Express app in development with Vite attached |
| `npm run build` | build SPA and bundled server |
| `npm run start` | run the production bundle |
| `npm run check` | TypeScript check |
| `npm run db:push` | Drizzle schema push |
| `npm run db:generate` | Drizzle migration generation |
| `npm run setup` | install deps and push DB schema |

### Scripts folder

| File | Purpose |
| --- | --- |
| `scripts/build.ts` | production client/server build orchestration |
| `scripts/migrate.cjs` | migration helper |
| `scripts/backfill-chat-quote-links.ts` | one-off quote-link backfill script |
| `scripts/sql/add-humanize-column.sql` | manual SQL patch |

## Environment Variables

Most important runtime variables discovered in the current code:

### Core app

- `PORT`
- `NODE_ENV`
- `ALLOWED_ORIGINS`
- `JWT_SECRET`
- `APP_BASE_URL`
- `PUBLIC_BASE_URL`

### Authentication and admin

- `VITE_CLERK_PUBLISHABLE_KEY`
- `ADMIN_USER_IDS`

### AI and OCR

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `GEMINI_HUMANIZER_MODEL`
- `HUMANIZER_ANTHROPIC_MODEL`
- `AI_INTEGRATIONS_OPENAI_API_KEY`
- `AI_INTEGRATIONS_OPENAI_BASE_URL`
- `CANDIDATES_PER_CHUNK`
- `VERIFIER_THRESHOLD`
- `LLM_CONCURRENCY`
- `OCR_JOB_MAX_ATTEMPTS`
- `MAX_COMBINED_UPLOAD_FILES`
- `VISION_OCR_MODEL`
- `VISION_OCR_PAGE_CONCURRENCY`
- `VISION_OCR_BATCH_SIZE`
- `VISION_OCR_BATCH_CONCURRENCY`
- `VISION_OCR_AUTO_BATCH_THRESHOLD`
- `VISION_OCR_MAX_RETRIES`
- `VISION_OCR_RETRY_DELAY_MS`
- `VISION_OCR_TPM_LIMIT`
- `VISION_OCR_ESTIMATED_TOKENS_PER_REQUEST`
- `VISION_OCR_MIN_REQUEST_GAP_MS`
- `VISION_HEIC_PAGE_CHUNK_SIZE`
- `VISION_HEIC_MAX_DIMENSION`
- `VISION_HEIC_JPEG_QUALITY`
- `VISION_HEIC_ROTATE_THRESHOLD_PCT`
- `VISION_HEIC_CONTRAST_GAIN`
- `VISION_HEIC_CONTRAST_BIAS`

### OAuth and MCP

- `OAUTH_ISSUER`
- `MCP_ACCESS_TOKEN_TTL_SECONDS`
- `MCP_REFRESH_TOKEN_TTL_SECONDS`
- `MCP_AUTH_CODE_TTL_SECONDS`
- `MCP_SERVER_PORT`
- `SCHOLARMARK_BACKEND_URL`

### Client-only

- `VITE_VENMO_HANDLE`

## Current Hotspots

These files are the highest-risk change surfaces:

- `server/chatRoutes.ts`
- `server/projectRoutes.ts`
- `server/routes.ts`
- `server/ocrProcessor.ts`
- `client/src/pages/ProjectDocument.tsx`
- `client/src/components/WritingChat.tsx`

They are large, feature-dense, and tie together multiple subsystems.

## Recommended Reading Order For New Contributors

1. `ARCHITECTURE.md`
2. `shared/schema.ts`
3. `server/index.ts`
4. `server/routes.ts`
5. `server/projectRoutes.ts`
6. `server/chatRoutes.ts`
7. `client/src/App.tsx`
8. `client/src/pages/ProjectWorkspace.tsx`
9. `client/src/pages/ProjectDocument.tsx`
10. `TEST_STRATEGY.md`

