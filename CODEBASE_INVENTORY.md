# SourceAnnotator Codebase Inventory

## Overview

SourceAnnotator is a document annotation tool that uses AI (OpenAI) to automatically extract and categorize annotations from uploaded documents. It supports both single-document analysis and multi-document research projects with citation management.

---

## ROOT CONFIGURATION FILES

| File | Purpose |
|------|---------|
| `package.json` | NPM dependencies and scripts (dev, build, start, db:push) |
| `tsconfig.json` | TypeScript config with strict mode, path aliases (@/, @shared/) |
| `vite.config.ts` | Vite build config for React frontend, aliases, dev server plugins |
| `drizzle.config.ts` | Drizzle ORM config - SQLite at `./data/sourceannotator.db` |
| `components.json` | Shadcn UI config (New York style, neutral color) |
| `tailwind.config.ts` | Tailwind CSS with dark mode, custom colors, animations |
| `postcss.config.js` | PostCSS config for Tailwind |
| `.env` | Environment variables (OPENAI_API_KEY) |
| `.gitignore` | Git ignore patterns |

---

## SHARED LAYER (`shared/`)

### `shared/schema.ts` - Database Schema & Types

**Database Tables:**

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `documents` | Main document storage | id, filename, fullText, uploadDate, userIntent, summary, mainArguments, keyConcepts, chunkCount, status, processingError |
| `textChunks` | Text segmentation | id, documentId, text, startPosition, endPosition, sectionTitle, embedding |
| `annotations` | Document annotations | id, documentId, chunkId, positions, highlightedText, category, note, isAiGenerated, confidenceScore |
| `users` | Legacy user table | username, password |
| `projects` | Research projects | id, name, description, thesis, scope, contextSummary, contextEmbedding |
| `folders` | Nested folder structure | id, projectId, parentFolderId, name, description, sortOrder |
| `projectDocuments` | Document-project linking | id, projectId, documentId, folderId, projectContext, roleInProject, citationData |
| `projectAnnotations` | Project-specific annotations | id, projectDocumentId, positions, highlightedText, category, note, searchableContent |

**Annotation Categories:**
- `key_quote` - Important quotations
- `argument` - Main arguments
- `evidence` - Supporting evidence
- `methodology` - Research methods
- `user_added` - Manual user annotations

**Key Types:**
- `CandidateAnnotation` - Raw AI output with relative offsets
- `VerifiedCandidate` - After validation passes
- `RefinedAnnotation` - Final output from refiner
- `PipelineAnnotation` - With absolute positions
- `DocumentContext` - Summary and key concepts
- `GlobalSearchResult` - Search result with similarity scoring
- `CitationData` - Chicago-style citation metadata
- `BatchAnalysisRequest/Response` - Batch processing schemas

---

## SERVER BACKEND (`server/`)

### Core Files

| File | Purpose | Key Exports |
|------|---------|-------------|
| `index.ts` | Express app entry point | `log()` function |
| `db.ts` | SQLite/Drizzle database init | `db`, `sqlite` |
| `storage.ts` | Document/chunk/annotation CRUD | `DatabaseStorage` class |
| `routes.ts` | Core document API routes (upload with OCR modes, analysis, annotations) | Route handlers |
| `projectRoutes.ts` | Project management routes | Route handlers |
| `projectStorage.ts` | Project/folder/doc CRUD | `ProjectStorage` class |
| `ocrProcessor.ts` | Background OCR processing (PaddleOCR + GPT-4o Vision) | `saveTempPdf()`, `processWithPaddleOcr()`, `processWithVisionOcr()` |

### API Routes (`routes.ts`)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/upload` | POST | Upload PDF/TXT file (accepts `ocrMode`: standard, advanced, vision) |
| `/api/documents` | GET | List all documents |
| `/api/documents/:id` | GET | Get single document |
| `/api/documents/:id/status` | GET | Poll document processing status (for OCR modes) |
| `/api/documents/:id/set-intent` | POST | Trigger AI analysis (rejects if processing/error) |
| `/api/documents/:id/annotations` | GET | Get annotations |
| `/api/documents/:id/annotate` | POST | Create manual annotation |
| `/api/annotations/:id` | PUT/DELETE | Update/delete annotation |
| `/api/documents/:id/search` | POST | Semantic search |
| `/api/documents/:id/summary` | GET | Get document summary |

### Project Routes (`projectRoutes.ts`)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/projects` | GET/POST | List/create projects |
| `/api/projects/:id` | GET/PUT/DELETE | Project CRUD |
| `/api/projects/:projectId/folders` | GET/POST | Folder management |
| `/api/folders/:id/move` | PUT | Reparent folder |
| `/api/projects/:projectId/documents` | POST | Add document to project |
| `/api/projects/:projectId/documents/batch` | POST | Batch add documents |
| `/api/project-documents/:id` | GET/PUT/DELETE | Project document CRUD |
| `/api/project-documents/:id/citation` | PUT | Update citation |
| `/api/project-documents/:id/annotations` | POST | Create annotation |
| `/api/project-documents/:id/analyze` | POST | Analyze single document |
| `/api/projects/:projectId/batch-analyze` | POST | Batch analysis |
| `/api/projects/:projectId/search` | POST | Global search |
| `/api/citations/*` | POST | Citation generation |

