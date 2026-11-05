# Report template

Use this layout. Leave out sections that don't apply (for example, Reference list checks when there's no reference list). Keep evidence excerpts to one sentence or about 25 words each.

The example uses placeholder authors, figures, and records to show the format. Never copy them into a real report.

```markdown
## Citation audit

**Coverage**: Audited <N> items from <which part of the draft>. Evidence used: <pasted excerpt of X, pp. 1–9; ScholarMark project "Y" (4 sources); DOI lookups via doi.org and Crossref>. Not available: <list, with reasons>.

**Summary**

| Status | Count | Items |
| --- | --- | --- |
| Supported | 3 | C1, C4, C6 |
| Partially supported | 1 | C2 |
| Not supported / contradicted | 1 | C5 |
| Unverifiable | 2 | C3, C7 |
| Citation needed | 1 | C8 |

Needs attention first: C5 (claim not in source), C2 (causal claim from a correlational finding), C3 (quote unchecked: p. 14 missing).

### Findings

**C2**: Paragraph 2, "Mentoring keeps new volunteers..."
- Claim: Mentoring keeps new volunteers active (cited: Rivera 2021, p. 12).
- Support: PARTIALLY SUPPORTED. The source reports a modest association and says it cannot show causation: "<≤25-word excerpt>" (Rivera 2021, section 3).
- Quotation: N/A
- Locator: UNVERIFIABLE. The source text has no page markers.
- Reference: VERIFIED (title, author, and year match the Crossref record).
- Confidence: MEDIUM. The judgment rests on how strongly "keeps" reads.
- Next action: Rephrase as an association, for example "Mentored volunteers were somewhat more likely to stay", or cite a source that tests causation.

**C3**: ...

### Reference list checks

| Entry | DOI / reference status | Details | Next action |
| --- | --- | --- | --- |
| Rivera (2021) | VERIFIED | | None |
| Okafor (2019) | METADATA MISMATCH | Year: draft 2019, record 2018 | Confirm which edition you used, and correct the year. |

### Next steps

1. Paste p. 14 of Chen (2020) so I can check the C3 quotation.
2. Revise C5 or add a source that supports it.
3. Fix the year for Okafor in the reference list after confirming the edition.
```

## Notes

- Start every finding with the item's location, so the user can find it in their draft.
- Put the status label first in each line, so the report can be scanned.
- When nothing needs fixing, say so plainly. Don't add filler suggestions.
- For a very long audit, give the summary and the items needing attention in full, then offer to show the remaining `SUPPORTED` items on request.
- When the user only asks about one thing, such as "just check my DOIs", report only that check, using the same status labels.
