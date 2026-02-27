# ScholarMark (SourceAnnotator) — Complete Codebase Reference

> **Generated:** February 10, 2026
> **Purpose:** Exhaustive documentation of every file, component, endpoint, and data model. Use as context in future sessions so Claude can work on this codebase without re-reading every file.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Root Configuration Files](#3-root-configuration-files)
4. [Database Schema](#4-database-schema)
5. [Server — File-by-File](#5-server--file-by-file)
6. [API Endpoint Reference](#6-api-endpoint-reference)
7. [Client — Pages](#7-client--pages)
8. [Client — Components](#8-client--components)
9. [Client — Hooks](#9-client--hooks)
10. [Client — Utilities & Styling](#10-client--utilities--styling)
11. [AI Pipeline Architecture](#11-ai-pipeline-architecture)
12. [Data Flow Diagrams](#12-data-flow-diagrams)
13. [Auth & Middleware](#13-auth--middleware)
14. [Environment Variables & Configuration](#14-environment-variables--configuration)
15. [Analysis & Recommendations](#15-analysis--recommendations)

---

## 1. Project Overview

**ScholarMark** (internal name: SourceAnnotator) is a full-stack AI-powered research annotation platform. Researchers upload documents (PDF/TXT), organize them into projects, run AI analysis to extract relevant annotations, search across sources, and generate Chicago-style citations.

**Core Capabilities:**
- Document upload with OCR support (standard, PaddleOCR, OpenAI Vision)
- AI-powered annotation extraction via a 3-phase pipeline (Generate → Verify → Refine)
- Multi-prompt parallel analysis with color-coded results
- Project organization with hierarchical folders
- Global semantic search across all project documents
- Chicago-style citation generation (footnotes + bibliography)
- Batch operations (upload, analyze multiple documents)
- Manual annotation creation via text selection

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Express.js, TypeScript |
| **Database** | SQLite via better-sqlite3, Drizzle ORM |
| **AI/ML** | OpenAI API (gpt-4o-mini, text-embedding-3-small, gpt-4o for Vision OCR) |
| **Frontend** | React 18, TypeScript, Vite 7 |
| **UI** | shadcn/ui (New York style), Tailwind CSS 3.4, Radix UI primitives |
| **State** | TanStack React Query (server state), React useState (local) |
| **Routing** | wouter (client), Express (server) |
| **Validation** | Zod, drizzle-zod |
| **Forms** | react-hook-form |
| **OCR** | pdf-parse, PaddleOCR (Python), OpenAI Vision |
| **Icons** | lucide-react |
| **Animation** | framer-motion |

---

## 3. Root Configuration Files

### package.json
**Scripts:**
| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `cross-env NODE_ENV=development tsx server/index.ts` | Start dev server (port 5001) |
| `build` | `tsx script/build.ts` | Production build |
| `start` | `cross-env NODE_ENV=production node dist/index.cjs` | Run production |
| `check` | `tsc` | TypeScript type checking |
| `db:push` | `drizzle-kit push` | Apply schema changes to SQLite |
| `db:generate` | `drizzle-kit generate` | Generate migration files |
| `setup` | `npm install && npm run db:push` | Initial setup |

### tsconfig.json
- **Strict mode** enabled
- **Path aliases:** `@/*` → `./client/src/*`, `@shared/*` → `./shared/*`
- Module: ESNext, JSX: preserve, no emit (Vite transpiles)

### vite.config.ts
- Client root: `./client`, build output: `./dist/public`
- React Fast Refresh, runtime error overlay
- Strict filesystem access (denies dotfiles)
- Aliases: `@` → client/src, `@shared` → shared, `@assets` → attached_assets

### drizzle.config.ts
- Dialect: SQLite, schema: `./shared/schema.ts`
- Database: `./data/sourceannotator.db`, migrations: `./migrations/`

### tailwind.config.ts
- Dark mode: class-based, 18 color categories with CSS variables
- Fonts: Inter (sans), Merriweather (serif), JetBrains Mono (mono)
- Plugins: tailwindcss-animate, @tailwindcss/typography

### components.json
- shadcn/ui: New York style, neutral base, CSS variables enabled

---

## 4. Database Schema

**File:** `shared/schema.ts` (529 lines)
**Database:** SQLite at `./data/sourceannotator.db`

### Table: `documents`
| Column | Type | Nullable | Default | Constraints |
|--------|------|----------|---------|-------------|
| id | text | NO | randomUUID() | PRIMARY KEY |
| filename | text | NO | — | |
| fullText | text | NO | — | |
| uploadDate | integer (timestamp) | NO | now() | |
| userIntent | text | YES | null | |
| summary | text | YES | null | AI-generated |
| mainArguments | text (JSON string[]) | YES | null | AI-generated |
| keyConcepts | text (JSON string[]) | YES | null | AI-generated |
| chunkCount | integer | NO | 0 | |
| status | text | NO | "ready" | "ready" / "processing" / "error" |
| processingError | text | YES | null | |

### Table: `textChunks`
| Column | Type | Nullable | Default | Constraints |
|--------|------|----------|---------|-------------|
| id | text | NO | randomUUID() | PRIMARY KEY |
| documentId | text | NO | — | FK → documents.id (CASCADE) |
| text | text | NO | — | |
| startPosition | integer | NO | — | Absolute position in document |
| endPosition | integer | NO | — | |
| sectionTitle | text | YES | null | |
| embedding | text (JSON number[]) | YES | null | 1536-dim OpenAI vector |

### Table: `annotations` (document-level, non-project)
| Column | Type | Nullable | Default | Constraints |
|--------|------|----------|---------|-------------|
| id | text | NO | randomUUID() | PRIMARY KEY |
| documentId | text | NO | — | FK → documents.id (CASCADE) |
| chunkId | text | YES | null | |
| startPosition | integer | NO | — | Absolute position |
| endPosition | integer | NO | — | |
| highlightedText | text | NO | — | |
| category | text | NO | — | Enum: key_quote, argument, evidence, methodology, user_added |
| note | text | NO | — | |
| isAiGenerated | integer (bool) | NO | false | |
| confidenceScore | real | YES | null | 0-1, AI only |
| promptText | text | YES | null | |
| promptIndex | integer | YES | null | |
| promptColor | text | YES | null | Hex color |
| analysisRunId | text | YES | null | Groups multi-prompt results |
| createdAt | integer (timestamp) | NO | now() | |

### Table: `projects`
| Column | Type | Nullable | Default | Constraints |
|--------|------|----------|---------|-------------|
| id | text | NO | randomUUID() | PRIMARY KEY |
| name | text | NO | — | |
| description | text | YES | null | |
| thesis | text | YES | null | Research thesis |
| scope | text | YES | null | |
| contextSummary | text | YES | null | AI-generated |
| contextEmbedding | text (JSON number[]) | YES | null | |
| createdAt | integer | NO | now() | |
| updatedAt | integer | NO | now() | |

### Table: `folders`
| Column | Type | Nullable | Default | Constraints |
|--------|------|----------|---------|-------------|
| id | text | NO | randomUUID() | PRIMARY KEY |
| projectId | text | NO | — | FK → projects.id (CASCADE) |
| parentFolderId | text | YES | null | Self-ref FK → folders.id |
| name | text | NO | — | |
| description | text | YES | null | |
| contextSummary | text | YES | null | |
| contextEmbedding | text (JSON number[]) | YES | null | |
| sortOrder | integer | NO | 0 | |
| createdAt | integer | NO | now() | |

### Table: `projectDocuments`
| Column | Type | Nullable | Default | Constraints |
|--------|------|----------|---------|-------------|
| id | text | NO | randomUUID() | PRIMARY KEY |
| projectId | text | NO | — | FK → projects.id (CASCADE) |
| documentId | text | NO | — | FK → documents.id (CASCADE) |
| folderId | text | YES | null | FK → folders.id (SET NULL) |
| projectContext | text | YES | null | User-defined |
| roleInProject | text | YES | null | |
| retrievalContext | text | YES | null | AI-generated |
| retrievalEmbedding | text (JSON number[]) | YES | null | |
| citationData | text (JSON CitationData) | YES | null | |
| lastViewedAt | integer | YES | null | |
| scrollPosition | integer | YES | null | |
| addedAt | integer | NO | now() | |

### Table: `projectAnnotations`
| Column | Type | Nullable | Default | Constraints |
|--------|------|----------|---------|-------------|
| id | text | NO | randomUUID() | PRIMARY KEY |
| projectDocumentId | text | NO | — | FK → projectDocuments.id (CASCADE) |
| startPosition | integer | NO | — | |
| endPosition | integer | NO | — | |
| highlightedText | text | NO | — | |
| category | text | NO | — | Same enum as annotations |
| note | text | YES | null | |
| isAiGenerated | integer (bool) | NO | true | |
| confidenceScore | real | YES | null | |
| promptText | text | YES | null | |
| promptIndex | integer | YES | null | |
| promptColor | text | YES | null | |
| analysisRunId | text | YES | null | |
| searchableContent | text | YES | null | For global search |
| searchEmbedding | text (JSON number[]) | YES | null | |
| createdAt | integer | NO | now() | |

### Table: `promptTemplates`
| Column | Type | Nullable | Default | Constraints |
|--------|------|----------|---------|-------------|
| id | text | NO | randomUUID() | PRIMARY KEY |
| projectId | text | NO | — | FK → projects.id (CASCADE) |
| name | text | NO | — | |
| prompts | text (JSON {text,color}[]) | NO | — | |
| createdAt | integer | NO | now() | |

### Table: `users` (legacy, unused)
| Column | Type | Nullable | Constraints |
|--------|------|----------|-------------|
| id | text | NO | PRIMARY KEY |
| username | text | NO | UNIQUE |
| password | text | NO | |

### CitationData Interface
```typescript
interface CitationData {
  sourceType: 'book' | 'journal' | 'website' | 'newspaper' | 'chapter' | 'thesis' | 'other';
  authors: Array<{ firstName: string; lastName: string; suffix?: string }>;
  title: string;
  subtitle?: string;
  containerTitle?: string;
  publisher?: string;
  publicationPlace?: string;
  publicationDate?: string;
  volume?: string;
  issue?: string;
  pageStart?: string;
  pageEnd?: string;
  url?: string;
  accessDate?: string;
  doi?: string;
  edition?: string;
  editors?: Array<{ firstName: string; lastName: string }>;
}
```

### Entity Relationship Diagram
```
┌──────────────┐         ┌──────────────┐
│  documents   │────1:N──│  textChunks  │
│              │         └──────────────┘
│              │────1:N──┌──────────────┐
└──────┬───────┘         │ annotations  │
       │                 └──────────────┘
       │ (referenced by)
       │
┌──────┴───────┐────1:N──┌────────────────────┐
│   projects   │         │  projectDocuments   │──N:1──→ documents
│              │         │                     │──N:1──→ folders (SET NULL)
│              │         └─────────┬───────────┘
│              │                   │
│              │                   └────1:N──┌─────────────────────┐
│              │                             │ projectAnnotations  │
│              │                             └─────────────────────┘
│              │
│              │────1:N──┌──────────────┐
│              │         │   folders    │──self-ref (parentFolderId)
│              │         └──────────────┘
│              │
│              │────1:N──┌──────────────────┐
└──────────────┘         │ promptTemplates  │
                         └──────────────────┘
```

**Cascade deletes:** documents → chunks, annotations; projects → folders, projectDocuments, promptTemplates; projectDocuments → projectAnnotations
**Set null on delete:** folders → projectDocuments.folderId

---

## 5. Server — File-by-File

### index.ts — Application Entry Point
**Path:** `server/index.ts`
**Purpose:** Initialize Express app, configure middleware, register routes, start server.

**Middleware chain (in order):**
1. `dotenv/config` — Load .env variables
2. `express.json()` — Parse JSON bodies; custom verify captures raw buffer as `req.rawBody`
3. `express.urlencoded({ extended: false })` — Parse form data
4. **Request logger** — Logs all `/api/*` requests: method, path, status, duration (ms), JSON response body
5. Route handlers (routes.ts + projectRoutes.ts)
6. **Error handler** — Catches thrown errors, responds with status + message
7. **Vite** (dev) or **static file server** (prod) — SPA fallback

**Key details:**
- Default port: 5001 (env `PORT`)
- Dev: Vite HMR on `/vite-hmr`
- Prod: serves from `./dist/public`

---

### db.ts — Database Connection
**Path:** `server/db.ts`
**Purpose:** Establish SQLite connection, initialize Drizzle ORM.

**Exports:**
- `db` — Drizzle ORM instance
- `sqlite` — Raw better-sqlite3 connection

**Key details:**
- Creates `./data/` directory if missing
- Enables foreign key constraints
- **Startup recovery:** marks stuck "processing" documents as "error"

---

### routes.ts — Document Management API
**Path:** `server/routes.ts`
**Purpose:** Document upload, text extraction, annotation CRUD, single-document analysis.

**Key functions:**
- `isGarbledText(text: string): boolean` — Detects extraction failures by character ratio
- `registerRoutes(app: Express): Server` — Registers all document endpoints

**Dependencies:** storage, openai, pipelineV2, ocrProcessor, chunker, multer
**Called by:** index.ts

---

### projectRoutes.ts — Project Management API (1,224 lines)
**Path:** `server/projectRoutes.ts`
**Purpose:** Full project lifecycle — CRUD for projects, folders, prompt templates, project documents, project annotations, plus AI analysis, search, and citations.

**Key function:**
- `registerProjectRoutes(app: Express): void` — Registers all project endpoints

**Dependencies:** projectStorage, storage, openai, pipelineV2, citationGenerator, contextGenerator, projectSearch
**Called by:** routes.ts (which calls `registerProjectRoutes` at end of `registerRoutes`)

---

### storage.ts — Document Storage Layer
**Path:** `server/storage.ts`
**Purpose:** Database abstraction for documents, text chunks, and annotations.

```typescript
export interface IStorage {
  getDocument(id: string): Promise<Document | undefined>;
  getAllDocuments(): Promise<Document[]>;
  createDocument(doc: InsertDocument): Promise<Document>;
  updateDocument(id: string, updates: Partial<Document>): Promise<Document | undefined>;
  deleteDocument(id: string): Promise<void>;

  getChunksForDocument(documentId: string): Promise<TextChunk[]>;
  createChunk(chunk: InsertTextChunk): Promise<TextChunk>;
  updateChunkEmbedding(chunkId: string, embedding: number[]): Promise<void>;

  getAnnotationsForDocument(documentId: string): Promise<Annotation[]>;
  getAnnotation(id: string): Promise<Annotation | undefined>;
  createAnnotation(annotation: InsertAnnotation): Promise<Annotation>;
  updateAnnotation(id: string, note: string, category: AnnotationCategory): Promise<Annotation | undefined>;
  deleteAnnotation(id: string): Promise<void>;
  deleteAnnotationsForDocument(documentId: string): Promise<void>;
}

export class DatabaseStorage implements IStorage { ... }
export const storage: DatabaseStorage;
```

---

### projectStorage.ts — Project Storage Layer
**Path:** `server/projectStorage.ts`
**Purpose:** Database abstraction for projects, folders, project documents, project annotations, prompt templates.

```typescript
export interface IProjectStorage {
  // Projects
  createProject(data: InsertProject): Promise<Project>;
  getProject(id: string): Promise<Project | undefined>;
  getAllProjects(): Promise<Project[]>;
  updateProject(id: string, data: Partial<InsertProject & {
    contextSummary?: string; contextEmbedding?: number[]
  }>): Promise<Project | undefined>;
  deleteProject(id: string): Promise<void>;

  // Folders
  createFolder(data: InsertFolder): Promise<Folder>;
  getFolder(id: string): Promise<Folder | undefined>;
  getFoldersByProject(projectId: string): Promise<Folder[]>;
  updateFolder(id: string, data: Partial<InsertFolder & {
    contextSummary?: string; contextEmbedding?: number[]
  }>): Promise<Folder | undefined>;
  deleteFolder(id: string): Promise<void>;
  moveFolder(id: string, newParentId: string | null): Promise<Folder | undefined>;

  // Project Documents
  addDocumentToProject(data: InsertProjectDocument): Promise<ProjectDocument>;
  getProjectDocument(id: string): Promise<ProjectDocument | undefined>;
  getProjectDocumentsByProject(projectId: string): Promise<(ProjectDocument & {
    document: { id: string; filename: string; summary: string | null }
  })[]>;
  getProjectDocumentsByFolder(folderId: string): Promise<ProjectDocument[]>;
  updateProjectDocument(id: string, data: Partial<{
    projectContext: string; roleInProject: string; retrievalContext: string;
    retrievalEmbedding: number[]; citationData: CitationData;
    folderId: string | null; lastViewedAt: Date; scrollPosition: number;
  }>): Promise<ProjectDocument | undefined>;
  removeDocumentFromProject(id: string): Promise<void>;

  // Project Annotations
  createProjectAnnotation(data: InsertProjectAnnotation): Promise<ProjectAnnotation>;
  getProjectAnnotation(id: string): Promise<ProjectAnnotation | undefined>;
  getProjectAnnotationsByDocument(projectDocumentId: string): Promise<ProjectAnnotation[]>;
  updateProjectAnnotation(id: string, data: Partial<InsertProjectAnnotation & {
    searchableContent?: string; searchEmbedding?: number[];
  }>): Promise<ProjectAnnotation | undefined>;
  deleteProjectAnnotation(id: string): Promise<void>;

  // Prompt Templates
  createPromptTemplate(data: InsertPromptTemplate): Promise<PromptTemplate>;
  getPromptTemplate(id: string): Promise<PromptTemplate | undefined>;
  getPromptTemplatesByProject(projectId: string): Promise<PromptTemplate[]>;
  updatePromptTemplate(id: string, data: Partial<InsertPromptTemplate>): Promise<PromptTemplate | undefined>;
  deletePromptTemplate(id: string): Promise<void>;
}

export const projectStorage: IProjectStorage;
```

---

### openai.ts — OpenAI Integration & V1 Pipeline
**Path:** `server/openai.ts`
**Purpose:** OpenAI API interface for embeddings, LLM analysis, summarization, and V1 annotation pipeline.

**Models:** `text-embedding-3-small` (embeddings), `gpt-4o-mini` (analysis)

**Configuration:**
```typescript
export const PIPELINE_CONFIG = {
  MODEL: 'gpt-4o-mini',
  CANDIDATES_PER_CHUNK: 3,
  VERIFIER_THRESHOLD: 0.7,
  LLM_CONCURRENCY: 5,
  // Temperature: Generator=0.6, Verifier=0.1, Refiner=0.3
  // Highlights: min=10 chars, max=500 chars
  // Chunk counts: quick=10, standard=30, thorough=100, exhaustive=999
}
```

**Key function signatures:**
```typescript
// Embedding & similarity
export async function getEmbedding(text: string): Promise<number[]>
export function cosineSimilarity(a: number[], b: number[]): number

// Document analysis
export async function generateDocumentSummary(fullText: string):
  Promise<{ summary: string; mainArguments: string[]; keyConcepts: string[] }>
export async function searchDocument(query: string, intent: string,
  relevantChunks: { text: string; startPosition: number; endPosition: number }[]
): Promise<SearchResult[]>

// V1 Pipeline phases
export async function generateCandidates(chunk: string, intent: string,
  documentContext?: DocumentContext): Promise<CandidateAnnotation[]>
export async function verifyCandidates(candidates: CandidateAnnotation[],
  chunk: string, chunkStart: number, intent: string,
  existingAnnotations: Array<{ startPosition: number; endPosition: number; confidenceScore?: number | null }>
): Promise<VerifiedCandidate[]>
export async function refineAnnotations(verified: VerifiedCandidate[],
  intent: string, documentContext?: DocumentContext): Promise<RefinedAnnotation[]>

// Full pipeline
export async function processChunksWithPipeline(
  chunks: Array<{ text: string; startPosition: number; id: string }>,
  intent: string, documentId: string, fullText: string,
  existingAnnotations: Array<{ startPosition: number; endPosition: number; confidenceScore?: number | null }>
): Promise<PipelineAnnotation[]>

// Citation
export async function extractCitationMetadata(
  documentText: string, highlightedText?: string
): Promise<CitationData | null>

// Utilities
export function findHighlightPosition(fullText: string, highlightText: string, chunkStart: number):
  { start: number; end: number } | null
export function calculateOverlap(start1: number, end1: number, start2: number, end2: number): number
export function isDuplicateAnnotation(candidateAbsStart: number, candidateAbsEnd: number,
  candidateConfidence: number,
  existingAnnotations: Array<{ startPosition: number; endPosition: number; confidenceScore?: number | null }>
): boolean
export async function getDocumentContext(documentId: string, fullText: string): Promise<DocumentContext | undefined>
export function clearDocumentContextCache(documentId?: string): void
```

**Called by:** routes.ts, projectRoutes.ts, projectSearch.ts, pipelineV2.ts

---

### pipelineV2.ts — Enhanced AI Pipeline
**Path:** `server/pipelineV2.ts`
**Purpose:** Improved 3-phase pipeline with noise filtering, larger chunks, stricter verification.

**Configuration:**
```typescript
export const PIPELINE_V2_CONFIG = {
  MODEL: 'gpt-4o-mini',
  CHUNK_SIZE: 1000,        // vs 500 in V1
  CHUNK_OVERLAP: 100,
  CANDIDATES_PER_CHUNK: 3,
  VERIFIER_THRESHOLD: 0.7,
  MIN_HIGHLIGHT_LENGTH: 15,
  MAX_HIGHLIGHT_LENGTH: 600,
  // Generator temp: 0.5, Verifier: 0.1, Refiner: 0.3
}
```

**Key function signatures:**
```typescript
// Text preprocessing
export function filterTextNoise(text: string): { cleanText: string; removedSections: string[] }
export function chunkTextV2(text: string, chunkSize?: number, overlap?: number): TextChunkDataV2[]

interface TextChunkDataV2 {
  text: string;
  startPosition: number;
  endPosition: number;
  originalStartPosition: number;
}

// V2 Pipeline phases
export async function generateCandidatesV2(chunk: string, intent: string,
  documentContext?: DocumentContext): Promise<CandidateAnnotation[]>
export function hardVerifyCandidateV2(candidate: CandidateAnnotation, chunk: string):
  { valid: boolean; errors: string[]; correctedCandidate?: CandidateAnnotation }
export async function softVerifyCandidatesV2(candidates: CandidateAnnotation[],
  chunk: string, intent: string): Promise<VerifierVerdict[]>
export async function verifyCandidatesV2(candidates: CandidateAnnotation[],
  chunk: string, chunkStart: number, intent: string,
  existingAnnotations: Array<{ startPosition: number; endPosition: number; confidenceScore?: number | null }>
): Promise<VerifiedCandidate[]>
export async function refineAnnotationsV2(verified: VerifiedCandidate[],
  intent: string, documentContext?: DocumentContext): Promise<RefinedAnnotation[]>

// Full pipeline
export async function processChunksWithPipelineV2(
  chunks: Array<{ text: string; startPosition: number; id: string }>,
  intent: string, documentId: string, fullText: string,
  existingAnnotations: Array<{ startPosition: number; endPosition: number; confidenceScore?: number | null }>
): Promise<PipelineAnnotation[]>

// Multi-prompt
export async function processChunksWithMultiplePrompts(
  chunks: Array<{ text: string; startPosition: number; id: string }>,
  prompts: Array<{ text: string; color: string; index: number }>,
  documentId: string, fullText: string,
  existingAnnotations: Array<{ startPosition: number; endPosition: number; confidenceScore?: number | null }>
): Promise<Map<number, PipelineAnnotation[]>>

// Context
export async function getDocumentContextV2(documentId: string, fullText: string): Promise<DocumentContext | undefined>
export function clearDocumentContextCacheV2(documentId?: string): void
```

**Called by:** routes.ts, projectRoutes.ts

---

### citationGenerator.ts — Chicago-Style Citations
**Path:** `server/citationGenerator.ts`
**Purpose:** Format structured citation metadata into Chicago-style footnotes, bibliographies, and inline citations.

```typescript
export function generateChicagoFootnote(citation: CitationData, pageNumber?: string, isSubsequent?: boolean): string
export function generateFootnoteWithQuote(citation: CitationData, quote: string, pageNumber?: string): string
export function generateInlineCitation(citation: CitationData, pageNumber?: string): string
export function generateChicagoBibliography(citation: CitationData): string
```

Supports: book, journal, chapter, website, newspaper, thesis, other.

---

### contextGenerator.ts — Semantic Context Synthesis
**Path:** `server/contextGenerator.ts`
**Purpose:** Generate semantic search contexts for documents, projects, and folders.

```typescript
export async function generateRetrievalContext(
  documentSummary: string, mainArguments: string[], keyConcepts: string[],
  projectThesis: string, roleInProject: string
): Promise<string>  // 200-300 word context

export async function generateProjectContextSummary(
  thesis: string, scope: string, documentContexts: string[]
): Promise<string>  // 150-200 word summary

export async function generateFolderContextSummary(
  folderDescription: string, documentContexts: string[], parentFolderContext?: string
): Promise<string>  // 100-150 word summary

export async function generateSearchableContent(
  highlightedText: string, note: string | null, category: string, documentContext?: string
): Promise<string>  // Annotation index string

export async function embedText(text: string): Promise<number[]>
```

Uses gpt-4.1-nano (via alt env vars), temperature 0.3, non-blocking with fallbacks.

---

### projectSearch.ts — Multi-Level Search
**Path:** `server/projectSearch.ts`
**Purpose:** Full-text and semantic search across projects.

```typescript
interface SearchFilters {
  categories?: AnnotationCategory[];
  folderIds?: string[];
  documentIds?: string[];
}

interface SearchResponse {
  results: GlobalSearchResult[];
  totalResults: number;
  searchTime: number;
}

export async function globalSearch(
  projectId: string, query: string, filters?: SearchFilters, limit?: number
): Promise<SearchResponse>

export async function searchProjectDocument(
  projectDocId: string, query: string
): Promise<SearchResult[]>
```

**Scoring:** exact substring match = 0.9, word-level matching = (matchedWords/totalWords) * 0.6 (requires 50%+ word match). Relevance: high (>=0.7), medium (0.5-0.7), low (<0.5).

---

### ocrProcessor.ts — OCR Processing
**Path:** `server/ocrProcessor.ts`
**Purpose:** Background OCR for scanned PDFs using PaddleOCR (Python) or OpenAI Vision.

```typescript
export async function processWithPaddleOcr(docId: string, tempPdfPath: string): Promise<void>
export async function processWithVisionOcr(docId: string, tempPdfPath: string): Promise<void>
export function saveTempPdf(buffer: Buffer): string
export function cleanupTempFiles(...paths: string[]): void
```

Both fire-and-forget (returns 202), update status processing → ready/error.

---

### chunker.ts — Legacy V1 Chunking
**Path:** `server/chunker.ts`

```typescript
export function chunkText(text: string, chunkSize?: number, overlap?: number): TextChunkData[]
export function extractTextFromTxt(content: string): string
```

500 char chunks, 50 char overlap. Superseded by V2 for most operations.

---

### vite.ts / static.ts — Dev & Production Serving
**Paths:** `server/vite.ts`, `server/static.ts`

```typescript
export async function setupVite(server: Server, app: Express): Promise<void>  // Dev: HMR
export function serveStatic(app: Express): void  // Prod: ./public/ with SPA fallback
```

---

## 6. API Endpoint Reference

**Total endpoints: 36** (11 in routes.ts, 25 in projectRoutes.ts)
**Auth: None** — all endpoints are public (no authentication implemented)

### Documents (routes.ts)

#### `POST /api/upload`
Upload PDF/TXT document with optional OCR mode.
```typescript
// Request: multipart/form-data
{ file: Binary (max 50MB), ocrMode?: "standard" | "advanced" | "vision" }

// Response 200 (standard mode):
{ id: string, filename: string, fullText: string, status: string,
  summary?: string, mainArguments?: string[], keyConcepts?: string[],
  chunkCount?: number, uploadDate: Date }

// Response 202 (OCR modes — processing in background):
// Same shape but status: "processing"

// 400: { message: "No file uploaded" | "garbled text" | "extraction failed" }
```

#### `GET /api/documents`
List all documents.
```typescript
// Response 200: Document[]
```

#### `GET /api/documents/:id`
Get single document with full text.
```typescript
// Response 200: Document
// 404: { message: "Document not found" }
```

#### `GET /api/documents/:id/status`
Poll document processing status.
```typescript
// Response 200:
{ id: string, status: "ready" | "processing" | "error",
  processingError?: string, filename: string, chunkCount?: number }
```

#### `GET /api/documents/:id/summary`
Get AI-generated summary.
```typescript
// Response 200:
{ summary?: string, mainArguments?: string[], keyConcepts?: string[] }
```

#### `GET /api/documents/:id/annotations`
List all annotations for document.
```typescript
// Response 200: Annotation[]
```

#### `POST /api/documents/:id/set-intent`
Trigger AI analysis pipeline.
```typescript
// Request:
{ intent: string, thoroughness?: "quick" | "standard" | "thorough" | "exhaustive" }

// Response 200: Annotation[] (created annotations)
// 400: { message: "Intent required" | "No chunks" }
// 409: { message: "Document still processing" | "Processing failed" }
```

#### `POST /api/documents/:id/annotate`
Create manual annotation.
```typescript
// Request:
{ startPosition: number, endPosition: number, highlightedText: string,
  category: AnnotationCategory, note: string, isAiGenerated?: boolean }

// Response 200: Annotation
// 400: { message: "Missing required fields" }
```

#### `PUT /api/annotations/:id`
Update annotation.
```typescript
// Request: { note: string, category: AnnotationCategory }
// Response 200: Annotation
// 400 | 404
```

#### `DELETE /api/annotations/:id`
```typescript
// Response 200: { success: true }
```

#### `POST /api/documents/:id/search`
Search within document.
```typescript
// Request: { query: string }
// Response 200: SearchResult[] =
//   [{ text: string, startPosition: number, endPosition: number, similarity: number }]
```

---

### Projects (projectRoutes.ts)

#### `POST /api/projects`
```typescript
// Request: { name: string, thesis?: string, scope?: string, description?: string }
// Response 201: Project
```

#### `GET /api/projects`
```typescript
// Response 200: Project[] (ordered by createdAt desc)
```

#### `GET /api/projects/:id`
```typescript
// Response 200: Project
// 404
```

#### `PUT /api/projects/:id`
Triggers context regeneration if thesis/scope changes.
```typescript
// Request: Partial<{ name, thesis, scope, description, contextSummary }>
// Response 200: Project
```

#### `DELETE /api/projects/:id`
```typescript
// Response 204 (no body)
```

---

### Prompt Templates (projectRoutes.ts)

#### `POST /api/projects/:projectId/prompt-templates`
```typescript
// Request: { name: string, prompts: string[] }
// Response 201: PromptTemplate
```

#### `GET /api/projects/:projectId/prompt-templates`
```typescript
// Response 200: PromptTemplate[]
```

#### `PUT /api/prompt-templates/:id`
```typescript
// Request: Partial<{ name, prompts }>
// Response 200: PromptTemplate
```

#### `DELETE /api/prompt-templates/:id`
```typescript
// Response 204
```

---

### Folders (projectRoutes.ts)

#### `POST /api/projects/:projectId/folders`
```typescript
// Request: { name: string, parentFolderId?: string | null }
// Response 201: Folder
```

#### `GET /api/projects/:projectId/folders`
```typescript
// Response 200: Folder[] (sorted by sortOrder, then name)
```

#### `PUT /api/folders/:id`
```typescript
// Request: Partial<{ name, parentFolderId }>
// Response 200: Folder
```

#### `DELETE /api/folders/:id`
Cascades: deletes child folders and project documents in folder.
```typescript
// Response 204
```

#### `PUT /api/folders/:id/move`
```typescript
// Request: { parentFolderId?: string | null }
// Response 200: Folder
```

---

### Project Documents (projectRoutes.ts)

#### `POST /api/projects/:projectId/documents`
Add document to project. Auto-generates retrieval context and citation metadata in background.
```typescript
// Request: { documentId: string, folderId?: string | null, roleInProject?: string }
// Response 201: ProjectDocument
```

#### `POST /api/projects/:projectId/documents/batch`
Batch add multiple documents.
```typescript
// Request: { documentIds: string[], folderId?: string | null }
// Response 201:
{ totalRequested: number, added: number, alreadyExists: number, failed: number,
  results: Array<{ documentId: string, filename: string,
    status: "added" | "already_exists" | "failed",
    projectDocumentId?: string, error?: string }> }
```

#### `GET /api/projects/:projectId/documents`
```typescript
// Response 200: Array<ProjectDocument & { document: { id, filename, summary } }>
```

#### `GET /api/project-documents/:id`
```typescript
// Response 200: ProjectDocument
```

#### `PUT /api/project-documents/:id`
```typescript
// Request: Partial<{ roleInProject, folderId, retrievalContext, citationData, scrollPosition }>
// Response 200: ProjectDocument
```

#### `PUT /api/project-documents/:id/move`
```typescript
// Request: { folderId?: string | null }
// Response 200: ProjectDocument
```

#### `PUT /api/project-documents/:id/citation`
```typescript
// Request: CitationData fields
// Response 200: ProjectDocument
```

#### `PUT /api/project-documents/:id/view-state`
```typescript
// Request: { scrollPosition?: number }
// Response 200: ProjectDocument (lastViewedAt set to now)
```

#### `DELETE /api/project-documents/:id`
Does NOT delete the base document.
```typescript
// Response 204
```

---

### Project Annotations (projectRoutes.ts)

#### `POST /api/project-documents/:id/annotations`
Creates annotation with search indexing in background.
```typescript
// Request:
{ startPosition: number, endPosition: number, highlightedText: string,
  category: AnnotationCategory, note?: string, isAiGenerated?: boolean,
  confidenceScore?: number, promptText?: string, promptIndex?: number,
  promptColor?: string, analysisRunId?: string }

// Response 201: ProjectAnnotation
```

#### `GET /api/project-documents/:id/annotations`
```typescript
// Response 200: ProjectAnnotation[] (sorted by startPosition)
```

#### `PUT /api/project-annotations/:id`
```typescript
// Request: Partial<ProjectAnnotation fields>
// Response 200: ProjectAnnotation
```

#### `DELETE /api/project-annotations/:id`
```typescript
// Response 204
```

---

### AI Analysis (projectRoutes.ts)

#### `POST /api/project-documents/:id/analyze`
Single-prompt analysis. Incorporates project thesis.
```typescript
// Request: { intent: string, thoroughness?: "quick" | "standard" | "thorough" | "exhaustive" }
// Response 200:
{ annotations: ProjectAnnotation[],
  stats: { chunksAnalyzed: number, totalChunks: number,
           annotationsCreated: number, coverage: number } }
```

#### `POST /api/project-documents/:id/analyze-multi`
Multi-prompt parallel analysis. Each prompt runs independently through V2 pipeline.
```typescript
// Request:
{ prompts: Array<{ text: string, color?: string }>,
  thoroughness?: "quick" | "standard" | "thorough" | "exhaustive" }

// Response 200:
{ analysisRunId: string,
  results: Array<{ promptIndex: number, promptText: string, annotationsCreated: number }>,
  totalAnnotations: number,
  annotations: ProjectAnnotation[],
  stats: { chunksAnalyzed: number, totalChunks: number, coverage: number } }
```

#### `POST /api/projects/:projectId/batch-analyze`
Batch analyze multiple documents (2 concurrent).
```typescript
// Request:
{ projectDocumentIds: string[], intent: string,
  thoroughness?: "quick" | "standard" | "thorough" | "exhaustive",
  constraints?: { categories?: AnnotationCategory[],
                  maxAnnotationsPerDoc?: number, minConfidence?: number } }

// Response 200:
{ jobId: string, status: "completed" | "partial" | "failed",
  totalDocuments: number, successfulDocuments: number, failedDocuments: number,
  totalAnnotationsCreated: number, totalTimeMs: number,
  results: Array<{ projectDocumentId: string, filename: string,
    status: "completed" | "failed" | "pending",
    annotationsCreated: number, error?: string }> }
```

---

### Search (projectRoutes.ts)

#### `POST /api/projects/:projectId/search`
Global search across project context, folders, documents, annotations.
```typescript
// Request: { query: string, filters?: object, limit?: number }
// Response 200:
{ results: GlobalSearchResult[], totalResults: number, searchTime: number }

// GlobalSearchResult:
{ type: "annotation" | "document_context" | "folder_context",
  documentId?: string, documentFilename?: string,
  folderId?: string, folderName?: string, annotationId?: string,
  matchedText: string, highlightedText?: string,
  note?: string, category?: AnnotationCategory,
  citationData?: CitationData, similarityScore: number,
  relevanceLevel: "high" | "medium" | "low", startPosition?: number }
```

#### `POST /api/project-documents/:id/search`
Search within single project document using chunk embeddings.
```typescript
// Request: { query: string }
// Response 200: SearchResult[]
```

---

### Citations (projectRoutes.ts)

#### `POST /api/citations/generate`
```typescript
// Request: { citationData: CitationData, pageNumber?: string, isSubsequent?: boolean }
// Response 200: { footnote: string, bibliography: string }
```

#### `POST /api/citations/ai`
AI-extract citation metadata from document text.
```typescript
// Request: { documentId: string, highlightedText?: string }
// Response 200: { footnote: string, bibliography: string, citationData: CitationData }
// 422: { error: string, footnote: string, bibliography: string } (fallback)
```

#### `POST /api/citations/footnote-with-quote`
```typescript
// Request: { citationData?: CitationData, quote: string, pageNumber?: string }
// Response 200:
{ footnote: string, footnoteWithQuote: string,
  inlineCitation: string, bibliography: string }
```

#### `POST /api/project-annotations/:id/footnote`
```typescript
// Request: { pageNumber?: string }
// Response 200:
{ footnote: string, footnoteWithQuote: string,
  inlineCitation: string, bibliography: string, citationData?: CitationData }
```

---

## 7. Client — Pages

### Home.tsx — Single-Document Analysis Hub
**Path:** `client/src/pages/Home.tsx`
**Layout:** 4-column grid: IntentPanel | DocumentViewer | AnnotationSidebar | SearchPanel

**State:**
- `currentDocumentId: string | null` — loaded document
- `selectedAnnotationId: string | null` — focused annotation
- `uploadProgress: number` — 0-100
- `hasAnalyzed: boolean` — analysis completed flag
- `showUpload: boolean` — toggle upload vs analysis view
- `manualDialogOpen: boolean` — manual annotation dialog
- `pendingSelection: { text, start, end } | null` — text selection

**API calls:** `useDocument`, `useDocumentStatus` (2s poll), `useAnnotations`, `useUploadDocument`, `useSetIntent`, `useAddAnnotation`, `useUpdateAnnotation`, `useDeleteAnnotation`, `useSearchDocument`

**Behavior:** Upload → status poll → set intent + thoroughness → view annotated highlights → manual annotate via text selection

---

### Projects.tsx — Project Listing
**Path:** `client/src/pages/Projects.tsx`
**Layout:** Grid of project cards with create dialog

**State:** `isCreateOpen`, `newProject: { name, description, thesis, scope }`

**API calls:** `useProjects`, `useCreateProject`, `useDeleteProject`

---

### ProjectWorkspace.tsx — Project Management
**Path:** `client/src/pages/ProjectWorkspace.tsx`
**Layout:** Left sidebar (FolderTree) + main area (document grid) + header (search, batch ops)

**Subcomponents:** `FolderTree` (recursive), `SearchResultCard`

**State:** `selectedFolderId`, `searchQuery`, `searchResults`, `isSearching`, `isAddFolderOpen`, `isAddDocOpen`, `newFolderName`, `selectedDocId`, `citationModal`, `isBatchModalOpen`, `isBatchUploadOpen`, `generatingCitationFor`, `generatingFootnoteFor`

**API calls:** `useProject`, `useFolders`, `useProjectDocuments`, `useCreateFolder`, `useDeleteFolder`, `useAddDocumentToProject`, `useRemoveDocumentFromProject`, `useGlobalSearch`, `useGenerateCitation`, `useUploadDocument`

---

### ProjectDocument.tsx — Document Analysis in Project
**Path:** `client/src/pages/ProjectDocument.tsx`
**Layout:** 4-column: MultiPromptPanel | DocumentViewer | SearchPanel | AnnotationSidebar

**State:** `hasAnalyzed`, `selectedAnnotationId`, `manualDialogOpen`, `isCitationOpen`, `pendingSelection`, `citationForm` (structured authors array), `citationPreview`, `isAutoFilling`

**API calls:** `useProject`, `useProjectAnnotations`, `useCreateProjectAnnotation`, `useDeleteProjectAnnotation`, `useUpdateProjectDocument`, `useAnalyzeProjectDocument`, `useAnalyzeMultiPrompt`, `usePromptTemplates`, `useCreatePromptTemplate`, `useSearchProjectDocument`, `useGenerateCitation`

---

### not-found.tsx — 404 Page
**Path:** `client/src/pages/not-found.tsx`

---

## 8. Client — Components

### FileUpload.tsx
**Path:** `client/src/components/FileUpload.tsx`
```typescript
interface FileUploadProps {
  onUpload: (file: File, ocrMode: string) => Promise<void>;
  isUploading: boolean;
  uploadProgress: number;
}
```
**State:** `dragActive`, `selectedFile`, `ocrMode: "standard" | "advanced" | "vision"`
**Behavior:** Drag-drop, PDF/TXT only, OCR selector for PDFs, progress bar

---

### DocumentViewer.tsx
**Path:** `client/src/components/DocumentViewer.tsx`
```typescript
interface AnnotationWithPrompt extends Omit<Annotation, 'promptText' | 'promptIndex' | 'promptColor'> {
  promptText?: string | null;
  promptIndex?: number | null;
  promptColor?: string | null;
}

interface DocumentViewerProps {
  document: Document | null;
  annotations: AnnotationWithPrompt[];
  isLoading: boolean;
  selectedAnnotationId: string | null;
  onAnnotationClick: (annotation: AnnotationWithPrompt) => void;
  onTextSelect?: (selection: { text: string; start: number; end: number }) => void;
}
```
**Behavior:** Auto-scroll to selected annotation, loading/error/processing states, delegates to HighlightedText

---

### HighlightedText.tsx
**Path:** `client/src/components/HighlightedText.tsx`
```typescript
interface HighlightedTextProps {
  text: string;
  annotations: AnnotationWithPrompt[];
  onAnnotationClick: (annotation: AnnotationWithPrompt) => void;
  selectedAnnotationId: string | null;
  onTextSelect?: (selection: { text: string; start: number; end: number }) => void;
}
```
**Behavior:** Segments text into annotated/plain, TreeWalker for selection offsets, popovers on click, prompt color support, confidence bar

---

### IntentPanel.tsx
**Path:** `client/src/components/IntentPanel.tsx`
```typescript
type ThoroughnessLevel = 'quick' | 'standard' | 'thorough' | 'exhaustive';

interface IntentPanelProps {
  documentId: string | null;
  onAnalyze: (research: string, goals: string, thoroughness: ThoroughnessLevel) => Promise<void>;
  isAnalyzing: boolean;
  hasAnalyzed: boolean;
  annotationCount: number;
  defaultResearch?: string;
  defaultGoals?: string;
}
```
**State:** `research`, `goals`, `thoroughness`

---

### AnnotationSidebar.tsx
**Path:** `client/src/components/AnnotationSidebar.tsx`
```typescript
interface AnnotationSidebarProps {
  annotations: AnnotationWithPrompt[];
  isLoading: boolean;
  selectedAnnotationId: string | null;
  onSelect: (annotation: AnnotationWithPrompt) => void;
  onDelete: (annotationId: string) => void;
  onUpdate: (annotationId: string, note: string, category: AnnotationCategory) => void;
  onAddManual: () => void;
  canAddManual: boolean;
  showFootnoteButton?: boolean;
  onCopyFootnote?: (annotationId: string) => void;
}
```
**State:** `filter: FilterType`, `promptFilter: "all" | number`, `editingAnnotation`, `editNote`, `editCategory`, `deleteConfirmId`
**Category colors:** key_quote=yellow, argument=green, evidence=blue, methodology=purple, user_added=orange

---

### SearchPanel.tsx
**Path:** `client/src/components/SearchPanel.tsx`
```typescript
interface SearchPanelProps {
  documentId: string | null;
  onSearch: (query: string) => Promise<SearchResult[]>;
  onJumpToPosition: (start: number, end: number) => void;
}
```
**State:** `isOpen`, `query`, `results`, `isSearching`, `showAllResults`

---

### ManualAnnotationDialog.tsx
**Path:** `client/src/components/ManualAnnotationDialog.tsx`
```typescript
interface ManualAnnotationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedText: { text: string; start: number; end: number } | null;
  onSave: (note: string, category: AnnotationCategory) => void;
}
```

---

### MultiPromptPanel.tsx
**Path:** `client/src/components/MultiPromptPanel.tsx`
```typescript
export interface Prompt {
  id: string;
  text: string;
  color: string;
}

interface MultiPromptPanelProps {
  documentId: string | null;
  projectId?: string;
  onAnalyze: (prompts: Prompt[], thoroughness: ThoroughnessLevel) => Promise<void>;
  isAnalyzing: boolean;
  hasAnalyzed: boolean;
  annotationCount: number;
  promptStats?: Map<number, number>;
  templates?: PromptTemplate[];
  onSaveTemplate?: (name: string, prompts: Prompt[]) => Promise<void>;
  onLoadTemplate?: (template: PromptTemplate) => void;
  isSavingTemplate?: boolean;
}
```
**State:** `prompts: Prompt[]`, `thoroughness`, `saveDialogOpen`, `templateName`
**Max 8 prompts**, auto-assigned colors

---

### BatchAnalysisModal.tsx
**Path:** `client/src/components/BatchAnalysisModal.tsx`
```typescript
interface BatchAnalysisModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  documents: (ProjectDocument & { document: { id: string; filename: string; summary: string | null } })[];
  projectThesis?: string | null;
}
```
**State:** `selectedIds: Set<string>`, `intent`, `advancedOpen`, `selectedCategories`, `maxAnnotations` (1-50), `minConfidence` (0.5-1), `response`

---

### BatchUploadModal.tsx
**Path:** `client/src/components/BatchUploadModal.tsx`
```typescript
interface BatchUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  availableDocuments: Document[];
  folders: Folder[];
  currentFolderId: string | null;
}
```
Two tabs: From Library / Upload New. **State:** `activeTab`, `selectedIds`, `targetFolderId`, `filesToUpload`, `uploadedFiles`, `batchOcrMode`

---

### DocumentSummary.tsx
**Path:** `client/src/components/DocumentSummary.tsx`
```typescript
interface DocumentSummaryProps {
  document: Document | null;
  isLoading: boolean;
}
```

### ThemeToggle.tsx
**Path:** `client/src/components/ThemeToggle.tsx`
Light/dark toggle via localStorage + system preference.

---

## 9. Client — Hooks

### useDocument.ts
**Path:** `client/src/hooks/useDocument.ts`

| Hook | Method | Endpoint | Returns | Used By |
|------|--------|----------|---------|---------|
| `useDocuments()` | GET | `/api/documents` | `Document[]` | Home, BatchUploadModal |
| `useDocument(id)` | GET | `/api/documents/{id}` | `Document` | Home, ProjectDocument |
| `useDocumentStatus(id)` | GET | `/api/documents/{id}/status` | `{id,status,error,filename,chunkCount}` | Home (2s poll) |
| `useAnnotations(docId)` | GET | `/api/documents/{id}/annotations` | `Annotation[]` | Home |
| `useUploadDocument()` | POST | `/api/upload` | `Document` | Home, ProjectWorkspace |
| `useSetIntent()` | POST | `/api/documents/{id}/set-intent` | `Annotation[]` | Home |
| `useAddAnnotation()` | POST | `/api/documents/{id}/annotate` | `Annotation` | Home |
| `useUpdateAnnotation()` | PUT | `/api/annotations/{id}` | `Annotation` | Home |
| `useDeleteAnnotation()` | DELETE | `/api/annotations/{id}` | void | Home |
| `useSearchDocument()` | POST | `/api/documents/{id}/search` | `SearchResult[]` | Home |

### useProjects.ts
**Path:** `client/src/hooks/useProjects.ts`

| Hook | Method | Endpoint | Returns | Used By |
|------|--------|----------|---------|---------|
| `useProjects()` | GET | `/api/projects` | `Project[]` | Projects |
| `useProject(id)` | GET | `/api/projects/{id}` | `Project` | ProjectWorkspace, ProjectDocument |
| `useCreateProject()` | POST | `/api/projects` | `Project` | Projects |
| `useUpdateProject()` | PUT | `/api/projects/{id}` | `Project` | — |
| `useDeleteProject()` | DELETE | `/api/projects/{id}` | void | Projects |
| `useFolders(projectId)` | GET | `/api/projects/{id}/folders` | `Folder[]` | ProjectWorkspace |
| `useCreateFolder()` | POST | `/api/projects/{id}/folders` | `Folder` | ProjectWorkspace |
| `useDeleteFolder()` | DELETE | `/api/folders/{id}` | void | ProjectWorkspace |
| `useProjectDocuments(projectId)` | GET | `/api/projects/{id}/documents` | `(ProjectDocument & {document})[]` | ProjectWorkspace |
| `useAddDocumentToProject()` | POST | `/api/projects/{id}/documents` | `ProjectDocument` | ProjectWorkspace |
| `useRemoveDocumentFromProject()` | DELETE | `/api/project-documents/{id}` | void | ProjectWorkspace |
| `useUpdateProjectDocument()` | PUT | `/api/project-documents/{id}` | `ProjectDocument` | ProjectDocument |
| `useProjectAnnotations(docId)` | GET | `/api/project-documents/{id}/annotations` | `ProjectAnnotation[]` | ProjectDocument |
| `useCreateProjectAnnotation()` | POST | `/api/project-documents/{id}/annotations` | `ProjectAnnotation` | ProjectDocument |
| `useDeleteProjectAnnotation()` | DELETE | `/api/project-annotations/{id}` | void | ProjectDocument |
| `useAnalyzeProjectDocument()` | POST | `/api/project-documents/{id}/analyze` | `{annotations, stats}` | ProjectDocument |
| `useSearchProjectDocument()` | POST | `/api/project-documents/{id}/search` | `SearchResult[]` | ProjectDocument |
| `useBatchAnalyze()` | POST | `/api/projects/{id}/batch-analyze` | `BatchAnalysisResponse` | BatchAnalysisModal |
| `useBatchAddDocuments()` | POST | `/api/projects/{id}/documents/batch` | `BatchAddDocumentsResponse` | BatchUploadModal |
| `useAnalyzeMultiPrompt()` | POST | `/api/project-documents/{id}/analyze-multi` | `{analysisRunId, results, annotations, stats}` | ProjectDocument |
| `usePromptTemplates(projectId)` | GET | `/api/projects/{id}/prompt-templates` | `PromptTemplate[]` | ProjectDocument |
| `useCreatePromptTemplate()` | POST | `/api/projects/{id}/prompt-templates` | `PromptTemplate` | ProjectDocument |
| `useDeletePromptTemplate()` | DELETE | `/api/prompt-templates/{id}` | void | — |

### useProjectSearch.ts
**Path:** `client/src/hooks/useProjectSearch.ts`

| Hook | Method | Endpoint | Returns | Used By |
|------|--------|----------|---------|---------|
| `useGlobalSearch()` | POST | `/api/projects/{id}/search` | `SearchResponse` | ProjectWorkspace |
| `useGenerateCitation()` | POST | `/api/citations/generate` | `{footnote, bibliography}` | ProjectWorkspace, ProjectDocument |

### UI Hooks (shadcn)
- `use-toast` — Toast notification system
- `use-mobile` — Responsive breakpoint detection

---

## 10. Client — Utilities & Styling

### lib/queryClient.ts
```typescript
export async function apiRequest(method: string, url: string, data?: unknown): Promise<Response>
export function getQueryFn(options: { on401: "returnNull" | "throw" }): QueryFunction
export const queryClient: QueryClient
// Config: no refetch on focus, infinite stale time, no retries, credentials: "include"
```

### lib/utils.ts
```typescript
export function cn(...inputs: ClassValue[]): string  // clsx + tailwind-merge
```

### index.css
- Tailwind with light/dark CSS variables
- Elevation utilities: `hover-elevate`, `active-elevate`, `toggle-elevate`
- Fonts: Inter, Merriweather, JetBrains Mono
- Default radius: 0.5rem

---

## 11. AI Pipeline Architecture

### Three-Phase V2 Pipeline
```
Document Text
    │
    ▼
filterTextNoise()
  Removes: references (>50% of doc), metadata headers (DOI, copyright),
  footnote clusters, page numbers, volume/issue patterns
    │
    ▼
chunkTextV2(text, 1000, 100)
  1000 char chunks, 100 overlap
  Smart boundaries: paragraph > sentence > clause
  Tracks original positions in full text
    │
    ▼
Generate embeddings (text-embedding-3-small, 1536-dim)
    │
    ▼
Rank chunks by cosine similarity to intent
  quick: top 5-10 chunks (similarity >= 0.3)
  standard: top 10-30 (>= 0.3)
  thorough: top 20-100 (>= 0.3)
  exhaustive: top 50-999 (>= 0.1)
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  PHASE 1: GENERATOR  (gpt-4o-mini, temp 0.5)           │
│                                                         │
│  Input: chunk text + research intent + document context │
│  Output: up to 3 CandidateAnnotation per chunk          │
│                                                         │
│  CandidateAnnotation {                                  │
│    highlightStart: number   // relative to chunk        │
│    highlightEnd: number                                 │
│    highlightText: string                                │
│    category: AnnotationCategory                         │
│    note: string                                         │
│    confidence: number (0-1)                             │
│  }                                                      │
│                                                         │
│  Explicit instructions to skip references, metadata,    │
│  author names, page numbers, boilerplate                │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  PHASE 2: VERIFIER                                      │
│                                                         │
│  Hard verify (no LLM):                                  │
│  - Text exists in chunk (fuzzy match)                   │
│  - Length: 15-600 chars                                  │
│  - Not a noise pattern (reference, citation, DOI,       │
│    figure caption, copyright)                           │
│  - Not a duplicate (>50% overlap with existing)         │
│                                                         │
│  Soft verify (gpt-4o-mini, temp 0.1):                   │
│  - Relevance to research intent (most important)        │
│  - Substantive content (not boilerplate)                │
│  - Category accuracy                                    │
│  - Quality score 0-1 (threshold: 0.7)                   │
│                                                         │
│  Output: VerifiedCandidate[] (passed both checks)       │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  PHASE 3: REFINER  (gpt-4o-mini, temp 0.3)             │
│                                                         │
│  - Polish notes for clarity                             │
│  - Confirm/adjust categories                            │
│  - Require explanation of WHY it matters to intent      │
│  - Small sets (<=2) bypass refinement                   │
│                                                         │
│  Output: RefinedAnnotation[]                            │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
Convert relative positions → absolute positions
    │
    ▼
PipelineAnnotation[] {
  absoluteStart: number,  absoluteEnd: number,
  highlightText: string,  category: AnnotationCategory,
  note: string,           confidence: number
}
```

### Multi-Prompt Processing
```
User provides N prompts (max 8), each with color
    │
    ▼
All prompts share the SAME ranked chunks
    │
    ▼
Each prompt runs through full V2 pipeline INDEPENDENTLY
(isolated duplicate detection per prompt)
    │
    ▼
Annotations tagged: promptIndex, promptText, promptColor, analysisRunId
    │
    ▼
Map<promptIndex, PipelineAnnotation[]>
```

### OCR Pipeline
```
Upload scanned PDF
    │
    ▼ POST /api/upload (ocrMode: "advanced" | "vision")
Save temp PDF, return 202 Accepted immediately
    │
    ├──── PaddleOCR ──────────────────┐
    │  python pdf_pipeline.py         │
    │  --mode=ocr --model=ppocr       │
    │  --dpi=200                      │
    │                                 │
    ├──── Vision OCR ─────────────────┤
    │  pdf_to_images.py → images      │
    │  GPT-4o Vision (5 concurrent)   │
    │  Per-page text extraction       │
    │  Tables → pipe-delimited        │
    │  Footnotes → labeled            │
    │                                 │
    └────────────┬────────────────────┘
                 │
                 ▼
    Normalize whitespace, join pages
                 │
                 ▼
    chunkTextV2() → create chunks
                 │
                 ▼
    generateDocumentSummary() (background)
                 │
                 ▼
    Update status: "processing" → "ready" (or "error")
                 │
                 ▼
    Frontend polls GET /api/documents/:id/status (2s)
    Transitions to analysis view when ready
```

---

## 12. Data Flow Diagrams

### Document Upload & Analysis
```
User selects PDF/TXT → FileUpload.tsx
    │
    ▼ POST /api/upload (multipart, max 50MB)
multer receives file
    │
    ├── TXT: extractTextFromTxt() → text
    ├── PDF standard: pdf-parse → text (check garbled)
    ├── PDF advanced: save temp → processWithPaddleOcr() (background)
    └── PDF vision: save temp → processWithVisionOcr() (background)
    │
    ▼
storage.createDocument({ filename, fullText })
    │
    ▼
chunkTextV2(fullText) → TextChunkDataV2[]
    │
    ▼
storage.createChunk() for each chunk
    │
    ▼ (background, non-blocking)
generateDocumentSummary(fullText) → { summary, mainArguments, keyConcepts }
storage.updateDocument(id, { summary, ... })
    │
    ▼
User enters intent + thoroughness → IntentPanel.tsx
    │
    ▼ POST /api/documents/:id/set-intent
Generate embeddings for chunks (if missing)
Rank chunks by similarity to intent
Delete existing AI annotations
    │
    ▼
processChunksWithPipelineV2(rankedChunks, intent, ...)
  → Phase 1: Generate candidates
  → Phase 2: Verify (hard + soft)
  → Phase 3: Refine
    │
    ▼
storage.createAnnotation() for each PipelineAnnotation
    │
    ▼
Return Annotation[] to client
    │
    ▼
DocumentViewer + HighlightedText render highlights
AnnotationSidebar shows annotation list
```

### Project Workflow
```
User creates project (name, thesis, scope)
    │ POST /api/projects
    ▼ (background: generateProjectContextSummary)

User creates folders
    │ POST /api/projects/:id/folders
    ▼

User adds documents (single or batch)
    │ POST /api/projects/:id/documents
    ▼ (background: generateRetrievalContext + extractCitationMetadata)

User navigates to project document
    │ GET /api/project-documents/:id + GET /api/documents/:id
    ▼

User runs analysis (single-prompt or multi-prompt)
    │ POST /api/project-documents/:id/analyze[-multi]
    ▼
Pipeline V2 with project thesis as context
    │
    ▼
projectStorage.createProjectAnnotation() for each result
(background: generateSearchableContent + embedText for each)
    │
    ▼
User searches across project
    │ POST /api/projects/:id/search
    ▼
globalSearch() → text matching across annotations, docs, folders
    │
    ▼
User generates citations
    │ POST /api/project-annotations/:id/footnote
    ▼
citationGenerator → Chicago-style footnote + bibliography
```

### Search Flow
```
User enters query in ProjectWorkspace search bar
    │
    ▼ POST /api/projects/:projectId/search
globalSearch(projectId, query, filters, limit=20)
    │
    ├── Search project context (thesis + scope)
    │   textMatchScore(query, contextSummary) → score
    │
    ├── Search folder contexts
    │   For each folder: textMatchScore(query, contextSummary)
    │   Return as type: "folder_context"
    │
    ├── Search document contexts
    │   For each projectDocument: textMatchScore(query, retrievalContext)
    │   Return as type: "document_context"
    │
    └── Search annotations
        For each projectAnnotation:
          textMatchScore(query, searchableContent || highlightedText + note)
          Return as type: "annotation"
    │
    ▼
All results scored:
  - Exact substring match → 0.9
  - Word-level match → (matchedWords / totalWords) * 0.6
  - Minimum 50% word match required for non-zero score
    │
    ▼
Sort by similarityScore descending
Tag relevance: high (>=0.7), medium (0.5-0.7), low (<0.5)
Limit to 20 results
    │
    ▼
Return { results: GlobalSearchResult[], totalResults, searchTime }
```

---

## 13. Auth & Middleware

### Authentication
**There is NO authentication implemented.** All 36 API endpoints are publicly accessible. The schema includes a legacy `users` table (id, username, password) but it is not used anywhere. No API key validation, no sessions, no JWT, no RBAC.

### Middleware Chain (in order)
1. **dotenv/config** — Loads `.env` file into `process.env`
2. **express.json()** — Parses JSON bodies; custom verify saves raw buffer to `req.rawBody` (for future webhook signature verification)
3. **express.urlencoded({ extended: false })** — Parses URL-encoded form data
4. **Request Logger** — Intercepts all `/api/*` requests, logs: `{method} {path} {statusCode} {durationMs}` plus JSON response body
5. **Route Handlers** — routes.ts endpoints, then projectRoutes.ts endpoints
6. **Error Handler** — Express error middleware `(err, req, res, next)`, returns `{ message: err.message }` with appropriate status
7. **Vite Dev Server** (development only) — Proxies non-API requests to Vite for HMR and client code
8. **Static File Server** (production only) — Serves `./dist/public/`, SPA fallback to index.html

### Protected vs Public Routes
All routes are public. No middleware checks authentication.

---

## 14. Environment Variables & Configuration

### Environment Variables
| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `OPENAI_API_KEY` | **Yes** | — | OpenAI API credentials for all AI features |
| `PORT` | No | 5001 | Server port |
| `NODE_ENV` | No | development | development or production |
| `CANDIDATES_PER_CHUNK` | No | 3 | Pipeline candidates per chunk |
| `VERIFIER_THRESHOLD` | No | 0.7 | Quality score threshold |
| `LLM_CONCURRENCY` | No | 5 | Parallel LLM requests |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | No | — | Alt API key for context generator |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | No | — | Alt base URL for context generator |

### AI Models
| Purpose | Model | Notes |
|---------|-------|-------|
| Embeddings | text-embedding-3-small | 1536-dim vectors |
| Analysis pipeline | gpt-4o-mini | All 3 phases |
| Context generation | gpt-4.1-nano | Via alt env vars |
| Vision OCR | gpt-4o | Page-by-page extraction |
| Citation extraction | gpt-4o-mini | Structured output |

### External Dependencies
- **OpenAI API** — embeddings, analysis, summarization, citation extraction, Vision OCR
- **Python + PaddleOCR** — advanced OCR mode (`server/python/pdf_pipeline.py`)
- **SQLite** — local file database at `./data/sourceannotator.db`

### Key Configuration Values
| Setting | Value |
|---------|-------|
| Upload max | 50MB |
| Formats | PDF, TXT |
| V2 chunk size | 1000 chars |
| V2 chunk overlap | 100 chars |
| Min highlight | 15 chars |
| Max highlight | 600 chars |
| Verifier threshold | 0.7 |
| Duplicate overlap | 0.5 |
| LLM concurrency | 5 parallel |
| Batch analysis concurrency | 2 docs |
| Vision OCR concurrency | 5 pages |
| Max multi-prompts | 8 |
| Batch analyze max | 50 docs |

---

## 15. Analysis & Recommendations

### Summary Statistics
- **Total API endpoints:** 36 (11 document, 25 project)
- **Total database tables:** 9 (documents, textChunks, annotations, projects, folders, projectDocuments, projectAnnotations, promptTemplates, users)
- **Total server files:** 15
- **Total client pages:** 5
- **Total client components:** 12 custom + 50+ shadcn/ui
- **Total custom hooks:** 40+ hook functions across 3 files

### Incomplete / Undocumented Areas
1. **No authentication** — The `users` table exists but is unused. All endpoints are public. This is the biggest gap.
2. **No delete endpoint for documents** — `DELETE /api/documents/:id` is not implemented despite `storage.deleteDocument()` existing.
3. **Prompt templates store `string[]`** in the API but the schema stores `{text, color}[]` — potential type mismatch between template creation API and multi-prompt analysis.
4. **Search is text-based only** — `globalSearch` uses word matching, not embeddings. The `searchEmbedding` field on projectAnnotations is populated but not used by the search function. Embedding-based search is only used for single-document search via `searchProjectDocument`.
5. **No pagination** — `GET /api/documents` and `GET /api/projects` return all records. Will be a problem at scale.
6. **Legacy V1 pipeline** — `openai.ts` still contains the full V1 pipeline code. Only V2 (`pipelineV2.ts`) is used. V1 could be removed.
7. **`chunker.ts`** — Legacy V1 chunking, only used for TXT files. Could be consolidated into pipelineV2.

### Best Endpoints for a Claude.ai Skill (search sources, fetch annotations, find quotes)

**Primary (use these most):**
1. `POST /api/projects/:projectId/search` — Search across all project sources, returns annotated quotes with relevance scores. **This is your main entry point.**
2. `GET /api/project-documents/:id/annotations` — Fetch all annotations for a specific document with highlighted text, categories, and notes.
3. `POST /api/project-documents/:id/search` — Semantic search within a single document for specific quotes.

**Supporting:**
4. `GET /api/projects` — List projects to get project IDs.
5. `GET /api/projects/:projectId/documents` — List documents in a project with filenames and summaries.
6. `GET /api/documents/:id` — Get full document text when you need the raw source.
7. `GET /api/documents/:id/summary` — Quick overview of a document without fetching full text.

**For creating/modifying:**
8. `POST /api/project-documents/:id/annotations` — Create new annotations (category: user_added).
9. `POST /api/project-documents/:id/analyze` — Trigger AI analysis with a research intent.
10. `POST /api/project-annotations/:id/footnote` — Generate Chicago-style footnote for citing a quote.

---

*Last updated: February 10, 2026*
