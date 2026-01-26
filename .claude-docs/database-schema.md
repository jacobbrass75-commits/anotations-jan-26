# Database Schema Reference

**ORM**: Drizzle ORM
**Database**: SQLite at `./data/sourceannotator.db`
**Schema file**: `shared/schema.ts`
**Config**: `drizzle.config.ts`

## Annotation Categories (Enum)

```typescript
["key_quote", "argument", "evidence", "methodology", "user_added"]
```

Type: `AnnotationCategory`

---

## Table: `documents`

Uploaded documents with full text and AI-generated metadata.

| Column | Type | Required | Default | Notes |
|--------|------|----------|---------|-------|
| id | text (PK) | yes | UUID auto-gen | |
| filename | text | yes | | Document filename |
| fullText | text | yes | | Complete extracted text |
| uploadDate | integer | yes | current timestamp | |
| userIntent | text | no | | User's research intent |
| summary | text | no | | AI-generated summary |
| mainArguments | JSON (string[]) | no | | Extracted arguments |
| keyConcepts | JSON (string[]) | no | | Identified concepts |
| chunkCount | integer | yes | 0 | Number of text chunks |

**Relations**: One-to-many with `textChunks`, `annotations`
**Insert type**: `InsertDocument` (omits id, uploadDate, chunkCount)

---

## Table: `textChunks`

Document segments for AI processing with optional embeddings.

| Column | Type | Required | Default | Notes |
|--------|------|----------|---------|-------|
| id | text (PK) | yes | UUID auto-gen | |
| documentId | text (FK) | yes | | -> documents.id (cascade delete) |
| text | text | yes | | Chunk content |
| startPosition | integer | yes | | Offset in full document |
| endPosition | integer | yes | | End offset in document |
| sectionTitle | text | no | | Section heading if found |
| embedding | JSON (number[]) | no | | Vector embedding |

**Relations**: Many-to-one with `documents`
**Insert type**: `InsertTextChunk` (omits id)

---

## Table: `annotations`

Document-level annotations (standalone mode, not project-scoped).

| Column | Type | Required | Default | Notes |
|--------|------|----------|---------|-------|
| id | text (PK) | yes | UUID auto-gen | |
| documentId | text (FK) | yes | | -> documents.id (cascade delete) |
| chunkId | text | no | | Associated chunk |
| startPosition | integer | yes | | Start in document |
| endPosition | integer | yes | | End in document |
| highlightedText | text | yes | | The selected text |
| category | text | yes | | AnnotationCategory |
| note | text | yes | | Annotation note |
| isAiGenerated | boolean | yes | false | AI or manual |
| confidenceScore | real | no | | 0-1 from AI |
| promptText | text | no | | Associated prompt |
| promptIndex | integer | no | | Index in multi-prompt |
| promptColor | text | no | | Visual color |
| analysisRunId | text | no | | Analysis batch ID |
| createdAt | integer | yes | current timestamp | |

**Relations**: Many-to-one with `documents`
**Insert type**: `InsertAnnotation` (omits id, createdAt)

---

## Table: `projects`

Top-level research project container.

| Column | Type | Required | Default | Notes |
|--------|------|----------|---------|-------|
| id | text (PK) | yes | UUID auto-gen | |
| name | text | yes | | Project name |
| description | text | no | | |
| thesis | text | no | | Thesis statement |
| scope | text | no | | Project scope |
| contextSummary | text | no | | AI-generated context |
| contextEmbedding | JSON (number[]) | no | | Vector embedding |
| createdAt | integer | yes | current timestamp | |
| updatedAt | integer | yes | current timestamp | |

**Relations**: One-to-many with `folders`, `projectDocuments`, `promptTemplates`
**Insert type**: `InsertProject` (omits id, createdAt, updatedAt, contextSummary, contextEmbedding)

---

## Table: `folders`

Hierarchical folder structure within projects.

| Column | Type | Required | Default | Notes |
|--------|------|----------|---------|-------|
| id | text (PK) | yes | UUID auto-gen | |
| projectId | text (FK) | yes | | -> projects.id (cascade delete) |
| parentFolderId | text (FK) | no | | -> folders.id (self-ref) |
| name | text | yes | | Folder name |
| description | text | no | | |
| contextSummary | text | no | | AI-generated context |
| contextEmbedding | JSON (number[]) | no | | Vector embedding |
| sortOrder | integer | yes | 0 | Display ordering |
| createdAt | integer | yes | current timestamp | |

**Relations**: Many-to-one with `projects`, self-referential parent/child, one-to-many with `projectDocuments`
**Insert type**: `InsertFolder` (omits id, createdAt, contextSummary, contextEmbedding)

---

## Table: `projectDocuments`

Links documents to projects with project-specific metadata and citations.

| Column | Type | Required | Default | Notes |
|--------|------|----------|---------|-------|
| id | text (PK) | yes | UUID auto-gen | |
| projectId | text (FK) | yes | | -> projects.id (cascade delete) |
| documentId | text (FK) | yes | | -> documents.id (cascade delete) |
| folderId | text (FK) | no | | -> folders.id (set null on delete) |
| projectContext | text | no | | Context specific to this project |
| roleInProject | text | no | | Document's role/purpose |
| retrievalContext | text | no | | Search-optimized context |
| retrievalEmbedding | JSON (number[]) | no | | Retrieval vector |
| citationData | JSON | no | | Chicago-style citation data |
| lastViewedAt | integer | no | | Last view timestamp |
| scrollPosition | integer | no | | Saved scroll position |
| addedAt | integer | yes | current timestamp | |

