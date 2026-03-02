# SourceAnnotator

AI-powered document annotation + academic writing tool. Full-stack TypeScript.

## Quick Reference

- **Dev**: `npm run dev` (port 5001)
- **DB**: SQLite at `./data/sourceannotator.db`, schema in `shared/schema.ts`
- **After schema changes**: `npm run db:push`
- **Type check**: `npm run check`
- **Path aliases**: `@/` = `client/src/`, `@shared/` = `shared/`

## Stack

- **Frontend**: React 18, Vite, TanStack Query, Wouter, Tailwind, shadcn/ui
- **Backend**: Express.js, Drizzle ORM, SQLite (better-sqlite3)
- **AI**: OpenAI (annotations, embeddings, OCR) + Anthropic Claude (writing pipeline)
- **Env vars**: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`

## Architecture

```
client/src/
  pages/         Home, Projects, ProjectWorkspace, ProjectDocument, WritingPage
  components/    WritingPane, DocumentViewer, AnnotationSidebar, MultiPromptPanel, ...
  hooks/         useDocument, useProjects, useProjectSearch, useWriting

server/
  routes.ts          Document/annotation CRUD
  projectRoutes.ts   Projects/folders/batch/citations
  writingRoutes.ts   POST /api/write (SSE streaming)
  writingPipeline.ts Planner -> Writer (per section) -> Stitcher (Anthropic Claude)
  pipelineV2.ts      Generator -> Verifier -> Refiner (OpenAI, annotation pipeline)
  ocrProcessor.ts    Standard/Advanced(PaddleOCR)/Vision(GPT-4o) PDF extraction
  storage.ts         Document CRUD layer
  projectStorage.ts  Project CRUD layer
  openai.ts          Embeddings + analysis

shared/schema.ts     Drizzle tables + Zod types (9 tables)
```

## Key Patterns

- All API state managed via TanStack React Query with path-based keys
- SSE streaming for writing pipeline (POST, not EventSource)
- Annotation pipeline: chunk text -> generate candidates -> verify -> refine
- Writing pipeline: plan (1 call) -> write sections (N calls) -> stitch (1 call)
- OCR modes return 202 for async processing, client polls `/api/documents/:id/status`

## Detailed Docs

See `ARCHITECTURE.md` for full API reference, database schema, and pipeline details.
