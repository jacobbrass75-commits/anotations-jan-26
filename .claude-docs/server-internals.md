# Server Internals Reference

All server code lives in `/server/`.

---

## index.ts - Server Entry Point

- Creates Express app with HTTP server
- **Middleware**: JSON body parser (with raw body capture), URL-encoded parser, request logger, error handler
- **Request logging**: Captures method, path, status code, response time
- **Error handler**: Returns `{message}` with appropriate status code
- Calls `registerRoutes()` to set up all API routes
- In dev: uses Vite dev server with HMR. In prod: serves static build
- Listens on `0.0.0.0:5001` (or `PORT` env var)
- **Exports**: `log(message, source?)` for formatted console logging

---

## db.ts - Database Setup

- Creates `./data/` directory if missing
- Opens SQLite via better-sqlite3 at `./data/sourceannotator.db`
- Enables foreign key constraints via `PRAGMA foreign_keys = ON`
- Wraps with Drizzle ORM using schema from `shared/schema.ts`
- **Exports**: `db` (Drizzle instance), `sqlite` (raw better-sqlite3 connection)

---

## storage.ts - Document Storage Layer

Class `DatabaseStorage` implementing `IStorage` interface.

### Document Operations
| Method | Description |
|--------|-------------|
| `getDocument(id)` | Fetch by ID |
| `getAllDocuments()` | List all documents |
| `createDocument(doc)` | Insert new with filename + fullText |
| `updateDocument(id, updates)` | Update summary, mainArguments, keyConcepts, chunkCount, userIntent |
| `deleteDocument(id)` | Delete by ID |

### Chunk Operations
| Method | Description |
|--------|-------------|
| `getChunksForDocument(documentId)` | All chunks for a document |
| `createChunk(chunk)` | Create with text, startPosition, endPosition |
| `updateChunkEmbedding(chunkId, embedding)` | Store vector embedding |

### Annotation Operations
| Method | Description |
|--------|-------------|
| `getAnnotationsForDocument(documentId)` | All annotations for document |
| `getAnnotation(id)` | Single annotation |
| `createAnnotation(annotation)` | Create full annotation |
| `updateAnnotation(id, note, category)` | Update note + category |
| `deleteAnnotation(id)` | Delete single |
| `deleteAnnotationsForDocument(documentId)` | Bulk delete all for document |

**Exported as**: `storage` singleton

---

## projectStorage.ts - Project Storage Layer

Class `ProjectDatabaseStorage` implementing `IProjectStorage`.

### Project CRUD
- `createProject`, `getProject`, `getAllProjects` (newest first), `updateProject`, `deleteProject`

### Folder CRUD
- `createFolder`, `getFolder`, `getFoldersByProject` (sorted by sortOrder + name), `updateFolder`, `deleteFolder`, `moveFolder`

### Project Document CRUD
- `addDocumentToProject`, `getProjectDocument`, `getProjectDocumentsByProject` (with joined document data), `getProjectDocumentsByFolder`, `updateProjectDocument`, `removeDocumentFromProject`

### Project Annotation CRUD
- `createProjectAnnotation`, `getProjectAnnotation`, `getProjectAnnotationsByDocument` (sorted by position), `updateProjectAnnotation`, `deleteProjectAnnotation`

### Prompt Template CRUD
- `createPromptTemplate`, `getPromptTemplate`, `getPromptTemplatesByProject`, `updatePromptTemplate`, `deletePromptTemplate`

**Exported as**: `projectStorage` singleton

---

## openai.ts - OpenAI Integration

### Configuration
- **Models**: `gpt-4o-mini` (analysis), `text-embedding-3-small` (embeddings)
- Client initialized with `OPENAI_API_KEY` env var (crashes if missing)

### Core Functions

