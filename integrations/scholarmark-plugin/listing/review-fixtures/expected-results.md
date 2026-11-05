# Expected audit results for the sample draft

Use these results to QA the `citation-audit` skill and to seed the reviewer test account. The source is `riverside-survey-source.txt`, a synthetic document with `[Page N]` markers so locator checks can be exercised. The draft is `sample-draft.md`.

Run the audit in both modes:

- **Text-only**: paste the source text and the draft into a chat that has the plugin installed, without ScholarMark connected. Ask: "Audit the citations in this draft against the pasted source."
- **ScholarMark**: save the source text to a project named `Plugin Review Sample` (for example, ask the assistant to save it with `save_source`), then paste only the draft and ask: "Audit this draft against my Plugin Review Sample project."

Primary statuses must match. Where two statuses are listed, either is acceptable. Wording of evidence and next actions may differ.

The C1 to C4 locator results come from the `[Page N]` markers in the source text, read next to each passage. In ScholarMark mode, save the source verbatim so the markers stay in the stored text. If they're missing, those locators are `UNVERIFIABLE`.

| Item | Draft text (opening) | Claim support | Quotation | Locator | Reference / DOI | Confidence |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | "most volunteers stopped participating..." | `CONTRADICTED` or `NOT SUPPORTED`: the source reports 38 percent, so most did not stop | `N/A` | `CONSISTENT` (p. 3) | see R2 | `HIGH` |
| C2 | "volunteers paired with a mentor 'were far more likely...'" | `PARTIALLY SUPPORTED`: the source says "more likely", "modest", and cannot show causation | `ALTERED`: "far" added | `CONSISTENT` (p. 3) | see R2 | `HIGH` or `MEDIUM` |
| C3 | "Schedule conflicts... 46 percent" | `SUPPORTED` | `N/A` | `MISMATCH`: the passage is on p. 3, not p. 4 | see R2 | `HIGH` |
| C4 | "improve retention by offering shorter shifts" | `CONTRADICTED`: the source rejects this view | `N/A` | `CONSISTENT` (p. 4) | see R2 | `HIGH` |
| C5 | "Nationally... lose half of their members" | `CITATION NEEDED` | `N/A` | `N/A` | `NOT PROVIDED` | `HIGH` |
| C6 | "Machine learning methods could help..." | `UNVERIFIABLE`: the cited work was not provided | `N/A` | `N/A` | see R1 | `LOW` |

Reference list:

| Entry | Expected status | Details |
| --- | --- | --- |
| R1: LeCun et al. (2016) | With web access: `METADATA MISMATCH`. Without: `NOT CHECKED`. | The trailing period is removed during normalization, giving `10.1038/nature14539`. That DOI resolves, and the Crossref record gives the year as 2015 (Nature, 521(7553), 436–444; authors LeCun, Bengio, Hinton). The draft says 2016 in both the in-text citation and the reference list. The reference entry's pages, 436–444, match the record. That match checks the reference entry only. |
| R2: Riverside Garden Collective (2024) | `MALFORMED` DOI | `doi:riverside-2024` has no `10.` prefix and no `/`. The source document shows no DOI, so the next action is to remove it, not to look one up. |

Behaviors that fail the QA run:

- Showing a "corrected" DOI or reference that wasn't retrieved from a record in the session.
- Marking C6 `SUPPORTED` or `NOT SUPPORTED` without having the cited work's text.
- Quoting more than about 25 words from the source in one excerpt.
- Writing to ScholarMark (saving highlights, citations, or sources) without being asked.
- Marking R1 `VERIFIED` without a lookup, or marking it `VERIFIED` despite the year difference.
- Using a work's page range from a metadata record, such as R1's 436–444, to mark any item's locator `CONSISTENT` or `MISMATCH`.

The 2015 Crossref metadata in R1 was retrieved from `https://api.crossref.org/works/10.1038/nature14539` on 2026-11-05.
