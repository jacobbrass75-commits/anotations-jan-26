---
name: scholarmark-thesis
# prettier-ignore
description: "Use when Yakub asks to find quotes, gather evidence, search project annotations, or draft thesis sections from ScholarMark sources with exact quote verification and citation support."
version: 1.0.0
category: research
triggers:
  - "scholarmark"
  - "thesis section"
  - "find quotes"
  - "find evidence"
  - "annotations"
  - "citation"
  - "mk ultra"
  - "korean war"
---

<objective>
Use ScholarMark project APIs to pull source-backed evidence and write thesis content with quote fidelity.
Core principle: every quoted passage must match ScholarMark `highlightedText` exactly.
</objective>

<runtime-config>
```bash
SM="${SM:-http://89.167.10.34:5001}"
PID="${PID:-cf547e4d-712b-42a1-a33d-6cb67e68e670}"
```

- Auth: none
- Responses: JSON
- Prefer project-level endpoints for thesis work
</runtime-config>

<backend-preflight>
Before major research or writing runs:

```bash
bash scripts/preflight.sh
```

If preflight fails, do not draft quoted sections. Report the failure and ask Yakub how to proceed.
</backend-preflight>

<core-workflow>
1. Search with at least 3 query variants via `/api/projects/$PID/search`.
2. Collect raw quote objects including:
   - `highlightedText` (verbatim)
   - `annotationId`
   - `documentFilename`
   - `citationData`
   - `startPosition`
3. Draft section text using only collected quotes.
4. Verify all draft quotes with `scripts/verify_quotes.py`.
5. Correct mismatches and rerun verification until all pass.
</core-workflow>

<quote-rules>
1. Never quote from memory.
2. Use exact `highlightedText` for direct quotes.
3. If shortening, mark omissions with `[...]`.
4. Never merge text from different annotations into a single quote.
5. If OCR artifacts appear, flag them explicitly instead of silently fixing.
</quote-rules>

<api-cheatsheet>
```bash
# Search across project sources (primary tool)
curl -sS -X POST "$SM/api/projects/$PID/search" \
  -H "Content-Type: application/json" \
  -d '{"query":"brainwashing Korean War","limit":20}'

# List project documents
curl -sS "$SM/api/projects/$PID/documents"

# Project-document annotations
curl -sS "$SM/api/project-documents/$PROJECT_DOC_ID/annotations"

# Semantic search within one project document
curl -sS -X POST "$SM/api/project-documents/$PROJECT_DOC_ID/search" \
  -H "Content-Type: application/json" \
  -d '{"query":"Dulles testimony"}'

# Full document payload
curl -sS "$SM/api/documents/$DOC_ID"

# Summary-only payload
curl -sS "$SM/api/documents/$DOC_ID/summary"

# Optional: source file metadata / URL
curl -sS "$SM/api/documents/$DOC_ID/source-meta"
```
</api-cheatsheet>

<writing-back>
```bash
# Create project annotation
curl -sS -X POST "$SM/api/project-documents/$PROJECT_DOC_ID/annotations" \
  -H "Content-Type: application/json" \
  -d '{
    "startPosition": 1234,
    "endPosition": 1456,
    "highlightedText": "exact text from source",
    "category": "evidence",
    "note": "Supports pre-Korea institutional interest",
    "isAiGenerated": false
  }'

# Generate footnote from annotation
curl -sS -X POST "$SM/api/project-annotations/$ANNOTATION_ID/footnote" \
  -H "Content-Type: application/json" \
  -d '{"pageNumber":"43"}'

# Generate citation from metadata
curl -sS -X POST "$SM/api/citations/generate" \
  -H "Content-Type: application/json" \
  -d '{"citationData": {...}, "pageNumber":"43", "isSubsequent": false}'
```

Categories: `key_quote`, `argument`, `evidence`, `methodology`, `user_added`
</writing-back>

<thesis-context>
Title: "Manufacturing the Manchurian Candidate: How the Korean War Brainwashing Scare Transformed American Attitudes Toward Psychological Influence"

Central argument:
The Korean War accelerated, but did not create, US institutional interest in psychological control programs.

Current focus:
Section 3 to Section 4 boundary: prove programs predated Korea, then show funding/political acceleration during the panic.
</thesis-context>

<verification>
Use the bundled verifier:

```bash
python3 scripts/verify_quotes.py < /tmp/verify_input.json
```

Input format:

```json
{
  "draft_quotes": [{"text": "quote as written in draft"}],
  "source_quotes": [{"highlightedText": "exact quote from ScholarMark"}]
}
```

Required output section in drafts that include quotes:

```markdown
## Quote Verification Report
- PASS/FAIL status per quote
- Any corrections applied
- Final re-verification result
```
</verification>

<query-strategy>
- Use specific technical terms (`BLUEBIRD`, `ARTICHOKE`, `MKULTRA`, `Edward Hunter`, `Allen Dulles`) before broad abstractions.
- Run at least 3 distinct phrasings before concluding a gap.
- Use `jq` to extract compact quote tables:

```bash
curl -sS ... | jq '.results[] | {quote: .highlightedText, source: .documentFilename, score: .similarityScore}'
```
</query-strategy>