| Function | Purpose |
|----------|---------|
| `getEmbedding(text)` | Generate vector embedding |
| `cosineSimilarity(a, b)` | Compute similarity between vectors |
| `analyzeChunkForIntent(chunk, chunkStart, intent)` | V1 single-chunk analysis |
| `generateDocumentSummary(fullText)` | Generate summary + arguments + concepts |
| `searchDocument(query, intent, chunks)` | LLM-based quote extraction |
| `findHighlightPosition(fullText, text, chunkStart)` | Locate text in document |
| `extractCitationMetadata(text, highlight?)` | AI-extract bibliographic data |

### V1 Pipeline Functions (legacy, superseded by V2)
- `generateCandidates()`, `softVerifyCandidates()`, `verifyCandidates()`
- `refineAnnotations()`, `analyzeChunkWithPipeline()`, `processChunksWithPipeline()`
- `getDocumentContext()`, `clearDocumentContextCache()`

### Pipeline Configuration
```
CANDIDATES_PER_CHUNK: 3    VERIFIER_THRESHOLD: 0.7    LLM_CONCURRENCY: 5
MIN_HIGHLIGHT_LENGTH: 10   MAX_HIGHLIGHT_LENGTH: 500  OVERLAP_THRESHOLD: 0.5
Thoroughness chunks: quick=10, standard=30, thorough=100, exhaustive=999
```

### Helper Functions
- `calculateOverlap(start1, end1, start2, end2)` - Overlap ratio between spans
- `isDuplicateAnnotation(start, end, confidence, existing)` - Check duplicate at 50% overlap
- `hardVerifyCandidate(candidate, chunk)` - Grounding check + offset correction
- `getMaxChunksForLevel(level)` - Map thoroughness to chunk count

---

## pipelineV2.ts - V2 Annotation Pipeline (Primary)

The main annotation system used for all analysis. Improvements over V1: better noise filtering, enhanced prompts, stricter verification.

### Configuration
```
MODEL: "gpt-4o-mini"
CHUNK_SIZE: 1000         CHUNK_OVERLAP: 100
CANDIDATES_PER_CHUNK: 3  VERIFIER_THRESHOLD: 0.7
LLM_CONCURRENCY: 5
MIN_HIGHLIGHT_LENGTH: 15  MAX_HIGHLIGHT_LENGTH: 600
```

### Pre-Processing

**`filterTextNoise(text)`**
- Removes references/bibliography sections
- Strips DOIs, copyright notices, page numbers, journal headers
- Removes footnote clusters
- Returns `{cleanText, removedSections[]}`

**`chunkTextV2(text)`**
- Filters noise first, then chunks at 1000 chars with 100 overlap
- Seeks natural boundaries (paragraphs > sentences > clauses)
- Tracks original positions in full text
- Returns `TextChunkDataV2[]`

### Phase 1: Generator (`generateCandidatesV2`)

- Prompt includes document context (summary, key concepts)
- Explicit instructions to filter noise
- Returns up to 3 candidates per chunk
- Each has: highlightStart/End (relative to chunk), highlightText, category, note, confidence
- Validated against `generatorResponseSchema`

### Phase 2: Verifier

**Hard Verification (`hardVerifyCandidateV2`)**:
- Text must exist verbatim in chunk (grounding check)
- Length: 15-600 chars
- Pattern rejection: references, DOIs, figure captions, metadata
- Auto-corrects offsets if text found at different position

**Soft Verification (`softVerifyCandidatesV2`)**:
- LLM evaluates relevance, content quality, category accuracy, note quality
- Returns verdicts with approval + qualityScore
- Only passes candidates with qualityScore >= 0.7

**Combined (`verifyCandidatesV2`)**:
- Hard verify first, then soft verify survivors
- Deduplicates against existing annotations (50% overlap threshold)

### Phase 3: Refiner (`refineAnnotationsV2`)

- Skips for sets <= 2 (pass-through)
- LLM polishes notes to explain WHY, not just WHAT
- Verifies category accuracy
- Returns `RefinedAnnotation[]`

### Pipeline Execution

**`analyzeChunkWithPipelineV2(chunk, chunkStart, intent, docId, fullText, existing)`**
1. Get/cache document context
2. Generate candidates -> Verify -> Refine
3. Convert to absolute positions
4. Returns `PipelineAnnotation[]`