**Relations**: Many-to-one with `projects`, `documents`, `folders`; one-to-many with `projectAnnotations`
**Insert type**: `InsertProjectDocument` (omits id, addedAt, retrievalContext, retrievalEmbedding)

---

## Table: `projectAnnotations`

Project-scoped annotations with search support.

| Column | Type | Required | Default | Notes |
|--------|------|----------|---------|-------|
| id | text (PK) | yes | UUID auto-gen | |
| projectDocumentId | text (FK) | yes | | -> projectDocuments.id (cascade delete) |
| startPosition | integer | yes | | Start in document |
| endPosition | integer | yes | | End in document |
| highlightedText | text | yes | | Selected text |
| category | text | yes | | AnnotationCategory |
| note | text | no | | Annotation note |
| isAiGenerated | boolean | yes | true | |
| confidenceScore | real | no | | 0-1 confidence |
| promptText | text | no | | Associated prompt |
| promptIndex | integer | no | | Prompt index |
| promptColor | text | no | | Visual color |
| analysisRunId | text | no | | Analysis batch ID |
| searchableContent | text | no | | Formatted for search |
| searchEmbedding | JSON (number[]) | no | | Search vector |
| createdAt | integer | yes | current timestamp | |

**Relations**: Many-to-one with `projectDocuments`
**Insert type**: `InsertProjectAnnotation` (omits id, createdAt, searchableContent, searchEmbedding)

---

## Table: `promptTemplates`

Saved prompt sets for reuse within projects.

| Column | Type | Required | Default | Notes |
|--------|------|----------|---------|-------|
| id | text (PK) | yes | UUID auto-gen | |
| projectId | text (FK) | yes | | -> projects.id (cascade delete) |
| name | text | yes | | Template name |
| prompts | JSON | yes | | Array of `{text: string, color: string}` |
| createdAt | integer | yes | current timestamp | |

**Relations**: Many-to-one with `projects`
**Insert type**: `InsertPromptTemplate` (omits id, createdAt)

---

## Table: `users`

Legacy user management (not actively used in current UI).

| Column | Type | Required | Default | Notes |
|--------|------|----------|---------|-------|
| id | text (PK) | yes | UUID auto-gen | |
| username | text | yes | | Unique |
| password | text | yes | | |

**Insert type**: `InsertUser` (picks username, password only)

---

## Entity Relationship Diagram

```
projects ─────────┬──── folders (hierarchical, self-referential)
                   │         │
                   │         └──── projectDocuments
                   │                    │
                   ├──── projectDocuments ──── projectAnnotations
                   │         │
                   │         └──── documents
                   │
                   └──── promptTemplates

documents ────┬──── textChunks
              └──── annotations (standalone mode)
```

---

## Zod Pipeline Schemas

These schemas validate AI pipeline data flowing between phases.

### CandidateAnnotation (Generator output)
```typescript
{ highlightStart: int>=0, highlightEnd: int>=1, highlightText: string(min 1),
  category: AnnotationCategory, note: string(min 1), confidence: 0.0-1.0 }
```

### GeneratorResponse
```typescript
{ candidates: CandidateAnnotation[] (max 5) }
```

### VerifierVerdict
```typescript
{ candidateIndex: int>=0, approved: boolean, qualityScore: 0.0-1.0,
  adjustedCategory?: AnnotationCategory, adjustedNote?: string, issues?: string[] }
```

### VerifierResponse
```typescript
{ verdicts: VerifierVerdict[] }
```

### RefinedAnnotation (Refiner output)
```typescript
{ highlightStart: number, highlightEnd: number, highlightText: string,
  category: AnnotationCategory, note: string, confidence: 0.0-1.0 }
```

### RefinerResponse
```typescript
{ refined: RefinedAnnotation[] }
```

### PipelineAnnotation (Final output with absolute positions)
```typescript
{ absoluteStart: number, absoluteEnd: number, highlightText: string,
  category: AnnotationCategory, note: string, confidence: 0.0-1.0 }
```

### DocumentContext
```typescript
{ summary: string, keyConcepts: string[] }
```

### CitationData
```typescript
{ sourceType: 'book'|'journal'|'website'|'newspaper'|'chapter'|'thesis'|'other',
  authors: [{firstName, lastName, suffix?}], title: string, subtitle?: string,
  containerTitle?: string, publisher?: string, publicationPlace?: string,
  publicationDate?: string, volume?: string, issue?: string,
  pageStart?: string, pageEnd?: string, url?: string, accessDate?: string,
  doi?: string, edition?: string, editors?: [{firstName, lastName}] }
```

### Batch Schemas
- `batchAnalysisRequestSchema` - Up to 50 document IDs with intent, thoroughness, constraints
- `batchAnalysisResponseSchema` - Results with per-doc status, totals, timing
- `batchAddDocumentsRequestSchema` - Up to 50 document IDs with optional folder
- `globalSearchResultSchema` - Search results with type, scores, citation data
