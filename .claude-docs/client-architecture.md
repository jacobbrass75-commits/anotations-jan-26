# Client Frontend Architecture

All frontend code lives in `/client/src/`.

---

## Entry & Routing

### main.tsx
Entry point. Renders `<App />` into `#root`.

### App.tsx
```
QueryClientProvider
  └── TooltipProvider
      └── Toaster
          └── Router (wouter)
              ├── /                    → Home
              ├── /projects            → Projects
              ├── /projects/:id        → ProjectWorkspace
              ├── /projects/:pid/documents/:did → ProjectDocument
              └── *                    → NotFound
```

---

## Pages

### Home.tsx (`/`)
Single-document annotation interface (standalone mode, no project context).

**Layout**: 4-column grid
- **Col 1**: FileUpload + IntentPanel + DocumentSummary
- **Col 2-3**: DocumentViewer + SearchPanel
- **Col 4**: AnnotationSidebar

**Flow**: Upload document -> Set research intent -> AI analyzes -> View/edit annotations

**State**: selectedAnnotationId, searchResults, manual annotation dialog

### Projects.tsx (`/projects`)
Project listing and creation.

**Features**: Grid of project cards, create dialog (name, description, thesis, scope), delete with confirmation

**Data**: `useProjects()`, `useCreateProject()`, `useDeleteProject()`

### ProjectWorkspace.tsx (`/projects/:id`)
Project hub with folder navigation and global search.

**Layout**: Sidebar + Main area
- **Sidebar**: FolderTree (hierarchical, expand/collapse, create/delete folders)
- **Main**: Global search, document grid, citation cards

**Features**:
- Create/delete folders (nested hierarchy)
- Add/remove documents
- Batch operations (BatchAnalysisModal, BatchUploadModal)
- Global search with citation generation
- Copy footnote/bibliography to clipboard

**Data**: `useProject()`, `useFolders()`, `useProjectDocuments()`, `useGlobalSearch()`, `useGenerateCitation()`

### ProjectDocument.tsx (`/projects/:pid/documents/:did`)
Document viewer within project context. Enhanced version of Home.

**Layout**: 4-column grid
- **Col 1**: MultiPromptPanel + Citation metadata form + Citation summary
- **Col 2-3**: DocumentViewer + SearchPanel
- **Col 4**: AnnotationSidebar (with footnote button)

**Features**:
- Multi-prompt analysis (up to 8 colored prompts)
- Prompt templates (save/load per project)
- Citation metadata editor with AI auto-fill
- Footnote generation for annotations
- Manual annotations via text selection

**Data**: `useProject()`, `useProjectAnnotations()`, `useAnalyzeMultiPrompt()`, `usePromptTemplates()`, `useUpdateProjectDocument()`, `useGenerateCitation()`

### not-found.tsx
Simple 404 with card UI and link to home.

---

## Custom Components

### FileUpload.tsx
- Drag-and-drop file upload
- Accepts .pdf, .txt (validates MIME)
- Progress bar during upload
- Max 10MB
- **Props**: `onUpload(file)`, `isUploading`, `uploadProgress`

### IntentPanel.tsx
- Research intent form with topic + goals textarea
- Thoroughness selector: quick (~10 sections), standard (~30), thorough (~100), exhaustive (full)
- Shows success indicator with annotation count after analysis
- **Props**: `documentId`, `onAnalyze(intent, thoroughness)`, `isAnalyzing`, `hasAnalyzed`, `annotationCount`

### MultiPromptPanel.tsx
- Advanced prompt management for multi-prompt analysis
- Add/remove prompts (up to 8), each gets unique color from 8-color palette
- Save/load prompt templates (project-scoped)
- Live prompt stats from annotations
- Thoroughness selector
- **Props**: `documentId`, `projectId`, `onAnalyze`, `isAnalyzing`, `hasAnalyzed`, `promptStats`, `templates`, `onSaveTemplate`

### DocumentViewer.tsx
- Container for HighlightedText
- Auto-scrolls to selected annotation
- Loading skeleton state
- **Props**: `document`, `annotations`, `isLoading`, `selectedAnnotationId`, `onAnnotationClick`, `onTextSelect`

### HighlightedText.tsx
Core text rendering engine. Complex segment-building algorithm to merge/layer overlapping annotations.

**Features**:
- Click highlight -> popover with annotation details (category badge, note, confidence bar, prompt info)
- Mouse text selection -> trigger manual annotation dialog
- Category colors: yellow (key_quote), green (evidence), blue (argument), purple (methodology), orange (user_added)
- Prompt colors override category colors when present
- Confidence score visualization bar