### AI & Processing

| File | Purpose | Key Functions |
|------|---------|---------------|
| `openai.ts` | OpenAI API integration | `getEmbedding()`, `analyzeChunkForIntent()`, `generateDocumentSummary()`, `searchDocument()`, `extractCitationMetadata()` |
| `chunker.ts` | Text segmentation | `chunkText()`, `extractTextFromTxt()` |
| `pipelineV2.ts` | Three-phase annotation pipeline | `filterTextNoise()`, `chunkTextV2()`, Generator/Verifier/Refiner phases |
| `ocrProcessor.ts` | Background OCR processing | `saveTempPdf()`, `processWithPaddleOcr()`, `processWithVisionOcr()`, `cleanupTempFiles()` |
| `contextGenerator.ts` | Retrieval context generation | `generateRetrievalContext()`, `generateProjectContextSummary()`, `embedText()` |
| `citationGenerator.ts` | Chicago citation formatting | `generateChicagoFootnote()`, `generateChicagoBibliography()`, `generateInlineCitation()` |
| `projectSearch.ts` | Project-wide search | `globalSearch()` |

### OCR Pipeline (`ocrProcessor.ts` + `server/python/`)

```
Upload (POST /api/upload with ocrMode)
      ↓
┌─────────────── ocrMode? ───────────────┐
│                                        │
│  "standard"        "advanced"         "vision"
│  pdf-parse (JS)    PaddleOCR (Py)     GPT-4o Vision
│  sync, 200         async, 202         async, 202
│       ↓                 ↓                  ↓
│  Return doc      Save temp PDF       Save temp PDF
│  immediately     status=processing   status=processing
│                       ↓                  ↓
│                  pdf_pipeline.py     pdf_to_images.py
│                  --mode=ocr          (PyMuPDF, 200 DPI)
│                  --model=ppocr            ↓
│                       ↓             GPT-4o Vision x N pages
│                  OCR text out       (p-limit concurrency=5)
│                       ↓             tables → pipe-delimited
│                       └──────┬───────────┘
│                              ↓
│                     Update fullText + chunk
│                     status → "ready" or "error"
│                     Generate summary (background)
│                              ↓
│                     Client polls /status → stops
└────────────────────────────────────────┘
```

**Python Scripts:**

| File | Purpose |
|------|---------|
| `server/python/pdf_to_images.py` | Convert PDF pages to PNG images at given DPI using PyMuPDF |
| `server/python/pdf_pipeline.py` | PaddleOCR pipeline: renders pages, runs OCR, outputs text to stdout |

**Document Status Lifecycle:**
- `ready` — text extracted, available for analysis
- `processing` — OCR running in background
- `error` — OCR failed (message in `processingError`)

On server restart, stuck `processing` docs are automatically set to `error`.

### Pipeline V2 Architecture (Annotation)

```
Document Upload
      ↓
Text Chunking (1000 chars, 100 overlap)
      ↓
Noise Filtering (remove refs/footnotes)
      ↓
┌─────────────────────────────────────┐
│         THREE-PHASE PIPELINE        │
├─────────────────────────────────────┤
│ 1. Generator: Extract candidates    │
│    (up to 3 per chunk, gpt-4o-mini) │
├─────────────────────────────────────┤
│ 2. Verifier: Quality validation     │
│    (threshold: 0.7 confidence)      │
├─────────────────────────────────────┤
│ 3. Refiner: Dedup & polish          │
│    (category/note refinement)       │
└─────────────────────────────────────┘
      ↓
Store with absolute positions
```

### Utility Files

| File | Purpose |
|------|---------|
| `static.ts` | Static file serving for production |
| `vite.ts` | Vite dev server integration with HMR |

---

## CLIENT FRONTEND (`client/src/`)

### Pages

| File | Route | Purpose |
|------|-------|---------|
| `pages/Home.tsx` | `/` | Single document annotation interface |
| `pages/Projects.tsx` | `/projects` | Project management dashboard |
| `pages/ProjectWorkspace.tsx` | `/projects/:id` | Project workspace with folders/docs |
| `pages/ProjectDocument.tsx` | `/projects/:projectId/documents/:docId` | Document viewer with annotations |
| `pages/not-found.tsx` | `*` | 404 error page |

### Hooks (Data Management)

| File | Purpose |
|------|---------|
| `hooks/useDocument.ts` | Document CRUD, upload, annotations, search |
| `hooks/useProjects.ts` | Projects, folders, project documents, batch operations |
| `hooks/useProjectSearch.ts` | Global search, citation generation |
| `hooks/use-toast.ts` | Toast notifications |
| `hooks/use-mobile.tsx` | Mobile device detection |

