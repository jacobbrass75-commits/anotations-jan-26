# ScholarMark — Annotation & Writing System Audit

Audited 2026-06-09 at commit `d06e2ed` (post-Codex remediation). Scope: the annotation pipeline, the chat writing system, the one-shot writing pipeline, and the context-management stack. Question under review: should auto-annotation become the context backbone, where does too much context hurt, and how do we make the app smarter for academic writing?

---

## 1. How the annotation system actually works

**Ingest:** upload → noise filter strips references/bibliography/metadata (`pipelineV2.ts:248-305`) → 1,000-char chunks with 100 overlap, sentence-boundary aware (`chunkTextV2`) → per-chunk OpenAI embeddings stored as JSON.

**Analysis** (`projects/analysisHandlers.ts:39-214`):
1. Intent = user prompt (+ project thesis prepended when present, line 61-63).
2. Chunks ranked by **embedding cosine similarity to the intent**; top N selected by thoroughness (quick=10, standard=30, thorough=100, exhaustive=all; min similarity 0.3, or 0.1 for exhaustive). This is genuinely good — analysis effort goes where the relevance is.
3. Per chunk, a three-stage pipeline (`pipelineV2.ts`), default model `gpt-4.1-nano`:
   - **Generator** — up to 3 candidate highlights with category/note/confidence, with explicit noise-filtering instructions.
   - **Hard verifier** — deterministic: exact-substring grounding in the chunk, offset realignment, length bounds, noise regexes (`hardVerifyCandidateV2`). The reason quoted annotations are trustworthy downstream.
   - **Soft verifier** — LLM judge, approve ≥ 0.7 quality, can fix category/note.
   - **Refiner** — polish pass for sets > 2.
4. Dedup against *user* annotations by span overlap; prior AI annotations are **replaced** on re-run (line 181-187) — no stacking.

**Auto-annotation already exists:** `POST /api/project-documents/:id/auto-analyze` (line 310-384) has Haiku generate **six project-aware prompts** from thesis/scope/description + a document sample, then runs the pipeline in quick mode capped at 18 annotations. Plus a multi-prompt parallel mode (max tier) with per-prompt colors.

### The one significant quality flaw: the pipeline refuses to say "nothing here"

- If the generator returns a valid empty list (`{"candidates": []}` — which the prompt explicitly invites), the code treats it as a failure and substitutes **keyword-scored heuristic candidates** (`pipelineV2.ts:469-471` → `buildHeuristicCandidates`, which always returns ≥1 sentence with confidence ~0.62–0.88).
- If the soft verifier then errors or returns no content, all candidates are **default-approved at qualityScore ≥ 0.72** (`pipelineV2.ts:629-636, 652-659`) — above the 0.7 threshold.

Stacked, these two fallbacks mean an irrelevant chunk + one API hiccup = fabricated-relevance annotations entering the corpus. Tolerable when a human reviews every highlight; **toxic if auto-annotations become writing context**, because every weak annotation is then injected into every future writing turn (see §3).

---

## 2. How the writing system actually works

**Chat writing** (`chat/handlers.ts`, `chat/promptBuilder.ts`):

- System prompt = project context + **the full annotation dump for every selected source** + style/voice blocks + flow & quoting rules. `formatSourceForPromptTiered` (`writingPipeline.ts:266-335`) loops over `source.annotations` **with no cap** — every annotation's full text, note, position, confidence.
- **Precision mode** (default; Opus 4.6): Haiku compacts history after 6 turns → Haiku gatherer (`gatherer.ts`) does up to 3 tool iterations over source stubs to build an *evidence brief* → Opus writes with no tools from compacted history + clipboard + brief. Post-turn, Haiku extracts what was actually cited into the persistent **evidence clipboard** (Jaccard-deduped, `evidenceClipboard.ts`).
- **Extended mode** (Sonnet 4.6): single phase, full context, mid-stream `<chunk_request>`/`<context_request>` escalation tags, max 2 rounds, tool responses capped by source count (5,000 → 800 chars as sources grow).
- Compile/verify passes assemble and check the final paper; quote-jump links fingerprint quotes back to source annotations.

This is a thoughtful design — roles (`evidence`/`style_reference`/`background`), clipboard, compaction, and escalation are exactly the right primitives. But:

### The headline finding: the architecture contradicts itself

