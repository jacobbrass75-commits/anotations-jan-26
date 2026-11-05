# Status rubric

Use these exact status labels so reports stay consistent across sessions and tools.

## Claim support

| Status | Use when | Typical next action |
| --- | --- | --- |
| `SUPPORTED` | You read the cited evidence, and it states or directly implies the claim with the same scope, strength, and qualifiers. | None, or add a locator if one is missing. |
| `PARTIALLY SUPPORTED` | The evidence backs part of the claim, but the draft overstates it: a broader population, a stronger verb ("proves" for "suggests"), a dropped qualifier, a changed time frame, or one of several combined points is unsupported. | Narrow the claim to what the source says, or add a source for the unsupported part. |
| `NOT SUPPORTED` | You read the relevant evidence in full, and it does not make this claim. | Find a source that does, or rephrase as the writer's own argument. |
| `CONTRADICTED` | The evidence says the opposite, or reports the claim as a view the author rejects. | Revise the claim, or engage with the contradiction explicitly. |
| `UNVERIFIABLE` | The evidence needed to judge the claim was not available. Always state the reason. | Name the exact page, passage, or file needed. |
| `CITATION NEEDED` | The claim attributes a finding, statistic, quotation, or contested fact to the world but has no citation. | Add a source the user has read, or reframe as the writer's argument. |
| `NO CITATION NEEDED` | The sentence is the writer's own argument, analysis, transition, or widely known background in the field. | None. |

Rules:

- `NOT SUPPORTED` and `CONTRADICTED` need evidence that you read. With nothing to read, the status is `UNVERIFIABLE`.
- Judge the claim in context. A matching sentence used to support a point the source argues against is `CONTRADICTED`, not `SUPPORTED`.
- When one sentence makes several claims, split them into separate items.

## Quotation fidelity

| Status | Use when |
| --- | --- |
| `EXACT` | The quoted words appear in the source character for character, apart from the quotation marks. |
| `MATCH (FORMATTING ONLY)` | The only differences are letter case, whitespace, line breaks, hyphenation at line ends, curly or straight quotes, or OCR punctuation noise. |
| `ALTERED` | Words were added, removed, changed, or reordered without brackets or ellipses, or the brackets and ellipses change the meaning. List each difference. |
| `NOT FOUND` | You searched the full available source text and the passage is absent. |
| `NOT CHECKED` | The source text was not available, or only part of it was and the quote could fall in the missing part. |
| `N/A` | The item has no direct quotation. |

Rules:

- Silent changes inside a quotation are `ALTERED` even when the meaning survives. The writer should either restore the exact wording or mark the change with brackets or an ellipsis.
- For `ALTERED`, show the source wording only if you read it in this session, limited to the words needed to show the difference.
- `MATCH (FORMATTING ONLY)` is acceptable in most styles. Mention it, but don't count it as a problem.

## Locator

| Status | Use when |
| --- | --- |
| `CONSISTENT` | You read the passage, and a page marker in the source text (or a documented equivalent from the locator checks) places it at the cited page, section, or paragraph. |
| `MISMATCH` | You read the passage, and its marker places it somewhere other than the cited location. |
| `MISSING` | The citation has no locator where the style or the type of citation normally requires one, for example a direct quotation in APA, MLA, or Chicago. |
| `UNVERIFIABLE` | You haven't seen the passage with a marker that places it. For example, the source text has no page or section markers, the cited location isn't in the text you have, or you only have the work's page range from a metadata record. |
| `N/A` | No locator is expected, for example a general reference to a whole work. |

Rules:

- A work's page range from a metadata record validates the reference entry's pages only (see Reference and DOI). It doesn't change any item's locator status. When a cited page falls outside that range, keep the locator `UNVERIFIABLE`, note the conflict, and ask the user to check the passage in the edition they used.

## Reference and DOI

| Status | Use when |
| --- | --- |
| `VERIFIED` | The DOI or reference resolved to a record you retrieved in this session, and the title, first author, and year match. |
| `METADATA MISMATCH` | The record exists, but one or more of title, authors, year, journal or publisher, volume, issue, or the reference entry's page range differ from the draft. List each field. |
| `DOES NOT RESOLVE` | The DOI is well formed, but the DOI resolver reports that it does not exist. |
| `MALFORMED` | The DOI string is not a valid DOI after normalization (see the DOI checks). |
| `INCOMPLETE` | The reference is missing elements the style requires, such as a year, title, container, or pages. |
| `NOT PROVIDED` | There is no DOI or reference entry for the item. Don't look one up and insert it unless the user asks and you can verify it. |
| `NOT CHECKED` | You could not look the record up in this session, for example because there's no web access. |

Rules:

- Don't use `VERIFIED` because a DOI "looks right" or because you recognize the paper.
- If a record you retrieved gives different metadata, report both values and let the user decide. Don't silently rewrite the reference.

## Confidence

Assign one level per item, for its overall result.

| Level | Criteria |
| --- | --- |
| `HIGH` | You read the relevant passage in full context, the source text quality is good, and the judgment needs no subject-matter inference beyond the text. |
| `MEDIUM` | You read the passage, but the judgment depends on interpretation, such as degree of hedging or scope, or the source text is partial or OCR-quality, or the claim combines several sources. |
| `LOW` | Evidence is indirect or incomplete, such as an abstract only, an excerpt without context, or a summary rather than the source text. Or the status depends on information you couldn't retrieve. |

An `UNVERIFIABLE` or `NOT CHECKED` result should usually carry `LOW` confidence, unless you are highly confident that the evidence is unavailable, for example "the file was not provided". In that case say "HIGH that this could not be checked" rather than implying the claim is wrong.
