# ScholarMark Architecture

Last verified against the local codebase on 2026-05-05.

This document is the future-reference map for the app: what exists, where it lives, how the major flows work, and what still needs to happen before production launch.

## Product Summary

ScholarMark is a research and writing workspace. Users upload or paste sources, run AI-assisted annotation and citation workflows, organize evidence into projects, clip evidence from the web with a Chrome extension, and draft or verify writing through chat and writing tools.

The repo contains four deployable surfaces:

- React/Vite web app in `client/`
- Express API and background processing in `server/`
- Chrome extension in `chrome-extension/`
- Standalone MCP resource server in `mcp-server/`

## System Topology

```text
Browser
  |- React SPA (`client/src`)
  |- Clerk browser session
  |- Chrome extension clipper (`chrome-extension/`)
  v
Express app (`server/index.ts`) on port 5001 by default
  |- Clerk, JWT, API-key, local-dev, and MCP-token auth
  |- Document ingest, chunking, OCR queue, annotations, projects
  |- Chat, writing, citations, web clips, analytics, OAuth
  |- Vite dev middleware in development
  |- Static `dist/public` serving in production
  v
Persistence under `data/`
  |- SQLite database: `data/sourceannotator.db`
  |- Uploaded/pasted source files: `data/uploads`
  |- OCR queue and page checkpoints in SQLite
  v
External providers
  |- Clerk: user identity and hosted account management
  |- Anthropic: chat, compile, verify, research, writing, fallback humanizer
  |- OpenAI: embeddings, summaries, annotation pipeline, OCR vision, image generation integration
  |- Gemini: primary humanizer
  v
MCP resource server (`mcp-server/server.mjs`) on port 5002 by default
  |- Streamable HTTP `/mcp`
  |- Legacy SSE `/sse` and `/messages`
  |- OAuth protected-resource discovery
  |- Bearer-token passthrough to Express backend
```

## Repository Map

| Path                | Role                                                                         |
| ------------------- | ---------------------------------------------------------------------------- |
| `client/`           | React SPA, pages, components, hooks, export helpers, auth helpers            |
| `server/`           | Express API, auth, storage, AI orchestration, OCR, analytics, OAuth          |
| `shared/`           | Drizzle schema, shared Zod schemas, shared TypeScript types                  |
| `chrome-extension/` | Extension manifest, popup, options, background and content scripts           |
| `mcp-server/`       | Separate MCP HTTP/SSE server and MCP deployment config                       |
| `scripts/`          | Build, test orchestration, DB bootstrap, maintenance scripts                 |
| `deploy/`           | Production deploy, PM2 config, backup scripts, hardening docs                |
| `tests/`            | Vitest unit, integration, and app bootstrap coverage                         |
| `prompts/`          | Prompt templates used by server-side AI features                             |
| `data/`             | Runtime database and user-uploaded source files; do not treat as source code |

## Frontend Architecture

The SPA is rooted at `client/src/main.tsx` and `client/src/App.tsx`.

Core frontend libraries:

- React 18
- Vite
- Wouter for routing
- TanStack Query for server state
- Tailwind CSS, shadcn/Radix primitives, lucide-react icons
- Clerk React for browser auth

Important client files:

| File                                | Purpose                                                      |
| ----------------------------------- | ------------------------------------------------------------ |
| `client/src/App.tsx`                | Route table, lazy page loading, app providers, boot sequence |
| `client/src/lib/queryClient.ts`     | Fetch wrapper and auth header behavior                       |
| `client/src/lib/auth.ts`            | Clerk/local-dev auth helpers                                 |
| `client/src/hooks/*`                | Domain-specific React Query hooks and streaming clients      |
| `client/src/components/ui/*`        | Shared UI primitives                                         |
| `client/src/components/chat/*`      | Chat panels, messages, source/status cards                   |
| `client/src/components/analytics/*` | Admin analytics charts and tables                            |

Routes:

| Route                                   | Page                   | Access | Purpose                                                  |
| --------------------------------------- | ---------------------- | ------ | -------------------------------------------------------- |
| `/sign-in`                              | `Login.tsx`            | Public | Clerk sign-in                                            |
| `/sign-up`                              | `Register.tsx`         | Public | Clerk registration                                       |
| `/pricing`                              | `Pricing.tsx`          | Public | Tier comparison and payment links                        |
| `/account`                              | `Account.tsx`          | Auth   | Usage, plan info, API keys, Clerk account actions        |
| `/extension-auth`                       | `ExtensionAuth.tsx`    | Auth   | Extension API-key handoff                                |
| `/`                                     | `Home.tsx`             | Auth   | Workspace dashboard                                      |
| `/projects`                             | `Projects.tsx`         | Auth   | Project list and creation                                |
| `/projects/:id`                         | `ProjectWorkspace.tsx` | Auth   | Project hub, folders, source ingest, search, writing     |
| `/projects/:projectId/documents/:docId` | `ProjectDocument.tsx`  | Auth   | Project document reader, annotations, prompts, citations |
| `/chat`, `/chat/:conversationId`        | `Chat.tsx`             | Pro+   | Conversational research and writing                      |
| `/write`, `/writing`                    | `WritingPage.tsx`      | Pro+   | Writing workspace                                        |
| `/web-clips`                            | `WebClips.tsx`         | Auth   | Clip review, filtering, promotion, cleanup               |
| `/admin/analytics`                      | `AdminAnalytics.tsx`   | Admin  | Conversation/tool/context analytics                      |

Frontend state is primarily server state. The client uses local storage for theme selection and local-dev auth helpers. Streaming features use `fetch()` plus readable streams/SSE-style parsing rather than WebSockets.

## Backend Architecture

`server/index.ts` is the composition root. It:

- loads `.env` through `dotenv/config`
- creates the Express app and HTTP server
- enables proxy trust
- configures CORS for configured origins, localhost, extension origins, the production app, and MCP host
- captures raw JSON bodies
- parses JSON and URL-encoded request bodies
- rejects malformed URI sequences before route matching
- installs Clerk/auth middleware
- logs API responses with summarized payloads
- registers OAuth routes, auth routes, product routes, analytics initialization, and final error handling
- attaches Vite middleware in development or static serving in production
- listens on `PORT` or `5001`

Public operational probes:

- `GET /healthz`: minimal process health
- `GET /readyz`: readiness check with a SQLite query
- `GET /api/system/status`: authenticated dashboard/ops status with counts and storage details

Route modules:

