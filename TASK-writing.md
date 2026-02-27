# TASK: Writing Pipeline (feature/writing)

**Workstream:** AI Writing Engine (Planner -> Writer -> Stitcher)
**Branch:** `feature/writing`
**Worktree:** `sm-writing/`
**Dependencies:** Auth (mock userId), Citations (can use Chicago for now, MLA/APA merged later)

---

## Objective

Build the long-format AI writing pipeline that takes a topic + selected annotations/sources and produces a full academic paper streamed section-by-section. Uses Anthropic Claude via a 3-step pipeline: Planner, Writer (per section), Stitcher.

---

## Files to Create/Modify

### 1. `server/writingPipeline.ts` (NEW)

The core writing engine. Three phases streamed via SSE.

```typescript
interface WritingRequest {
  topic: string;
  annotationIds: string[];        // selected annotations to use as sources
  projectId?: string;             // optional project context
  citationStyle: "mla" | "apa" | "chicago";
  tone: "academic" | "casual" | "ap_style";
  targetLength: "short" | "medium" | "long"; // ~3 pages, ~5 pages, ~8 pages
  noEnDashes: boolean;            // prompt injection toggle
  deepWrite: boolean;             // extended thinking (Max only)
}

interface WritingPlan {
  thesis: string;
  sections: Array<{
    title: string;
    description: string;
    annotationIds: string[];       // which annotations map to this section
    targetWords: number;
  }>;
  bibliography: string[];
}
```

**Phase 1: PLANNER** (1 API call)

System prompt:
```
You are an academic writing planner. Given a topic, tone, and a set of source annotations,
create a detailed outline for a paper.

Output a JSON object with:
- thesis: The main argument/thesis statement
- sections: Array of sections, each with title, description, which source annotations to use,
  and target word count
- The total word count across sections should match the target length

Target lengths:
- short: ~1500 words (3 pages)
- medium: ~2500 words (5 pages)
- long: ~4000 words (8 pages)
```

Input: topic + annotation texts + tone + length target
Output: `WritingPlan` JSON

**Phase 2: WRITER** (1 API call per section)

For each section in the plan, make a separate Claude call:

System prompt:
```
You are an academic writer. Write the following section of a paper.

Full outline (for context on the paper's arc):
{plan}

Your assignment: Write section "{section.title}"
Description: {section.description}
Target length: {section.targetWords} words
Tone: {tone}
Citation style: {citationStyle}

Source material (annotations from the student's research):
{relevant annotations with citation data}

Requirements:
- Write ONLY this section, not the whole paper
- Include in-text citations in the specified format
- Use the provided source annotations as evidence
- Match the specified tone
{noEnDashes ? "- NEVER use em-dashes (—) or en-dashes (–). Use commas, periods, or semicolons instead." : ""}

Output the section text in markdown format.
```

If `deepWrite` is true, add extended thinking:
```typescript
{
  thinking: { type: "enabled", budget_tokens: 4096 }
}
```

**Phase 3: STITCHER** (1 API call)

System prompt:
```
You are an academic editor. You've been given all sections of a paper written by different writers.
Your job is to:
1. Add smooth transitions between sections
2. Ensure consistent voice and tone throughout
3. Write a compelling introduction (if not already present)
4. Write a conclusion that ties the argument together
5. Append a complete bibliography/works cited section in {citationStyle} format
6. Do NOT rewrite the sections - only add transitions, intro, conclusion, and bibliography

Output the complete paper in markdown format.
```

### 2. `server/writingRoutes.ts` (NEW)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/write` | Start writing pipeline, stream results via SSE |
| GET | `/api/write/history` | List previous writing sessions (future) |

**The streaming endpoint (`POST /api/write`):**

1. Validate `WritingRequest` body
2. Fetch annotations by IDs from DB (with citation data)
3. Set up SSE response headers
4. Stream progress events:
   ```
   data: {"type":"status","phase":"planning","message":"Creating outline..."}
   data: {"type":"plan","plan":{...}}
   data: {"type":"status","phase":"writing","message":"Writing section 1 of 5..."}
   data: {"type":"section","index":0,"title":"Introduction","content":"..."}
   data: {"type":"section","index":1,"title":"Literature Review","content":"..."}
   ...
   data: {"type":"status","phase":"stitching","message":"Polishing and adding transitions..."}
   data: {"type":"complete","fullText":"...complete paper...","usage":{...}}
   ```
