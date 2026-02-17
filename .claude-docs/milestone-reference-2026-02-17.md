# SourceAnnotator Milestone Reference (2026-02-17)

Purpose: single-file, token-efficient reference for future work.

## Snapshot
- Repo: `git@github.com:jacobbrass75-commits/anotations-jan-26.git`
- Default branch: `master`
- Milestone app commit: `13eb0a9` (`Harden copy actions and fix annotation tool UX`)
- Prior milestone commit: `ae7a209` (`Fix global-search quote navigation and modal/document scroll behavior`)
- Stack: React + Vite frontend, Express + TypeScript backend, SQLite + Drizzle, OpenAI API.

## Product Scope
SourceAnnotator is a research workflow app for:
1. Uploading and parsing PDF/TXT documents.
2. Running AI-assisted annotation extraction.
3. Organizing work into research projects/folders.
4. Searching globally and inside documents.
5. Managing Chicago citations and annotation-linked footnotes.
6. Running batch analysis across multiple documents.

## Repository Map
- `client/` React UI.
- `server/` Express API, AI pipeline, OCR processors.
- `shared/` Drizzle schema + shared TS/Zod types.
- `.claude-docs/` internal architecture docs.
- `CODEBASE_INVENTORY.md` and `ARCHITECTURE.md` broad docs.

## Frontend Architecture (High-Signal)
### Page entry points
- `client/src/pages/Home.tsx`: single-document mode.
- `client/src/pages/Projects.tsx`: project list/create.
- `client/src/pages/ProjectWorkspace.tsx`: project docs/folders/global search.
- `client/src/pages/ProjectDocument.tsx`: document viewer + annotations + prompt analysis.

### Most important components
- `client/src/components/DocumentViewer.tsx`: rendered text surface, scroll-to-selected-annotation.
- `client/src/components/HighlightedText.tsx`: in-text highlights and selection handling.
- `client/src/components/AnnotationSidebar.tsx`: annotation cards, filters, edit/delete/copy actions.
- `client/src/components/MultiPromptPanel.tsx`: multi-prompt analysis runner.
- `client/src/components/SearchPanel.tsx`: document-level search UI.

### Data hooks
- `client/src/hooks/useDocument.ts`: upload/status/doc annotations/search.
- `client/src/hooks/useProjects.ts`: projects/folders/project docs/analysis/templates.
- `client/src/hooks/useProjectSearch.ts`: global project search + citation generation.

### Key recent frontend fixes
- Clipboard hardening in `client/src/lib/clipboard.ts`:
  - Uses `navigator.clipboard.writeText` when available.
  - Falls back to hidden textarea + `document.execCommand("copy")`.
- Global search deep-link navigation in `client/src/pages/ProjectWorkspace.tsx` and `client/src/pages/ProjectDocument.tsx`:
  - Passes `annotationId`/`start` query params.
  - Applies deep-link selection after annotations load.
- Source/annotation quote usability:
  - Added explicit quote-copy action in `client/src/components/AnnotationSidebar.tsx`.
  - Fixed action button visibility with `group` class and selected-state visibility.
- Citation dialogs in workspace/document are scrollable and copy-safe.

## Backend Architecture (High-Signal)
### Entry and wiring
- `server/index.ts`:
  - Loads env via `dotenv/config`.
  - Registers API routes.
  - Dev mode attaches Vite middleware.
  - Binds to `PORT` (default `5001`).

### Route modules
- `server/routes.ts`: base document upload/analysis/annotation/search APIs.
- `server/projectRoutes.ts`: projects, folders, project docs, project annotations, batch flows, citations.

### Storage layers
- `server/storage.ts`: documents, chunks, annotation CRUD.
- `server/projectStorage.ts`: project/folder/project-doc/annotation/template CRUD.

### AI + search + citation modules
- `server/openai.ts`:
  - OpenAI client reads `process.env.OPENAI_API_KEY`.
  - Models: `gpt-4o-mini` (chat), `text-embedding-3-small` (embeddings).
- `server/pipelineV2.ts`: Generator → Verifier → Refiner annotation flow.
- `server/projectSearch.ts`: global and project-doc semantic search.
- `server/citationGenerator.ts`: Chicago footnote/bibliography/inline formatters.
- `server/contextGenerator.ts`: retrieval context + embedding helpers.

### OCR modules
- `server/ocrProcessor.ts`: background OCR for scanned PDFs.
- `server/python/pdf_pipeline.py`: PaddleOCR pipeline.
- `server/python/pdf_to_images.py`: PDF page image conversion for vision OCR.

## Core API Surface
### Base document routes (`server/routes.ts`)
- `POST /api/upload`
- `GET /api/documents`
- `GET /api/documents/:id`
- `GET /api/documents/:id/status`
- `POST /api/documents/:id/set-intent`
- `GET /api/documents/:id/annotations`
- `POST /api/documents/:id/annotate`
- `PUT /api/annotations/:id`
- `DELETE /api/annotations/:id`
- `POST /api/documents/:id/search`
- `GET /api/documents/:id/summary`