| File                                         | Domain                                                                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/routes.ts`                           | Health check, uploads, pasted text, upload groups, OCR status, documents, legacy annotations, single-document analysis, document search and summaries |
| `server/authRoutes.ts`                       | Current user, usage, API-key creation/list/revocation                                                                                                 |
| `server/projectRoutes.ts`                    | Projects, folders, prompt templates, project documents, project annotations, project search, citation tools, view state, voice profile                |
| `server/chatRoutes.ts`                       | Conversation CRUD, source selection, streaming messages, compile, verify                                                                              |
| `server/writingRoutes.ts`                    | One-shot writing pipeline and generated-paper history                                                                                                 |
| `server/webClipRoutes.ts`                    | Clip CRUD, URL lookup, citation metadata, promotion to project evidence                                                                               |
| `server/extensionRoutes.ts`                  | Legacy extension save endpoint                                                                                                                        |
| `server/humanizerRoutes.ts`                  | Paid text humanization endpoint                                                                                                                       |
| `server/analyticsRoutes.ts`                  | Admin-only analytics export and conversation inspection                                                                                               |
| `server/oauthRoutes.ts`                      | OAuth discovery, dynamic client registration, authorization code flow, token issuance, revocation                                                     |
| `server/replit_integrations/image/routes.ts` | Image generation endpoint                                                                                                                             |

Support modules:

| Concern                                     | Files                                                                       |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| Auth and plan enforcement                   | `server/auth.ts`, `server/authStorage.ts`                                   |
| DB connection and imperative support tables | `server/db.ts`                                                              |
| Legacy document storage                     | `server/storage.ts`                                                         |
| Project persistence                         | `server/projectStorage.ts`                                                  |
| Chat persistence                            | `server/chatStorage.ts`                                                     |
| Project search                              | `server/projectSearch.ts`                                                   |
| Citation formatting                         | `server/citationGenerator.ts`                                               |
| Context assembly                            | `server/contextGenerator.ts`, `server/contextCompaction.ts`                 |
| Annotation AI                               | `server/openai.ts`, `server/pipelineV2.ts`                                  |
| Document ingestion                          | `server/documentIngestion.ts`, `server/chunker.ts`, `server/sourceFiles.ts` |
| OCR                                         | `server/ocrProcessor.ts`, `server/ocrQueue.ts`, `server/python/*`           |
| Writing and research                        | `server/writingPipeline.ts`, `server/researchAgent.ts`                      |
| Analytics logging                           | `server/analyticsLogger.ts`                                                 |
| Quote jump links                            | `server/quoteJumpLinks.ts`, `shared/annotationLinks.ts`                     |

## Data Architecture

The app uses SQLite through a hybrid of Drizzle ORM and raw `better-sqlite3`.

`shared/schema.ts` defines product tables:

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

`server/db.ts` also creates support tables imperatively:

- `api_keys`
- `mcp_oauth_clients`
- `mcp_auth_codes`
- `mcp_tokens`
- `analytics_tool_calls`
- `analytics_context_snapshots`
- `ocr_jobs`
- `ocr_page_results`

The DB bootstrap also applies additive compatibility columns with `ALTER TABLE` when missing:

- `project_documents.source_role`
- `project_documents.style_analysis`
- `conversations.evidence_clipboard`
- `conversations.compaction_summary`
- `conversations.compacted_at_turn`
- `api_keys.label`
- `projects.voice_profile`
- `projects.voice_profile_samples`

Important persistence rule: a usable restore requires both `data/sourceannotator.db` and `data/uploads`. The database references source files stored on disk.

## Authentication and Authorization

Supported auth modes:

- Clerk browser sessions for the main web app
- ScholarMark API keys prefixed with `sk_sm_`
- MCP tokens prefixed with `mcp_sm_`
- legacy structured JWTs
- `LOCAL_DEV_AUTH=true` for local-only development bypass

Production guardrails in `server/auth.ts`:

- `LOCAL_DEV_AUTH` throws in production.
- Clerk production config must use live keys unless `CLERK_ALLOW_TEST_KEYS_IN_PRODUCTION=true` is explicitly set.
- API keys and MCP tokens are stored hashed, touched on use, and can be revoked.

Plan gates:

- `free`: baseline document/project features
- `pro`: chat, writing, extension legacy save, humanizer, voice profile analysis
- `max`: multi-prompt project analysis and batch analysis

Admin access is controlled by `ADMIN_USER_IDS`.

## Core Runtime Flows

### Document Ingest and OCR

1. Client submits `/api/upload`, `/api/upload-text`, or `/api/upload-group`.
2. `server/routes.ts` validates auth, upload shape, file count, file type, and OCR mode.
3. Text-backed inputs go through `server/documentIngestion.ts`.
4. Pasted text is persisted as a `.txt` source file under `data/uploads`.
5. Uploaded text is chunked through `server/chunker.ts`.
6. Summaries and metadata are generated with AI helpers.
7. Scanned PDFs/images enqueue an OCR job in `ocr_jobs`.
8. `server/ocrQueue.ts` claims OCR jobs and stores page checkpoints in `ocr_page_results`.
9. `server/ocrProcessor.ts` handles PDF/image extraction, HEIC conversion, OpenAI vision OCR, retry limits, and OCR text assembly.
10. The client polls document status until `ready` or `error`.

### Single-Document Analysis

1. Client posts intent/thoroughness to `/api/documents/:id/set-intent`.
2. Server embeds the intent and ranks chunks by similarity.
3. `server/pipelineV2.ts` runs generator, verifier, and refiner phases.
4. AI annotations are replaced for the run; manual/user annotations remain distinct.
5. Results render in `DocumentViewer`, `HighlightedText`, and `AnnotationSidebar`.

### Project Workspace

1. A user creates a project.
2. Sources are attached through `project_documents`.
3. Folders organize project documents.
4. Project-specific annotations live separately from legacy document annotations.
5. `server/projectSearch.ts` searches project summaries, folder summaries, document context, and annotation searchable content.
6. Citation endpoints generate footnotes, bibliography entries, and quote-attached footnotes from stored or AI-extracted citation data.
7. Voice profiles can be analyzed and stored per project for paid tiers.

### Chat, Research, Compile, Verify

1. A conversation is created with optional project and selected source IDs.
2. `server/chatRoutes.ts` builds source stubs from project documents and web clips.
3. Anthropic receives the conversation plus available tools.
4. Tool calls retrieve source summaries, annotations, chunks, web clips, and other context.
5. Tool calls and context snapshots are logged to analytics support tables.
6. Context can escalate or compact as the conversation grows.
7. `server/researchAgent.ts` can perform deeper source mining.
8. Compile and verify endpoints reuse conversation context to draft and check writing.
9. `server/quoteJumpLinks.ts` injects source-jump links into compiled markdown.

### Writing Pipeline

`POST /api/write` is a one-shot SSE-style writing flow for Pro+ users. It assembles sources, runs `server/writingPipeline.ts`, streams plan/section/final events, and stores generated-paper history.

### Web Clips and Extension

1. Extension or web UI submits a clip payload.
2. Backend normalizes URL, date, author, category, note, and surrounding context.
3. Citation data, footnote, and bibliography text are generated server-side.
4. Clips can remain standalone or be promoted into project evidence.
5. `/api/extension/save` exists for older extension clients and requires Pro+.

### OAuth and MCP

1. `server/oauthRoutes.ts` exposes OAuth authorization-server metadata and token endpoints.
2. MCP OAuth clients, auth codes, access tokens, and refresh tokens are stored in SQLite.
3. `mcp-server/server.mjs` exposes MCP transports and protected-resource metadata.
4. MCP requests carry bearer tokens back to the Express API.
5. `server/auth.ts` resolves `mcp_sm_` tokens to local users.

## MCP Server

The MCP service is intentionally separate from the main Express app.

Defaults:

- Port: `5002`
- Backend URL: `SCHOLARMARK_BACKEND_URL` or `http://127.0.0.1:5001`
- Health: `/healthz`
- Primary MCP transport: `/mcp`
- Legacy transports: `/sse`, `/messages`

Production metadata expects `MCP_RESOURCE_URL=https://mcp.scholarmark.ai` and reverse proxy routing where `/mcp` reaches this service.

## Chrome Extension

The extension includes:

- `manifest.json`
- `background/background.js`
- `content/content.js`
- `popup/*`
- `options/*`

It supports authenticated clipping into ScholarMark through API keys generated by `/extension-auth` and backend API-key routes.

Production extension launch requires packaging, Chrome Web Store setup, privacy disclosures, final production URLs, and extension review. Those steps require account access and cannot be fully completed from code alone.

## Environment Variables

Core app:

- `NODE_ENV`
- `PORT`
- `ALLOWED_ORIGINS`
- `APP_BASE_URL`
- `PUBLIC_BASE_URL`
- `JWT_SECRET`
- `MAX_COMBINED_UPLOAD_FILES`

Clerk/auth:

- `CLERK_PUBLISHABLE_KEY`
- `VITE_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CLERK_ALLOW_TEST_KEYS_IN_PRODUCTION`
- `ADMIN_USER_IDS`
- `EXTENSION_CORS_MODE`
- `CHROME_EXTENSION_IDS`
- `LOCAL_DEV_AUTH`
- `LOCAL_DEV_USER_ID`
- `LOCAL_DEV_USER_EMAIL`
- `VITE_LOCAL_DEV_AUTH`

AI providers:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `GEMINI_HUMANIZER_MODEL`
- `HUMANIZER_ANTHROPIC_MODEL`
- `AI_INTEGRATIONS_OPENAI_API_KEY`
- `AI_INTEGRATIONS_OPENAI_BASE_URL`

Annotation/search tuning:

- `CANDIDATES_PER_CHUNK`
- `VERIFIER_THRESHOLD`
- `LLM_CONCURRENCY`

OCR tuning:

- `OCR_JOB_MAX_ATTEMPTS`
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

MCP/OAuth:

- `MCP_SERVER_PORT`
- `SCHOLARMARK_BACKEND_URL`
- `MCP_RESOURCE_URL`
- `OAUTH_ISSUER`
- `MCP_ACCESS_TOKEN_TTL_SECONDS`
- `MCP_REFRESH_TOKEN_TTL_SECONDS`
- `MCP_AUTH_CODE_TTL_SECONDS`
- `OAUTH_AUTHORIZE_DEDUP_WINDOW_SECONDS`

Payments/pricing UI:

- `VITE_VENMO_HANDLE`

## Build, Test, and Run

Root scripts:

| Command                     | Purpose                                                               |
| --------------------------- | --------------------------------------------------------------------- |
| `npm run dev`               | Start Express in development with Vite middleware                     |
| `npm run build`             | Build client and bundled production server through `scripts/build.ts` |
| `npm run start`             | Run `dist/index.cjs` in production mode                               |
| `npm run check`             | TypeScript check                                                      |
| `npm run test`              | Sequential Vitest run                                                 |
| `npm run test:coverage`     | Sequential Vitest coverage run                                        |
| `npm run smoke:prod`        | Reusable production smoke checks                                      |
| `npm run restore:drill`     | Restore and verify a backup snapshot in a temporary workspace         |
| `npm run extension:package` | Validate and zip the Chrome extension                                 |
| `npm run db:push`           | Push Drizzle schema                                                   |
| `npm run db:generate`       | Generate Drizzle migrations                                           |
| `npm run setup`             | Install dependencies and push DB schema                               |

Current test areas:

- client utility tests
- app bootstrap e2e smoke
- auth route integration
- extension route integration
- DB bootstrap tests
- upload middleware tests
- document ingestion tests
- chunking tests
- citation generation tests
- humanizer tests
- quote jump link tests
- source file tests
- backup script tests
- shared annotation link tests

Gaps before production:

- Full browser E2E coverage of upload, project analysis, chat, writing, web clips, and account flows
- Contract tests for model-provider failure modes
- Extension end-to-end test against a production-like backend
- MCP OAuth and resource-server integration test against the deployed reverse proxy
- Restore drill automation beyond documented manual steps

## Deployment Model

Production deploy assets live in `deploy/`.

Main app defaults:

- App directory: `/opt/app`
- App ref: `origin/master`
- Health check: `http://127.0.0.1:5001/readyz`
- Production process: PM2 via `deploy/ecosystem.config.cjs`

MCP defaults:

- MCP directory: `/opt/app/mcp-server`
- Health check: `http://127.0.0.1:5002/readyz`
- Production process: PM2 via `mcp-server/deploy/ecosystem.config.cjs`

`deploy/refresh-prod.sh` performs:

1. Required command checks for `git`, `npm`, `pm2`, and `curl`.
2. Optional pre-deploy backup through `deploy/backup-data.sh`.
3. `git fetch --prune origin`.
4. `git reset --hard "$APP_REF"` on the server checkout.
5. `npm ci`.
6. Database bootstrap through `npx tsx scripts/bootstrap-db.ts`.
7. `npm run build`.
8. PM2 reload for the app.
9. MCP dependency install and PM2 reload if MCP directory exists.
10. App and MCP readiness checks.
11. Production smoke checks through `scripts/smoke-prod.mjs`.
12. `pm2 save`.

Backups:

- Script: `deploy/backup-data.sh`
- Docs: `deploy/BACKUPS.md`
- Systemd units: `sourceannotator-backup.service`, `sourceannotator-backup.timer`
- Backup target: `/opt/backups/scholarmark/`
- Snapshot contents: SQLite DB, uploads tarball, metadata

Known production host references in docs/scripts:

- App host/IP: `89.167.10.34`
- Expected app origin: `https://app.scholarmark.ai`
- Expected MCP origin: `https://mcp.scholarmark.ai`

## Architecture Risks

- SQLite backs product data, OAuth, analytics, and OCR queue state. This is simple and deployable, but concurrency, lock behavior, backup cadence, and restore drills matter.
- `server/chatRoutes.ts` and `server/projectRoutes.ts` are high-responsibility modules and should be split when making large future changes.
- Several core workflows depend on third-party model providers and need stronger failure-mode tests.
- Production billing appears to be mostly manual/Venmo-facing today; paid-tier enforcement depends on local `users.tier` values and operator updates.
- Chrome extension release requires store review and privacy/compliance work outside the repo.
- MCP production correctness depends on reverse proxy headers, OAuth metadata URLs, and exact `/mcp` routing.
- User-uploaded files are stored on local disk, so moving hosts or scaling horizontally requires a storage migration plan.
- Route ownership checks now fail closed for core document, project, chat, writing, extension, and web-clip flows; future raw-ID routes must preserve that pattern.

## Production Launch Checklist

### I can do from this repo/workspace

- Run `npm run check`, `npm run test`, and a production build with configured Clerk keys.
- Run `npm run smoke:prod` against staging/production.
- Run `npm run restore:drill` against real backup snapshots.
- Run `npm run extension:package` before Chrome Web Store upload.
- Keep route ownership tests current when adding raw-ID APIs.
- Keep release, rollback, backup, and Chrome store docs current as production decisions change.

### You need to do yourself or provide access/decisions for

- Create and configure production Clerk application, live publishable key, live secret key, allowed origins, redirect URLs, and account/security settings.
- Decide final domains and DNS records for `app.scholarmark.ai`, `mcp.scholarmark.ai`, and any marketing/root domain.
- Configure TLS certificates and reverse proxy routing on the production server.
- Provide production AI provider keys for Anthropic, OpenAI, Gemini, and any Replit/OpenAI-compatible integration endpoint.
- Decide pricing, payment flow, refund/support policy, and how paid users are upgraded from `free` to `pro` or `max`.
- Set `ADMIN_USER_IDS` for real admin accounts.
- Review privacy policy, terms of service, AI/data-retention disclosures, and copyright handling for uploaded documents.
- Decide whether local SQLite/on-disk uploads are acceptable for launch scale or whether to move to managed Postgres/object storage first.
- Configure off-box backups, backup retention, encryption, and restore-drill cadence.
- Create monitoring/alerting accounts and decide who receives incidents.
- Create Chrome Web Store developer account, listing assets, privacy disclosures, and submit the extension.
- Confirm whether root/password SSH access should be disabled after deploy-key access is verified for every operator.
- Decide launch support channels, contact email, and escalation process.

### Production environment minimum

- `NODE_ENV=production`
- `PORT=5001`
- `ALLOWED_ORIGINS` includes final app and MCP origins
- `APP_BASE_URL` / `PUBLIC_BASE_URL` set to final HTTPS app URL
- strong unique `JWT_SECRET`
- live Clerk keys unless deliberately using test keys for a non-public staging deploy
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and optionally `GEMINI_API_KEY`
- `ADMIN_USER_IDS`
- `EXTENSION_CORS_MODE=disabled` until the Chrome Web Store extension ID exists, then `CHROME_EXTENSION_IDS`
- `MCP_RESOURCE_URL=https://mcp.scholarmark.ai`
- `SCHOLARMARK_BACKEND_URL=http://127.0.0.1:5001` for MCP on the same host
- backup timer installed and verified
- PM2 process list saved after successful health checks

### Suggested launch sequence

1. Create a staging `.env` with test Clerk and provider keys.
2. Run local verification: `npm run check`, `npm run test`, `npm run build`.
3. Deploy staging with `deploy/refresh-prod.sh` or the same command path used for production.
4. Smoke test sign-in, upload, OCR/text ingest, project analysis, chat, writing, web clips, extension auth, admin analytics, and MCP health.
5. Run a backup and restore drill from staging data.
6. Configure production domains, TLS, reverse proxy, live Clerk keys, provider keys, and admin IDs.
7. Deploy production.
8. Create first admin/user accounts and verify tier behavior.
9. Submit Chrome extension after production URLs and policies are final.
10. Run production smoke tests.
11. Enable recurring backups and monitoring.
12. Disable root/password SSH only after all operator deploy paths are confirmed.

## Source-of-Truth Files

Start with these files when changing architecture-critical behavior:

- `server/index.ts`
- `server/auth.ts`
- `server/db.ts`
- `shared/schema.ts`
- `server/routes.ts`
- `server/projectRoutes.ts`
- `server/chatRoutes.ts`
- `server/writingRoutes.ts`
- `server/webClipRoutes.ts`
- `server/oauthRoutes.ts`
- `server/documentIngestion.ts`
- `server/ocrQueue.ts`
- `server/ocrProcessor.ts`
- `mcp-server/server.mjs`
- `client/src/App.tsx`
- `client/src/lib/queryClient.ts`
- `deploy/refresh-prod.sh`
- `deploy/BACKUPS.md`
