# Project Overview

## What Is SourceAnnotator?

A full-stack, AI-powered document annotation and academic writing tool. Researchers upload documents (PDF/TXT), analyze them with OpenAI's GPT models, organize annotations across research projects, generate Chicago-style citations, and write full academic papers via a 3-phase AI writing pipeline (Planner→Writer→Stitcher) powered by Anthropic Claude.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Language | TypeScript (strict mode) | 5.6.3 |
| Frontend | React + Vite | 18.3.1 / 7.3.0 |
| Backend | Express.js | 4.21.2 |
| Database | SQLite via Drizzle ORM | better-sqlite3 12.6.2 / drizzle-orm 0.39.3 |
| AI (Annotations) | OpenAI API | openai 6.16.0 |
| AI (Writing) | Anthropic SDK | @anthropic-ai/sdk 0.78.0 |
| Styling | Tailwind CSS + shadcn/ui (New York) | 3.4.17 |
| State | TanStack React Query | 5.60.5 |
| Routing | wouter (frontend), Express (backend) | 3.3.5 |
| Validation | Zod | 3.25.76 |
| Forms | react-hook-form | 7.55.0 |
| PDF | pdf-parse | 2.4.5 |
| Uploads | Multer | 2.0.2 |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Browser (React)                   │
│  Pages: Home | Projects | Workspace | ProjDoc | Write│
│  State: React Query | Local State | Toast            │
│  UI: shadcn/ui + Tailwind + Radix Primitives         │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP (JSON)
┌──────────────────────┴──────────────────────────────┐
│                  Express Server (:5001)               │
│  routes.ts ──── Document/Annotation CRUD              │
│  projectRoutes.ts ── Projects/Folders/Batch/Citations │
│  writingRoutes.ts ── Writing Pipeline (SSE)           │
│  openai.ts ──── Embeddings, Analysis, Citation AI     │
│  pipelineV2.ts ── 3-Phase Annotation Pipeline         │
│  writingPipeline.ts ── 3-Phase Writing Engine          │
│  storage.ts / projectStorage.ts ── Data Access        │
└──────────────────────┬──────────────────────────────┘
                       │ Drizzle ORM
┌──────────────────────┴──────────────────────────────┐
│              SQLite (data/sourceannotator.db)         │
│  9 tables: documents, textChunks, annotations,       │
│  projects, folders, projectDocuments,                 │
│  projectAnnotations, promptTemplates, users           │
└─────────────────────────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────┐
│                    OpenAI API                         │
│  gpt-4o-mini ── Analysis, Verification, Refinement   │
│  text-embedding-3-small ── Semantic Embeddings        │
└─────────────────────────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────┐
│                   Anthropic API                       │
│  Claude Haiku ── Writing Pipeline (default)           │
│  Claude Sonnet ── Deep Write (extended thinking)      │
└─────────────────────────────────────────────────────┘
```

## Directory Structure

```
/Users/brass/anotation-test/
├── .claude-docs/           # This documentation folder
├── client/                 # React frontend
│   ├── index.html
│   └── src/
│       ├── main.tsx        # Entry point
│       ├── App.tsx         # Router
│       ├── index.css       # Global styles + theme variables
│       ├── pages/          # Page components (5 files)
│       ├── components/     # UI components (~50+ shadcn + 12 custom)
│       ├── hooks/          # React Query hooks (5 files)
│       └── lib/            # Utilities (queryClient, utils)
├── server/                 # Express backend
│   ├── index.ts            # Server entry + middleware
│   ├── db.ts               # SQLite/Drizzle setup
│   ├── routes.ts           # Document/annotation API routes
│   ├── projectRoutes.ts    # Project management API routes
│   ├── writingRoutes.ts    # Writing pipeline SSE endpoint
│   ├── storage.ts          # Document CRUD layer
│   ├── projectStorage.ts   # Project CRUD layer
│   ├── openai.ts           # OpenAI integration + V1 pipeline
│   ├── pipelineV2.ts       # V2 annotation pipeline (primary)
│   ├── writingPipeline.ts  # AI writing engine (Anthropic Claude)
│   ├── chunker.ts          # Text segmentation
│   ├── contextGenerator.ts # AI context generation
│   ├── citationGenerator.ts# Chicago-style citations
│   ├── ocrProcessor.ts     # Background OCR (PaddleOCR + Vision)
│   ├── projectSearch.ts    # Semantic + text search
│   ├── vite.ts             # Dev server (HMR)
│   ├── static.ts           # Production file serving
│   └── replit_integrations/# Batch utils + image generation
├── shared/
│   └── schema.ts           # Database schema + Zod types (shared)
├── data/                   # SQLite database (gitignored)
├── migrations/             # Drizzle migrations
├── package.json
├── tsconfig.json
├── vite.config.ts
├── drizzle.config.ts
├── tailwind.config.ts
└── .env                    # API keys (gitignored)
```

## Key Features

1. **Document Management** - Upload PDF/TXT, extract text, generate summaries
2. **AI Annotation Pipeline** - 3-phase: Generator -> Verifier -> Refiner
3. **Multi-Prompt Analysis** - Run multiple research questions in parallel with color coding
4. **Project Organization** - Projects with nested folders, batch operations
5. **Semantic Search** - Embedding-based search across documents and projects
6. **Citation Management** - AI-extracted metadata, Chicago-style formatting
7. **Manual Annotations** - Text selection to create custom highlights
8. **Prompt Templates** - Save and reuse prompt sets per project
9. **AI Writing Pipeline** - Planner→Writer→Stitcher, SSE streaming, Deep Write mode
10. **OCR Processing** - Standard/Advanced (PaddleOCR)/Vision (GPT-4o) modes

## File Dependency Graph

```
index.ts (entry)
├── routes.ts
│   ├── storage.ts → db.ts
│   ├── openai.ts (embeddings, V1 pipeline, citations)
│   ├── pipelineV2.ts (V2 pipeline, uses openai.ts)
│   ├── chunker.ts
│   ├── writingRoutes.ts
│   │   ├── writingPipeline.ts → @anthropic-ai/sdk
│   │   ├── projectStorage.ts (annotation lookup)
│   │   └── storage.ts (legacy annotation fallback)
│   └── projectRoutes.ts
│       ├── projectStorage.ts → db.ts
│       ├── projectSearch.ts → openai.ts, storage.ts
│       ├── citationGenerator.ts
│       ├── contextGenerator.ts → openai.ts
│       └── replit_integrations/batch/utils.ts
├── vite.ts (dev) | static.ts (prod)
└── db.ts → shared/schema.ts
```
