# Server API Reference

Base URL: `http://localhost:5001`

---

## Document Management (routes.ts)

### Upload Document
```
POST /api/upload
Content-Type: multipart/form-data
Body: file (PDF or TXT, max 10MB)

Response 200:
{ id, filename, fullText, chunkCount, summary, mainArguments, keyConcepts }

Errors:
- 400: No file / unsupported type / garbled PDF (scanned/custom fonts)
```

### List Documents
```
GET /api/documents
Response 200: Document[]
```

### Get Document
```
GET /api/documents/:id
Response 200: Document
Error 404: Document not found
```

### Get Document Summary
```
GET /api/documents/:id/summary
Response 200: { summary, mainArguments, keyConcepts }
```

### AI Analysis (Set Intent)
```
POST /api/documents/:id/set-intent
Body: { intent: string, thoroughness: 'quick'|'standard'|'thorough'|'exhaustive' }

Response 200: Annotation[]

Process:
1. Generates embedding for intent
2. Ranks chunks by cosine similarity
3. Filters chunks by thoroughness (10/30/100/999 max)
4. Deletes existing AI annotations
5. Runs V2 pipeline (Generator -> Verifier -> Refiner)
```

### Search Document
```
POST /api/documents/:id/search
Body: { query: string }

Response 200: SearchResult[]
{ quote, startPosition, endPosition, explanation, relevance: 'high'|'medium'|'low' }
```

---

## Annotations (routes.ts)

### Create Annotation
```
POST /api/documents/:id/annotate
Body: { startPosition, endPosition, highlightedText, category, note, isAiGenerated? }
Response 200: Annotation
```

### Update Annotation
```
PUT /api/annotations/:id
Body: { note, category }
Response 200: Annotation
```

### Delete Annotation
```
DELETE /api/annotations/:id
Response 200: { success: true }
```

### List Annotations
```
GET /api/documents/:id/annotations
Response 200: Annotation[]
```

---

## Projects (projectRoutes.ts)

### Create Project
```
POST /api/projects
Body: { name, description?, thesis?, scope? }
Response 201: Project
(Context summary generated in background)
```

### List Projects
```
GET /api/projects
Response 200: Project[] (newest first)
```

### Get Project
```
GET /api/projects/:id
Response 200: Project
```

### Update Project
```
PUT /api/projects/:id
Body: { name?, description?, thesis?, scope? }
Response 200: Project
```

### Delete Project
```
DELETE /api/projects/:id
Response 200: { success: true }
```

---

## Folders (projectRoutes.ts)

### Create Folder
```
POST /api/projects/:projectId/folders
Body: { name, description?, parentFolderId?, sortOrder? }
Response 201: Folder
```

### List Folders
```
GET /api/projects/:projectId/folders
Response 200: Folder[] (sorted by sortOrder, name)
```

### Update Folder
```
PUT /api/folders/:id
Body: { name?, description? }
Response 200: Folder
```

### Delete Folder
```
DELETE /api/folders/:id
Response 200: { success: true }
```

### Move Folder
```
PUT /api/folders/:id/move
Body: { parentFolderId: string|null }
Response 200: Folder
```

---

## Prompt Templates (projectRoutes.ts)

### Create Template
```
POST /api/projects/:projectId/prompt-templates
Body: { name, prompts: [{text, color?}] }
Response 201: PromptTemplate
```

### List Templates
```
GET /api/projects/:projectId/prompt-templates
Response 200: PromptTemplate[]
```

### Update Template
```
PUT /api/prompt-templates/:id
Body: { name?, prompts? }
Response 200: PromptTemplate
```

### Delete Template
```
DELETE /api/prompt-templates/:id
Response 200: { success: true }
```

---

## Project Documents (projectRoutes.ts)

### Add Document to Project
```
POST /api/projects/:projectId/documents
Body: { documentId, folderId? }
Response 201: ProjectDocument
(Retrieval context + citation metadata generated in background)
```

### List Project Documents
```
GET /api/projects/:projectId/documents
Response 200: ProjectDocument[] (with joined document metadata)
```

### Batch Add Documents
```
POST /api/projects/:projectId/documents/batch
Body: { documentIds: string[] (1-50), folderId?: string }
Response 200: { totalRequested, added, alreadyExists, failed, results: [{documentId, filename, status, projectDocumentId?, error?}] }
```

### Get Project Document
```
GET /api/project-documents/:id
Response 200: ProjectDocument
```

