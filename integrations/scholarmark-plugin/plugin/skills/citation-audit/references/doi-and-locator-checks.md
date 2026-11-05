# DOI, reference, and locator checks

## DOI checks

### 1. Normalize

Before judging a DOI:

- Remove a leading `https://doi.org/`, `http://doi.org/`, `https://dx.doi.org/`, `doi.org/`, `doi:`, or `DOI:` prefix, and any surrounding whitespace.
- Remove trailing punctuation that is part of the sentence and not the DOI, such as a final `.`, `,`, `;`, or `)` that closes a parenthesis opened before the DOI.
- Replace typographic look-alikes introduced by word processors (en dash `–` or em dash `—` where a hyphen `-` was meant, non-breaking spaces) and note the change.
- Compare DOIs case-insensitively. DOIs are not case-sensitive.

Report the normalized form, and list the changes you made.

### 2. Check the format

A normalized DOI starts with `10.`, then a registrant code of digits (sometimes with dot-separated sub-parts), then `/`, then a non-empty suffix with no whitespace. For example, `10.1038/nature14539` is well formed.

Mark it `MALFORMED` if it lacks the `10.` prefix or the `/`, contains spaces, is actually an ISBN, ISSN, PMID, arXiv ID, or URL, or is cut off.

### 3. Check that it resolves

Only when the host lets you fetch web pages:

- `https://doi.org/api/handles/<DOI>` returns JSON. `"responseCode": 1` means the DOI exists. `"responseCode": 100` (HTTP 404) means it does not, so mark it `DOES NOT RESOLVE`.
- `https://doi.org/ra/<DOI>` reports the registration agency, such as `Crossref` or `DataCite`, or `"DOI does not exist"`.

With no web access, the status is `NOT CHECKED`. Say so, and suggest that the user open `https://doi.org/<DOI>` themselves.

### 4. Compare metadata

When the DOI resolves and you can fetch the record:

- Crossref DOIs: `https://api.crossref.org/works/<DOI>`. Read `title`, `author`, `issued`, `container-title`, `volume`, `issue`, and `page`.
- DataCite DOIs: `https://api.datacite.org/dois/<DOI>`. Read `titles`, `creators`, `publicationYear`, and `publisher`.

Compare the title, first author's family name, year, and container against the draft's reference. When the record and the reference entry both give the work's page range, compare those too. This checks the reference entry only, never an in-text locator. Minor formatting differences, such as capitalization, subtitle punctuation, or initials versus full given names, don't count as mismatches. A different year, author, or title is `METADATA MISMATCH`. Report both values.

Use only the DOI in these requests. Don't send the user's draft text to third-party services.

### Common DOI problems to point out

- The trailing period of the sentence is included in the DOI.
- The DOI is duplicated with a prefix, as in `https://doi.org/doi:10....`.
- The DOI belongs to a different version of the work, such as a preprint versus the published article or a book chapter versus the whole book. Point this out when the title matches but the container or year differs.
- A DOI was added to a source that doesn't have one, such as many books, news articles, and web pages. Without a DOI the reference is fine, so don't flag it.

## Reference completeness

Check each reference-list entry against the style the user named. If they didn't name one, use general completeness: author or organization, year, title, container (journal, book, site), and locators such as volume, issue, and pages where they apply. Mark entries missing required parts `INCOMPLETE` and list what's missing.

Cross-check citations against the reference list:

- In-text citations with no matching reference entry.
- Reference entries never cited in the text, which matters in APA and similar styles.
- Author or year mismatches between an in-text citation and its entry, such as "Lee, 2019" in the text but 2018 in the list.

## Locator checks

### Is a locator expected?

- Direct quotations: a page, paragraph, section, or timestamp is expected in APA, MLA, Chicago, and Harvard. Missing it means `MISSING`.
- Paraphrases of a specific passage: a locator is recommended in many styles, but often optional. Mention it, but don't mark it `MISSING` unless the user's style requires it.
- References to a whole work: no locator is expected, so mark `N/A`.

### Can it be verified?

A locator is verified only by the passage itself. You need to read the quoted or paraphrased passage and see a marker in the same text that places it. Use `CONSISTENT` or `MISMATCH` only on that basis.

These markers count:

- **Page markers in the text**, such as "Page 14", `[Page 14]`, `[p. 14]`, form feeds, or running headers with page numbers. Find the passage, take the nearest preceding page marker, and compare that page with the cited page.
- **Documented equivalents** for locators that aren't pages. A section locator matches when the passage sits under that section heading in the text. A paragraph locator matches when the text numbers its paragraphs and the passage is in the cited one. A timestamp matches when the passage appears at that time in a timestamped transcript.

These don't verify a locator:

- **A work's page range from a metadata record**, such as Crossref's `page` field (for example `436-444`). Use it to check the reference entry's pages, and report a difference as `METADATA MISMATCH` on the reference. It never confirms or rejects where a particular passage sits, so the item's locator stays `UNVERIFIABLE`. If the cited page falls outside the record's range, say so in the item's finding and ask the user to check the passage in the edition they used. The record may describe a different version of the work.
- **No markers**: most pasted text and most ScholarMark source text has no reliable page markers. Mark the locator `UNVERIFIABLE` and suggest checking against the PDF.
- **Memory, search snippets, abstracts, or summaries** that mention a page.

**Unpaginated sources** (web pages, ebooks with reflowable text): check that the draft uses a paragraph number, section heading, or timestamp if the style calls for one.

### Format consistency

Within one draft, check that locators follow one convention, such as `p.` for one page and `pp.` for a range in APA, bare page numbers in MLA, and consistent en dashes in ranges. Report inconsistencies once, as a group, rather than item by item.