### Project routes (`server/projectRoutes.ts`)
- Projects: CRUD on `/api/projects`
- Prompt templates: `/api/projects/:projectId/prompt-templates`, `/api/prompt-templates/:id`
- Folders: `/api/projects/:projectId/folders`, `/api/folders/:id`, `/api/folders/:id/move`
- Project docs: `/api/projects/:projectId/documents`, `/api/project-documents/:id`, `/api/projects/:projectId/documents/batch`
- Project annotations: `/api/project-documents/:id/annotations`, `/api/project-annotations/:id`
- Analysis:
  - `POST /api/project-documents/:id/analyze`
  - `POST /api/project-documents/:id/analyze-multi`
  - `POST /api/projects/:projectId/batch-analyze`
- Search:
  - `POST /api/projects/:projectId/search`
  - `POST /api/project-documents/:id/search`
- Citation:
  - `POST /api/citations/generate`
  - `POST /api/citations/ai`
  - `POST /api/citations/footnote-with-quote`
  - `POST /api/project-annotations/:id/footnote`

## Data Model (Shared Schema)
Main tables in `shared/schema.ts`:
- `documents`
- `text_chunks`
- `annotations`
- `projects`
- `folders`
- `project_documents`
- `project_annotations`
- `prompt_templates`

Key domain constants:
- Annotation categories:
  - `key_quote`, `argument`, `evidence`, `methodology`, `user_added`
- Thoroughness:
  - `quick`, `standard`, `thorough`, `exhaustive`

## Configuration + Environment
### NPM scripts
- `npm run dev` (development server)
- `npm run check` (TypeScript)
- `npm run db:push`
- `npm run db:generate`

### Important env vars observed in code
- `OPENAI_API_KEY`
- `PORT`
- `NODE_ENV`
- Pipeline tuning:
  - `CANDIDATES_PER_CHUNK`
  - `VERIFIER_THRESHOLD`
  - `LLM_CONCURRENCY`
- Optional integration env vars present in code search:
  - `AI_INTEGRATIONS_OPENAI_API_KEY`
  - `AI_INTEGRATIONS_OPENAI_BASE_URL`

## Operational Runbook (Hetzner)
Known production host/workdir from milestone:
- Host: `89.167.10.34`
- App dir: `/opt/app`
- PM2 app: `sourceannotator`
- Port: `5001`
- DB file: `/opt/app/data/sourceannotator.db`

Useful commands:
```bash
pm2 status sourceannotator
pm2 logs sourceannotator --lines 100
pm2 restart sourceannotator --update-env
curl -sS -o /tmp/h.txt -w 'HTTP:%{http_code}\n' http://127.0.0.1:5001/
```

## Milestone Backups (Research Data Safety)
A git-backed backup branch exists:
- Branch: `codex/hetzner-data-backup-20260217`
- Contains split compressed DB backup parts and restore notes under:
  - `backups/hetzner-20260217T200811Z/`

Reference files in that folder:
- `README_RESTORE.md`
- `sourceannotator.db.gz.part-aa`
- `sourceannotator.db.gz.part-ab`
- `sourceannotator.db.gz.part-ac`
- checksum files + pre-reset git diff/status snapshot.

## Known Gotchas
1. `npm run build` currently fails because `script/build.ts` is referenced but missing.
2. OpenAI quota errors surface as `429 insufficient_quota` and appear in UI as search failures.
3. Clipboard APIs can fail in non-secure contexts; use shared helper (`client/src/lib/clipboard.ts`).
4. Any API key pasted in chats should be rotated; keep keys server-side only.

## Quick File Targets by Task
### Global-search navigation/quote actions
- `client/src/pages/ProjectWorkspace.tsx`
- `client/src/pages/ProjectDocument.tsx`
- `client/src/components/AnnotationSidebar.tsx`
- `client/src/lib/clipboard.ts`

### AI annotation quality and behavior
- `server/pipelineV2.ts`
- `server/openai.ts`
- `server/projectRoutes.ts`

### OCR behavior
- `server/ocrProcessor.ts`
- `server/python/pdf_pipeline.py`
- `server/python/pdf_to_images.py`

### Schema and type changes
- `shared/schema.ts`
- `server/storage.ts`
- `server/projectStorage.ts`
- hooks under `client/src/hooks/`

## Token-Efficient Use Strategy
When resuming work, load in this order:
1. This file (`.claude-docs/milestone-reference-2026-02-17.md`).
2. `.claude-docs/README.md` for deep-doc index.
3. Only then open specific files listed in "Quick File Targets by Task".

This avoids re-reading the full codebase each session.