**Props**: `text`, `annotations`, `onAnnotationClick`, `selectedAnnotationId`, `onTextSelect`

### AnnotationSidebar.tsx
- Annotation list with filtering and management
- **Filters**: By type (AI/manual), by category, by prompt
- **Per-annotation actions**: Select (highlights in doc), edit note/category (dialog), delete (confirmation), copy footnote (if project doc)
- Count badges per filter
- **Props**: `annotations`, `isLoading`, `selectedAnnotationId`, `onSelect`, `onDelete`, `onUpdate`, `onAddManual`, `showFootnoteButton`

### SearchPanel.tsx
- Collapsible search within document
- Query suggestions
- Results (max 5, expandable) with relevance badge, quote, explanation
- Click result -> jump to position in document
- **Props**: `documentId`, `onSearch`, `onJumpToPosition`

### DocumentSummary.tsx
- Shows AI-generated summary, main arguments (bullets), key concepts (badges)
- Conditional render (only if summary exists)
- **Props**: `document`, `isLoading`

### ManualAnnotationDialog.tsx
- Modal for creating manual annotations
- Shows selected text, category selector (5 categories), note textarea
- **Props**: `open`, `onOpenChange`, `selectedText`, `onSave(note, category)`

### BatchAnalysisModal.tsx
- Batch analyze multiple documents dialog
- Document selection (checkbox grid, select all/none)
- Intent input (auto-populated from project thesis)
- Advanced options: category filter, max annotations/doc (1-50), min confidence (0.5-1.0)
- Results display with per-doc status and totals
- **Props**: `open`, `onOpenChange`, `projectId`, `documents`, `projectThesis`

### BatchUploadModal.tsx
- Batch upload and add documents dialog
- Two tabs: Library (select existing docs) and Upload (drag-drop new files)
- Target folder selector
- Multi-file upload with individual status tracking
- **Props**: `open`, `onOpenChange`, `projectId`, `availableDocuments`, `folders`, `currentFolderId`

### ThemeToggle.tsx
- Light/dark mode switcher
- Stores preference in localStorage
- Toggles `dark` class on `<html>` element
- Checks system preference on initial load

---

## Hooks

### useDocument.ts
Single-document operations.

| Hook | Type | Key |
|------|------|-----|
| `useDocuments()` | query | `/api/documents` |
| `useDocument(id)` | query | `/api/documents/${id}` |
| `useAnnotations(docId)` | query | `/api/documents/${docId}/annotations` |
| `useUploadDocument()` | mutation | POST `/api/upload` |
| `useSetIntent()` | mutation | POST `/api/documents/${id}/set-intent` |
| `useAddAnnotation()` | mutation | POST `/api/documents/${id}/annotate` |
| `useUpdateAnnotation()` | mutation | PUT `/api/annotations/${id}` |
| `useDeleteAnnotation()` | mutation | DELETE `/api/annotations/${id}` |
| `useSearchDocument()` | mutation | POST `/api/documents/${id}/search` |

### useProjects.ts
Project and document management.

| Hook | Type | Key |
|------|------|-----|
| `useProjects()` | query | `/api/projects` |
| `useProject(id)` | query | `/api/projects/${id}` |
| `useCreateProject()` | mutation | POST `/api/projects` |
| `useUpdateProject()` | mutation | PUT `/api/projects/${id}` |
| `useDeleteProject()` | mutation | DELETE `/api/projects/${id}` |
| `useFolders(projectId)` | query | `/api/projects/${id}/folders` |
| `useCreateFolder()` | mutation | POST `/api/projects/${id}/folders` |
| `useDeleteFolder()` | mutation | DELETE `/api/folders/${id}` |
| `useProjectDocuments(projectId)` | query | `/api/projects/${id}/documents` |
| `useAddDocumentToProject()` | mutation | POST `/api/projects/${id}/documents` |
| `useRemoveDocumentFromProject()` | mutation | DELETE `/api/project-documents/${id}` |
| `useUpdateProjectDocument()` | mutation | PUT `/api/project-documents/${id}` |
| `useProjectAnnotations(docId)` | query | `/api/project-documents/${id}/annotations` |
| `useCreateProjectAnnotation()` | mutation | POST `/api/project-documents/${id}/annotations` |
| `useDeleteProjectAnnotation()` | mutation | DELETE `/api/project-annotations/${id}` |
| `useAnalyzeProjectDocument()` | mutation | POST `/api/project-documents/${id}/analyze` |
| `useSearchProjectDocument()` | mutation | POST `/api/project-documents/${id}/search` |
| `useBatchAnalyze()` | mutation | POST `/api/projects/${id}/batch-analyze` |
| `useBatchAddDocuments()` | mutation | POST `/api/projects/${id}/documents/batch` |
| `useAnalyzeMultiPrompt()` | mutation | POST `/api/project-documents/${id}/analyze-multi` |
| `usePromptTemplates(projectId)` | query | `/api/projects/${id}/prompt-templates` |
| `useCreatePromptTemplate()` | mutation | POST `/api/projects/${id}/prompt-templates` |
| `useDeletePromptTemplate()` | mutation | DELETE `/api/prompt-templates/${id}` |

