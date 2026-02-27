# TASK: Citation Formats (feature/citations)

**Workstream:** MLA + APA Citation Generators
**Branch:** `feature/citations`
**Worktree:** `sm-citation/`
**Dependencies:** None (extends existing citationGenerator.ts)

---

## Objective

Extend `server/citationGenerator.ts` to support MLA 9th Edition and APA 7th Edition formats alongside the existing Chicago style. Add a citation style selector to the frontend.

---

## Current State

`server/citationGenerator.ts` exports:
- `generateChicagoFootnote(citation, pageNumber?, isSubsequent?): string`
- `generateFootnoteWithQuote(citation, quote, pageNumber?): string`
- `generateInlineCitation(citation, pageNumber?): string`
- `generateChicagoBibliography(citation): string`

Uses `CitationData` type from `shared/schema.ts` which includes: sourceType, authors, title, subtitle, containerTitle, publisher, publicationPlace, publicationDate, volume, issue, pageStart, pageEnd, url, accessDate, doi, edition, editors.

---

## Files to Modify

### 1. `server/citationGenerator.ts` — Add MLA + APA Functions

Keep all existing Chicago functions unchanged. Add new exports:

#### MLA 9th Edition

```typescript
/**
 * MLA in-text citation
 * Format: (Author PageNumber) or (Author)
 * Examples:
 *   (Smith 45)
 *   (Smith and Jones 12)
 *   (Smith et al. 78)
 *   ("Article Title" 23)  — no author
 */
export function generateMLAInText(citation: CitationData, pageNumber?: string): string

/**
 * MLA Works Cited entry
 * Core elements in order: Author. Title. Container, Contributors, Version,
 * Number, Publisher, Date, Location.
 *
 * Examples:
 *   Book: Smith, John. The Great Book. Publisher, 2024.
 *   Journal: Smith, John. "Article Title." Journal Name, vol. 12, no. 3, 2024, pp. 45-67.
 *   Website: "Page Title." Site Name, Publisher, 15 Mar. 2024, www.example.com.
 *   Chapter: Smith, John. "Chapter Title." Book Title, edited by Jane Doe, Publisher, 2024, pp. 10-30.
 */
export function generateMLAWorksCited(citation: CitationData): string
```

**MLA Rules:**
- Authors: Last, First. / Last, First, and First Last. / Last, First, et al. (3+)
- Book titles: *Italicized* (use markdown `_Title_` or just plain for text output)
- Article/chapter titles: "In Quotes."
- Journal: "Title." *Journal*, vol. X, no. Y, Year, pp. X-Y.
- Website: "Title." *Site Name*, Day Month Year, URL.
- No "accessed" date unless source may change
- DOI preferred over URL if available: doi:10.xxxx
- Months abbreviated (Jan., Feb., Mar., etc.) except May, June, July

#### APA 7th Edition

```typescript
/**
 * APA in-text citation
 * Format: (Author, Year) or (Author, Year, p. X)
 * Examples:
 *   (Smith, 2024)
 *   (Smith & Jones, 2024, p. 45)
 *   (Smith et al., 2024)
 */
export function generateAPAInText(citation: CitationData, pageNumber?: string): string

/**
 * APA Reference List entry
 * Format: Author, A. A. (Year). Title. Source. DOI/URL
 *
 * Examples:
 *   Book: Smith, J. A. (2024). The great book. Publisher.
 *   Journal: Smith, J. A. (2024). Article title. Journal Name, 12(3), 45-67. https://doi.org/10.xxxx
 *   Website: Smith, J. A. (2024, March 15). Page title. Site Name. https://www.example.com
 *   Chapter: Smith, J. A. (2024). Chapter title. In J. Doe (Ed.), Book title (pp. 10-30). Publisher.
 */
export function generateAPAReference(citation: CitationData): string
```