The precision-mode design says: *give the writer stubs, let the gatherer fetch only what this turn needs* (that's the documented "~91% token reduction"). The implementation says: `buildWritingSystemPrompt(sources, …)` is called with full tiered sources in **both modes** (`chat/handlers.ts:582`), so the system prompt already contains **every annotation in full**. The gatherer then re-retrieves findings *from that same annotation array* (`toolRequests.ts:128-150`), and the clipboard re-accumulates the same quotes again.

Net effect in precision mode, the same evidence can sit in the prompt **three times** (annotation dump + clipboard + evidence brief), and you pay Haiku gathering on top of the full dump it was meant to replace. The compaction stack diligently shrinks *conversation history* while the *source block* — the actual whale — is unbounded.

Scale check: an annotation formats to roughly 175–225 tokens. Auto-analyze emits up to 18/doc; a 10-source project ≈ **~35–40K tokens of system prompt per turn**, resent every turn, **with no Anthropic prompt caching** (`anthropic.messages.stream` is called with no `cache_control` breakpoints — `chat/handlers.ts:768-773`). Multi-prompt analysis on max tier can push well past that. The context-warning system then trips (`caution` < 20K available) and **disables deep dives** — too much static context switching off the dynamic context features is the system eating its own tail.

One more retrieval gap: the gatherer's `get_source_chunks` ranks annotations by **keyword inclusion** (`toolRequests.ts:57-73`), not embeddings — even though chunk embeddings already exist and annotation `searchableContent` is already generated. When no terms match, it returns the first N annotations in storage order anyway.

---

## 3. How too much context hurts — the concrete mechanisms

1. **Money.** ~35K+ system tokens × every turn × Opus pricing, uncached. This is the single largest cost lever in the app.
2. **Attention dilution.** With 100+ annotations in the prompt, the writer over-uses whatever is easiest to see (typically early/late sources — "lost in the middle") instead of the *best* evidence. Selection quality degrades exactly when the user has done the most research — the product gets worse as it gets used more.
3. **Instruction decay.** The carefully-written rules (quote fidelity, citation format, voice profile) sit in the same prompt as the dump; compliance with them measurably drops as prompt length grows. Quote fidelity is the one thing an academic tool cannot fumble.
4. **Quality poisoning.** The heuristic/default-approve fallbacks (§1) mean weak annotations exist; the dump-all prompt guarantees they all reach the writer forever. Auto-annotating more aggressively *amplifies* this.
5. **Feature self-defeat.** Context pressure → `deepDiveAllowed = false` → escalation/deep-research disabled precisely on the large projects that need them most (`chat/handlers.ts:750-752`).
6. **Staleness.** Annotations are generated relative to the *current* thesis (`analysisHandlers.ts:61-63`). When the thesis evolves mid-project, the entire annotation corpus silently represents the old framing, and the dump injects that stale framing into every turn.

---

## 4. Should auto-annotation become the context backbone?

**Yes — it's the right direction, and you've already built 80% of it. But invert the consumption model first.**

Annotations are the correct unit of academic context: they're pre-verified (exact-substring grounded), categorized, positioned (→ citable with page/char precision), and human-curatable. That's strictly better raw material than RAG chunks. The mistake would be keeping "annotation = thing we dump into the prompt." The target architecture:

> **Annotations are the index. The prompt gets stubs. Retrieval delivers the payload.**

Concretely:
- **Small projects (annotation block ≤ ~8K tokens): keep the dump.** It's simple and quality is maximal. Don't add machinery where none is needed.
- **Large projects: stub-only system prompt** (title/role/summary/counts — `formatSourceStubByRole` already exists) + gatherer/escalation retrieval + clipboard as working memory. Everything needed for this already exists in the codebase; the change is mostly *removing* the unconditional annotation loop in `formatSourceForPromptTiered` behind an adaptive budget.
- **Auto-annotate at ingest** (queue it like OCR jobs rather than an on-demand endpoint), but with the quality gates from §5 so the index stays clean, and tagged `isAiGenerated` so users can prune.
- **Re-index on thesis change**: store the thesis (or a hash) on AI annotations; when the project thesis changes, re-rank existing annotations against the new thesis by embeddings (cheap) and offer a one-click re-analysis (expensive, user-triggered).

---

## 5. Improvement plan (prioritized)

### Tier 1 — do these first (cost ↓, accuracy ↑, mostly small diffs)

1. **Adaptive source block.** Budget the annotation dump (e.g. 8K tokens). Under budget → current behavior. Over → per-source top-K annotations by confidence × relevance-to-current-turn (embeddings), rest stubbed with "N more available via tools." Effort: M. This single change fixes mechanisms 1, 2, 3, 5.
2. **Anthropic prompt caching.** Add `cache_control` breakpoints on the system prompt (the source block is static within a conversation) for chat, compile, verify, and the gatherer's system prompt. Multi-turn writing sessions get dramatically cheaper with zero behavior change. Effort: S.
3. **Let the pipeline say "nothing here."** Empty generator result = legitimate zero (delete the `length === 0 → heuristic` override at `pipelineV2.ts:469-471`); verifier failure = reject or mark `needsReview`, never default-approve (`pipelineV2.ts:629-659`). Keep heuristics only as an explicit "offline mode." Effort: S. Precondition for trusting auto-annotation.
4. **Embedding retrieval in the gatherer.** `get_source_chunks` should cosine-rank annotation embeddings (embed at creation alongside the existing async `searchableContent` step) with keyword fallback. Effort: M.

### Tier 2 — accuracy features that differentiate an academic tool

5. **Draft-time quote verification.** Run every `<document>` output through exact-match verification against source full text (the researchAgent already implements quote verification; `buildTextFingerprint` already exists). Unverifiable quotes get flagged inline in the UI before the student ever sees them as "done." This is the highest-trust feature you can ship. Effort: M.
6. **Evidence-coverage map.** Post-process drafts: every footnote must resolve to an annotation/chunk ID; surface per-paragraph "grounded / partially grounded / ungrounded" in the writing pane. Turns "cite conservatively" from a prompt rule into a checked invariant. Effort: L.
7. **First-class paper plan object.** Thesis, outline, section status currently live half in clipboard `writingProgress`, half in conversation history. Promote to a structured plan (~500 tokens) that is *always* in context — this is what deserves permanent context residency, not annotation dumps. Effort: M.
8. **Counter-evidence gathering.** Teach the gatherer to also fetch the strongest *contradicting* evidence for the current claim. Engaging counterarguments is the difference between a B and an A paper, and the category taxonomy already supports it. Effort: S (prompt change).

### Tier 3 — worthwhile, not urgent

9. **Contextual embeddings.** Prepend doc title + section heading to chunk text before embedding (contextual-retrieval pattern) to sharpen both analysis ranking and gatherer retrieval. Effort: M (requires re-embedding).
10. **Async style analysis.** `loadProjectSourcesTiered` runs Haiku style analysis *synchronously during a chat turn* when missing (`chat/handlers.ts:192-213`) — move to role-assignment time. Effort: S.
11. **Skip post-turn extraction on non-writing turns.** `extractUsedEvidence` runs every turn; skip when no `<document>` was produced. Effort: S.
12. **Utilization telemetry.** You already log tool calls and context snapshots to the analytics dashboard. Add **evidence utilization rate** (% of in-prompt annotations actually cited per turn). If utilization is ~5%, that's the empirical proof for Tier 1 — and the regression metric for everything above. Effort: S.

### What NOT to do

- Don't move to a vector DB or framework-based RAG — at this scale the in-process embedding ranking is fine once the gatherer uses it.
- Don't auto-annotate every document exhaustively "for completeness" — thoroughness should stay relevance-gated; exhaustive mode is a user choice, not a default.
- Don't add more always-in-prompt blocks (the temptation after every feature). The plan object (#7) is the one exception; everything else should earn its tokens through retrieval.

---

## 6. Strengths worth protecting

- Exact-substring grounding + offset realignment in the hard verifier — annotations are *provably* in the source. Never weaken this.
- Embedding-ranked chunk selection for analysis (effort follows relevance).
- Replace-don't-stack semantics for AI annotations on re-analysis.
- The role system (evidence/style/background) with enforced "never cite style references."
- Clipboard + compaction + escalation — the correct primitives; they just need the source block to stop drowning them.
- Reference/bibliography noise filtering before chunking — most annotation tools skip this and pay for it.

## 7. Open questions for Jacob

1. Typical project size today (sources × annotations)? Determines whether the adaptive budget in Tier 1 is urgent or preventative.
2. Should auto-annotations be visually distinct and one-click-prunable in the UI? (Recommended if they become the ingest default.)
3. When the thesis changes, do you want silent re-ranking, a prompt to re-analyze, or both?
4. Is Extended mode earning its keep? Precision + better retrieval may subsume it; two modes is double the prompt-engineering surface.