**`processChunksWithPipelineV2(chunks, intent, docId, fullText, existing)`**
- Batches by LLM_CONCURRENCY (5)
- Parallel within batch, sequential across batches
- Running deduplication list
- Returns all unique annotations

**`processChunksWithMultiplePrompts(chunks, prompts, docId, fullText, existing)`**
- Each prompt runs independently through full pipeline
- All prompts processed in parallel
- Returns `Map<promptIndex, PipelineAnnotation[]>`

---

## chunker.ts - Text Segmentation (V1)

Simple chunking utility (used by V1 pipeline):
- `chunkText(text, chunkSize=500, overlap=50)` - Fixed-size with overlap, sentence boundary seeking
- `findSentenceEnd(text, targetLength)` - Find sentence ending near target
- `extractTextFromTxt(content)` - Normalize whitespace

---

## contextGenerator.ts - AI Context Generation

Uses OpenAI to generate search-optimized context strings.

| Function | Purpose | Output |
|----------|---------|--------|
| `generateRetrievalContext(summary, args, concepts, thesis, role)` | Document retrieval context | 200-300 word string |
| `generateProjectContextSummary(thesis, scope, docContexts[])` | Project context | 150-200 word string |
| `generateFolderContextSummary(desc, docContexts[], parentContext?)` | Folder context | 100-150 word string |
| `generateSearchableContent(highlight, note, category, docContext?)` | Annotation search text | Formatted string |
| `embedText(text)` | Wrapper for getEmbedding() | number[] |

Note: Uses `AI_INTEGRATIONS_OPENAI_API_KEY` / `AI_INTEGRATIONS_OPENAI_BASE_URL` if available (Replit integration), falls back to main OpenAI client.

---

## citationGenerator.ts - Chicago-Style Citations

Formats citations according to Chicago Manual of Style.

| Function | Purpose |
|----------|---------|
| `generateChicagoFootnote(citation, page?, isSubsequent?)` | Full or short footnote |
| `generateFootnoteWithQuote(citation, quote, page?)` | Footnote with embedded quote |
| `generateInlineCitation(citation, page?)` | Parenthetical `(Author, "Title", page)` |
| `generateChicagoBibliography(citation)` | Bibliography entry |

Handles source types: book, journal, chapter, website, newspaper, thesis, other.

---

## projectSearch.ts - Search Implementation

### `globalSearch(projectId, query, filters?, limit=20)`
Text-based search across entire project:
1. Searches project context (thesis, contextSummary)
2. Searches folders (name, description, contextSummary)
3. Searches documents (filename, summary, retrievalContext)
4. Searches annotations (highlightedText, note, searchableContent)
5. Applies filters (category, folder, document)
6. Scores by text match + word overlap (0.6-0.9 base, +0.3 for substring match)
7. Returns ranked results with relevance levels

### `searchProjectDocument(projectDocId, query)`
Semantic search within single document:
1. Generates query embedding
2. Ranks chunks by cosine similarity
3. Uses LLM to extract relevant quotes from top 5 chunks

---

## vite.ts - Dev Server

- Creates Vite dev server in middleware mode
- HMR endpoint at `/vite-hmr`
- Transforms `index.html` through Vite on each request
- Cache-busting via timestamp query param

## static.ts - Production Server

- Serves static files from `dist/public/`
- SPA fallback: all unmatched routes get `index.html`
- Throws if build directory missing

---

## replit_integrations/

### batch/utils.ts
- `batchProcess(items, processor, options)` - Generic batch with rate limiting + retries (p-limit, p-retry)
- `batchProcessWithSSE(items, processor, sendEvent, options)` - Sequential batch with Server-Sent Events
- `isRateLimitError(error)` - Detect rate limit / quota errors
- Default: concurrency=2, retries=7, backoff 2s-128s

### image/client.ts
- `generateImageBuffer(prompt, size?)` - Generate image via `gpt-image-1`
- `editImages(imageFiles[], prompt, outputPath?)` - Combine/edit images

### image/routes.ts
- `POST /api/generate-image` - Generate and return image