5. Each phase streams its output as it completes

### 3. Register routes in `server/routes.ts`

```typescript
import { registerWritingRoutes } from "./writingRoutes";
registerWritingRoutes(app);
```

### 4. Frontend: `client/src/components/WritingPane.tsx` (NEW)

A side panel/pane for the writing interface. Can be opened from the project workspace or as a standalone page.

```
┌─────────────────────────────────────────────┐
│  WRITING CONTROLS                            │
│  ┌────────────────────────────────────────┐  │
│  │ Topic/Prompt: [textarea]              │  │
│  │ Tone: [academic ▾]                    │  │
│  │ Length: [medium ▾]                    │  │
│  │ Citation Style: [MLA ▾]              │  │
│  │ Sources: [Select annotations...]      │  │
│  │ ☐ No en-dashes   ☐ Deep Write (Max)  │  │
│  │ [Generate Paper]                      │  │
│  └────────────────────────────────────────┘  │
├─────────────────────────────────────────────┤
│  WRITING OUTPUT                              │
│  ┌────────────────────────────────────────┐  │
│  │ Status: Writing section 3 of 5...     │  │
│  │                                        │  │
│  │ ## Introduction                        │  │
│  │ Lorem ipsum dolor sit amet...          │  │
│  │                                        │  │
│  │ ## Literature Review                   │  │
│  │ According to Smith (2024)...           │  │
│  │                                        │  │
│  │ ## Section 3 ← currently streaming     │  │
│  │ The evidence suggests█                 │  │
│  │                                        │  │
│  └────────────────────────────────────────┘  │
│  [Copy] [Export DOCX] [Export PDF]           │
└─────────────────────────────────────────────┘
```

**Implementation:**
- Use `react-markdown` for rendering (install: `npm install react-markdown`)
- Progress indicator showing current phase and section
- Real-time streaming display with blinking cursor
- Source selector: dropdown/checklist of annotations from current project
- Controls disabled while generating
- Copy to clipboard button
- Export DOCX button (use simple HTML-to-DOCX, install: `npm install html-to-docx` or build a simple markdown-to-docx converter)

### 5. `client/src/hooks/useWriting.ts` (NEW)

```typescript
function useWritingPipeline() {
  const [status, setStatus] = useState<string>("");
  const [phase, setPhase] = useState<string>("");
  const [plan, setPlan] = useState<WritingPlan | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [fullText, setFullText] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);

  const generate = async (request: WritingRequest) => {
    setIsGenerating(true);
    // Fetch with SSE, parse events, update state progressively
    // On "plan" event: setPlan
    // On "section" event: append to sections
    // On "complete" event: setFullText, setIsGenerating(false)
  };

  return { generate, status, phase, plan, sections, fullText, isGenerating };
}
```

### 6. Modify `client/src/App.tsx`

Add route: `<Route path="/write" component={WritingPage} />`

### 7. `client/src/pages/WritingPage.tsx` (NEW)

Simple wrapper that renders WritingPane as a full page. Also accessible as a panel within ProjectWorkspace (add a "Write" tab).

---

## Install Dependencies

```bash
npm install @anthropic-ai/sdk react-markdown
```

If export DOCX is needed:
```bash
npm install html-to-docx
```

---

## Environment Variables

Add to `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
```

---

## After Implementation

```bash
npm run db:push   # No new tables needed unless you add writing_sessions
npm run check
npm run dev
```

Test:
1. Navigate to `/write` or open writing pane in a project
2. Enter a topic, select some annotations
3. Click Generate — verify plan streams first
4. Verify sections stream one by one
5. Verify final stitched output appears
6. Test Copy and Export buttons

---

## Important Notes

- The pipeline makes ~7 API calls for a 5-section paper (1 plan + 5 sections + 1 stitch). Keep this efficient.
- Stream each phase's output as it completes — don't wait for everything.
- The `noEnDashes` toggle simply injects a line into the system prompt. Simple prompt injection.
- `deepWrite` adds `thinking: { type: "enabled", budget_tokens: 4096 }` to each Writer call. Only available on Sonnet 4.6.
- Citation data comes from the `projectDocuments.citationData` field on annotations. Pass the full annotation text + citation metadata to the Writer.
- For now, use Chicago citations (the only format currently implemented). MLA/APA come from the citations workstream and will be merged later.
- Use `claude-haiku-4-5-20251001` as default model. Sonnet for Deep Write.