**APA Rules:**
- Authors: Last, F. M. / Last, F. M., & Last, F. M. / Last, F. M., ... & Last, F. M. (up to 20)
- 21+ authors: first 19 ... last author
- Book titles: *Italicized*, sentence case (only capitalize first word + proper nouns)
- Article titles: No quotes, sentence case
- Journal names: *Italicized*, title case
- Always include DOI if available (as https://doi.org/10.xxxx)
- URL without "Retrieved from" unless content may change
- Use "&" not "and" between authors in reference list
- Use "and" in narrative in-text citations, "&" in parenthetical

### 2. Add Unified Citation Generator

```typescript
type CitationStyle = "chicago" | "mla" | "apa";

/**
 * Unified interface for generating citations in any style
 */
export function generateInTextCitation(
  citation: CitationData,
  style: CitationStyle,
  pageNumber?: string
): string {
  switch (style) {
    case "mla": return generateMLAInText(citation, pageNumber);
    case "apa": return generateAPAInText(citation, pageNumber);
    case "chicago": return generateInlineCitation(citation, pageNumber);
  }
}

export function generateBibliographyEntry(
  citation: CitationData,
  style: CitationStyle
): string {
  switch (style) {
    case "mla": return generateMLAWorksCited(citation);
    case "apa": return generateAPAReference(citation);
    case "chicago": return generateChicagoBibliography(citation);
  }
}

export function generateFootnote(
  citation: CitationData,
  style: CitationStyle,
  pageNumber?: string,
  isSubsequent?: boolean
): string {
  // Only Chicago uses footnotes. MLA and APA use in-text citations.
  if (style === "chicago") {
    return generateChicagoFootnote(citation, pageNumber, isSubsequent);
  }
  // For MLA/APA, return in-text citation as they don't use footnotes
  return generateInTextCitation(citation, style, pageNumber);
}
```

### 3. Update Citation API Routes

In `server/projectRoutes.ts`, find the citation endpoints and update them to accept a `style` parameter:

**`POST /api/citations/generate`** — Add `style` field to request body:
```typescript
// Before:
const { citationData, pageNumber, isSubsequent } = req.body;
// After:
const { citationData, style = "chicago", pageNumber, isSubsequent } = req.body;
```

**`POST /api/project-annotations/:id/footnote`** — Add `style` field:
```typescript
const { quote, pageNumber, style = "chicago" } = req.body;
```

### 4. Export `CitationStyle` Type from Schema

Add to `shared/schema.ts`:
```typescript
export const citationStyles = ["chicago", "mla", "apa"] as const;
export type CitationStyle = typeof citationStyles[number];
```

### 5. Frontend: Citation Style Selector

Find the UI where citations are generated/displayed (likely in `AnnotationSidebar.tsx` or a citation modal).

Add a dropdown/select:
```tsx
<Select value={citationStyle} onValueChange={setCitationStyle}>
  <SelectTrigger>
    <SelectValue placeholder="Citation Style" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="mla">MLA (9th Ed.)</SelectItem>
    <SelectItem value="apa">APA (7th Ed.)</SelectItem>
    <SelectItem value="chicago">Chicago</SelectItem>
  </SelectContent>
</Select>
```

Store the selected style in project settings or local state. Pass it to all citation API calls.

---

## Test Cases

Write these tests mentally and verify each output format:

### MLA Tests

**Book, single author:**
- In-text: `(Smith 45)`
- Works Cited: `Smith, John. The Great Book. Oxford UP, 2024.`

**Journal article, two authors:**
- In-text: `(Smith and Jones 12)`
- Works Cited: `Smith, John, and Jane Jones. "Article Title." Journal of Studies, vol. 12, no. 3, 2024, pp. 45-67.`

**Website, no author:**
- In-text: `("Page Title")`
- Works Cited: `"Page Title." Site Name, 15 Mar. 2024, www.example.com.`

**Book, 3+ authors:**
- In-text: `(Smith et al. 78)`
- Works Cited: `Smith, John, et al. The Group Book. Publisher, 2024.`

### APA Tests

**Book, single author:**
- In-text: `(Smith, 2024, p. 45)`
- Reference: `Smith, J. A. (2024). The great book. Oxford University Press.`

**Journal, two authors:**
- In-text: `(Smith & Jones, 2024)`
- Reference: `Smith, J. A., & Jones, J. B. (2024). Article title. Journal of Studies, 12(3), 45-67. https://doi.org/10.xxxx`

**Website:**
- In-text: `(Smith, 2024)`
- Reference: `Smith, J. A. (2024, March 15). Page title. Site Name. https://www.example.com`

---

## Install Dependencies

None needed.

---

## After Implementation

```bash
npm run check
npm run dev
```

Test:
1. Open a project with documents that have citation data
2. Switch citation style dropdown to MLA
3. Generate a footnote — verify MLA in-text format
4. Copy bibliography entry — verify MLA Works Cited format
5. Switch to APA — verify APA format
6. Switch to Chicago — verify existing Chicago format still works

---

## Important Notes

- Do NOT modify existing Chicago functions. They're tested and working.
- MLA and APA are the #1 and #2 most-used formats in US colleges. Getting these right is critical.
- Sentence case for APA titles means only capitalize the first word, first word after a colon, and proper nouns. This is a manual formatting concern — just output the title as-is from citation data since we can't reliably detect proper nouns.
- The unified `generateInTextCitation` / `generateBibliographyEntry` functions are the main interface other parts of the app will use.
- Keep the function signatures consistent across all three styles for easy swapping.