### Update Project Document
```
PUT /api/project-documents/:id
Body: { citationData?, roleInProject?, projectContext?, folderId? }
Response 200: ProjectDocument
```

### Move to Folder
```
PUT /api/project-documents/:id/move
Body: { folderId: string|null }
Response 200: ProjectDocument
```

### Update Citation
```
PUT /api/project-documents/:id/citation
Body: { citationData: CitationData }
Response 200: ProjectDocument
```

### Remove from Project
```
DELETE /api/project-documents/:id
Response 200: { success: true }
```

### Save View State
```
PUT /api/project-documents/:id/view-state
Body: { scrollPosition?, lastViewedAt? }
Response 200: ProjectDocument
```

---

## Project Annotations (projectRoutes.ts)

### Create Annotation
```
POST /api/project-documents/:id/annotations
Body: { startPosition, endPosition, highlightedText, category, note?, isAiGenerated?,
        confidenceScore?, promptText?, promptIndex?, promptColor?, analysisRunId? }
Response 201: ProjectAnnotation
(Searchable content generated in background)
```

### List Annotations
```
GET /api/project-documents/:id/annotations
Response 200: ProjectAnnotation[] (sorted by position)
```

### Update Annotation
```
PUT /api/project-annotations/:id
Body: { note?, category? }
Response 200: ProjectAnnotation
```

### Delete Annotation
```
DELETE /api/project-annotations/:id
Response 200: { success: true }
```

---

## AI Analysis - Project (projectRoutes.ts)

### Single-Prompt Analysis
```
POST /api/project-documents/:id/analyze
Body: { intent: string, thoroughness?: 'quick'|'standard'|'thorough'|'exhaustive' }
Response 200: { annotations: ProjectAnnotation[], stats: { chunksAnalyzed, totalChunks, annotationsCreated, coverage } }
```

### Multi-Prompt Analysis
```
POST /api/project-documents/:id/analyze-multi
Body: { prompts: [{text, color?}], thoroughness?: ThoroughnessLevel }
Response 200: {
  analysisRunId, totalAnnotations, annotations: ProjectAnnotation[],
  results: [{ promptIndex, promptText, annotationsCreated }],
  stats: { chunksAnalyzed, totalChunks, coverage }
}
```

### Batch Analysis
```
POST /api/projects/:projectId/batch-analyze
Body: { projectDocumentIds: string[] (1-50), intent, thoroughness?,
        constraints?: { categories?, maxAnnotationsPerDoc? (1-50), minConfidence? (0-1) } }
Response 200: {
  jobId, status: 'completed'|'partial'|'failed',
  totalDocuments, successfulDocuments, failedDocuments,
  totalAnnotationsCreated, totalTimeMs,
  results: [{ projectDocumentId, filename, status, annotationsCreated, error? }]
}
```

---

## Search (projectRoutes.ts)

### Global Project Search
```
POST /api/projects/:projectId/search
Body: { query, filters?: { categories?, folderIds?, documentIds? }, limit? (default 20) }
Response 200: { results: GlobalSearchResult[], totalResults, searchTime }

GlobalSearchResult: { type, documentId?, documentFilename?, folderId?, folderName?,
  annotationId?, matchedText, highlightedText?, note?, category?, citationData?,
  pageNumber?, similarityScore, relevanceLevel, startPosition? }
```

### Document Search (within project)
```
POST /api/project-documents/:id/search
Body: { query }
Response 200: SearchResult[]
```

---

## Citations (projectRoutes.ts)

### Generate Citation
```
POST /api/citations/generate
Body: { citationData: CitationData, pageNumber?, isSubsequent? }
Response 200: { footnote, bibliography }
```

### AI Citation Extraction
```
POST /api/citations/ai
Body: { documentId, highlightedText? }
Response 200: { footnote, bibliography, citationData }
```

### Footnote with Quote
```
POST /api/citations/footnote-with-quote
Body: { citationData, quote, pageNumber? }
Response 200: { footnote, footnoteWithQuote, inlineCitation, bibliography }
```

### Annotation Footnote
```
POST /api/project-annotations/:id/footnote
Body: { pageNumber? }
Response 200: { footnote, bibliography, citationData, footnoteWithQuote?, inlineCitation? }
```

---

## Image Generation (replit_integrations)

### Generate Image
```
POST /api/generate-image
Body: { prompt, size?: '1024x1024'|'512x512'|'256x256' }
Response 200: { url, b64_json }
```