### useProjectSearch.ts
| Hook | Type | Key |
|------|------|-----|
| `useGlobalSearch()` | mutation | POST `/api/projects/${id}/search` |
| `useGenerateCitation()` | mutation | POST `/api/citations/generate` |

### use-toast.ts
Toast notification system.
- `useToast()` hook returns `{toasts, toast(), dismiss()}`
- Standalone `toast()` function for use outside components
- FIFO queue, TOAST_LIMIT=1
- Supports title, description, variant (destructive, default)

### use-mobile.tsx
- `useIsMobile()` - Returns `true` if viewport < 768px
- Reactive via matchMedia listener

---

## Lib Utilities

### queryClient.ts
- `apiRequest(method, url, data?)` - Fetch wrapper with JSON Content-Type, credentials, error handling
- `getQueryFn(options)` - Default query function factory for useQuery; handles 401 with configurable behavior
- QueryClient config: `refetchOnWindowFocus: false`, `staleTime: Infinity`, `retry: false`

### utils.ts
- `cn(...inputs)` - Combines clsx + tailwind-merge for conditional class names

---

## Styling

### index.css
- CSS variables for light/dark themes
- Colors: primary, secondary, muted, destructive, accent, card, popover, sidebar
- Fonts: Inter (sans), Merriweather (serif), JetBrains Mono (mono)
- Elevation utilities: `hover-elevate`, `active-elevate`, `toggle-elevate`
- Border radius: 0.5rem

### shadcn/ui Components (~50+)
Full suite of Radix-based components in `components/ui/`:
Button, Input, Textarea, Label, Card, Dialog, AlertDialog, Tabs, Select, Badge, Alert, ScrollArea, Separator, Checkbox, Dropdown Menu, Tooltip, Popover, Progress, Slider, Skeleton, Collapsible, Accordion, Sheet, Drawer, etc.

---

## Component Hierarchy & Data Flow

```
Home
├── FileUpload ──[useUploadDocument]──> POST /api/upload
├── IntentPanel ──[useSetIntent]──> POST /api/documents/:id/set-intent
├── DocumentViewer
│   └── HighlightedText ──[onTextSelect]──> ManualAnnotationDialog
├── SearchPanel ──[useSearchDocument]──> POST /api/documents/:id/search
├── AnnotationSidebar ──[useUpdateAnnotation / useDeleteAnnotation]
└── ManualAnnotationDialog ──[useAddAnnotation]──> POST /api/documents/:id/annotate

ProjectWorkspace
├── FolderTree ──[useCreateFolder / useDeleteFolder]
├── Global Search ──[useGlobalSearch]──> POST /api/projects/:id/search
├── SearchResultCard ──[useGenerateCitation]──> POST /api/citations/generate
├── BatchAnalysisModal ──[useBatchAnalyze]──> POST /api/projects/:id/batch-analyze
└── BatchUploadModal ──[useBatchAddDocuments / useUploadDocument]

ProjectDocument
├── MultiPromptPanel ──[useAnalyzeMultiPrompt]──> POST /api/project-documents/:id/analyze-multi
│   └── [useCreatePromptTemplate]──> POST /api/projects/:id/prompt-templates
├── Citation Editor ──[useUpdateProjectDocument]──> PUT /api/project-documents/:id
├── DocumentViewer + HighlightedText
├── SearchPanel ──[useSearchProjectDocument]
├── AnnotationSidebar (with footnote) ──[useDeleteProjectAnnotation]
└── ManualAnnotationDialog ──[useCreateProjectAnnotation]
```

### State Management Patterns
- **Server state**: React Query (queries + mutations) with cache invalidation on success
- **UI state**: Component-local `useState` for modals, filters, selections, forms
- **Notifications**: Custom `useToast` hook (memory-based reducer)
- **Theme**: localStorage for dark/light preference
- **Query keys**: Path-like arrays matching API URLs (e.g., `["/api/documents", id, "annotations"]`)