**Key Hooks from `useDocument.ts`:**
- `useDocuments()` - Query all documents
- `useDocument(id)` - Fetch single document
- `useAnnotations(documentId)` - Fetch annotations
- `useUploadDocument()` - Upload file mutation (accepts `{ file, ocrMode }`)
- `useDocumentStatus(id)` - Poll document processing status (auto-stops on ready/error)
- `useSetIntent()` - Trigger analysis with thoroughness
- `useAddAnnotation()` - Create annotation
- `useSearchDocument()` - Search within document

**Key Hooks from `useProjects.ts`:**
- `useProjects()` / `useProject(id)` - Project queries
- `useCreateProject()` / `useDeleteProject()` - Project mutations
- `useFolders(projectId)` - Folder queries
- `useProjectDocuments(projectId)` - Document queries
- `useAnalyzeProjectDocument()` - Single document analysis
- `useBatchAnalyze()` - Batch analysis
- `useBatchAddDocuments()` - Batch upload

### Components

| Component | Purpose |
|-----------|---------|
| `FileUpload.tsx` | Drag-and-drop file upload with progress; OCR mode dropdown (standard/advanced/vision) for PDFs |
| `DocumentViewer.tsx` | Text display with highlight rendering |
| `AnnotationSidebar.tsx` | Annotation list with filtering |
| `IntentPanel.tsx` | Research intent input + thoroughness selector |
| `ManualAnnotationDialog.tsx` | Dialog for creating manual annotations |
| `SearchPanel.tsx` | Search interface with results |
| `DocumentSummary.tsx` | Summary/arguments/concepts display |
| `BatchAnalysisModal.tsx` | Batch analysis configuration |
| `BatchUploadModal.tsx` | Batch document upload with OCR mode selector |
| `HighlightedText.tsx` | Text rendering with highlights |
| `ThemeToggle.tsx` | Dark/light mode toggle |
| `ui/*` | 50+ Shadcn UI components |

### Utilities

| File | Purpose |
|------|---------|
| `lib/queryClient.ts` | TanStack Query config, `apiRequest()` wrapper |
| `lib/utils.ts` | Utility functions (cn for classnames) |
| `main.tsx` | React entry point |
| `App.tsx` | Router setup with providers |

---

## DATA DIRECTORY (`data/`)

| File | Purpose |
|------|---------|
| `sourceannotator.db` | SQLite database file |

---

## KEY FEATURES

### Document Analysis
- Upload PDF or TXT files (max 50MB)
- Three text extraction modes for PDFs:
  - **Standard**: pdf-parse (JS), fast, digital PDFs only
  - **Advanced OCR**: PaddleOCR at 200 DPI, async background processing for scanned PDFs
  - **Vision OCR**: GPT-4o Vision per page (5 concurrent), best for tables and complex layouts
- Garbled text detection for standard mode
- Async processing with status polling for OCR modes
- Chunking with sentence boundary detection
- AI-powered annotation extraction

### Annotation System
- Five categories: key_quote, argument, evidence, methodology, user_added
- AI-generated with confidence scores
- Manual annotation support
- Position-based highlighting

### Project Management
- Create research projects with thesis/scope
- Nested folder organization
- Batch document upload and analysis
- Global search across all project content

### Citation Management
- Chicago Manual of Style formatting
- Auto-extraction from document text
- Footnote and bibliography generation
- Manual citation entry

### Analysis Thoroughness Levels
| Level | Chunks Analyzed | Use Case |
|-------|-----------------|----------|
| `quick` | 10 | Fast overview |
| `standard` | 50 | Default analysis |
| `thorough` | 100 | Deep analysis |
| `exhaustive` | 999 | Complete coverage |

---

## TECHNOLOGY STACK

**Backend:**
- Express.js (HTTP server)
- Drizzle ORM (database)
- SQLite (data storage)
- OpenAI API (AI analysis + Vision OCR)
- pdf-parse (digital PDF text extraction)
- Multer (file uploads, 50MB limit)
- P-Limit (concurrency control for Vision OCR)

**Python (OCR):**
- PyMuPDF (PDF to image conversion)
- PaddleOCR (optical character recognition)

**Frontend:**
- React 18
- TanStack Query (data fetching)
- Wouter (routing)
- Shadcn UI (components)
- Tailwind CSS (styling)
- Next-Themes (dark mode)

**Build Tools:**
- Vite (bundler)
- TypeScript
- ESBuild

---

## NPM SCRIPTS

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `cross-env NODE_ENV=development tsx server/index.ts` | Start dev server |
| `build` | `tsx script/build.ts` | Build for production |
| `start` | `cross-env NODE_ENV=production node dist/index.cjs` | Run production server |
| `check` | `tsc` | TypeScript type check |
| `db:push` | `drizzle-kit push` | Push schema to database |
| `db:generate` | `drizzle-kit generate` | Generate migrations |
| `setup` | `npm install && npm run db:push` | Initial setup |

---

*Last updated: January 27, 2026 — Added OCR pipeline (Standard/Advanced/Vision modes)*
