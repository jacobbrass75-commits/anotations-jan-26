---
name: citation-audit
description: Audit the claims, direct quotations, page locators, and references in a student's or researcher's draft against the evidence available, and report a status, confidence level, and next action for each item. Use when the user asks to check citations, verify quotes, find unsupported claims, check DOIs or page numbers, or review a bibliography in an essay, thesis, article, or literature review. Works on pasted text alone; uses ScholarMark library tools when they are connected.
---

# Citation and evidence audit

Check whether each claim in the user's writing is backed by the evidence that is actually available, whether quotations match their sources word for word, and whether locators and references hold up. Report what you checked, what you could not check, and what the user should do next.

The audit is only as good as its honesty about coverage. "Not checked" is a valid and useful answer. A confident wrong answer is the worst outcome.

## Rules that always apply

1. **Never invent evidence or metadata.** Do not create quotations, page numbers, DOIs, authors, titles, years, journal names, volumes, issues, or URLs. Do not "correct" a reference to metadata you have not retrieved from a real record in this conversation.
2. **Your memory is not a source.** You may say that a claim or reference looks unusual and is worth checking, but the status stays `UNVERIFIABLE` until you have read the evidence.
3. **Separate "not found" from "not checked."** `NOT FOUND` means you searched the full available source text and the passage is absent. `NOT CHECKED` or `UNVERIFIABLE` means the text was not available. Never merge the two.
4. **Never fill in an unavailable page.** If a page, PDF, or URL could not be opened, or sits behind a login or paywall, do not reconstruct its contents from the title, an abstract, a search snippet, or memory. Follow [Unavailable sources](#unavailable-sources).
5. **Quote sources sparingly.** In your report, show only the shortest excerpt that proves the point: one sentence, and no more than about 25 words per evidence excerpt. Paraphrase the rest and give its location. Do not reproduce long passages, whole sections, or full texts of copyrighted works, even if the user pasted them.
6. **Do not write evidence into the draft.** You may suggest wording that narrows a claim to what the source says. Do not add citations, quotes, or sources that the user did not provide and you did not verify.
7. **Only write to ScholarMark when the user asks.** Reading saved sources is fine when ScholarMark tools are connected. Saving sources, highlights, or citations requires the user's request or confirmation. Never delete anything during an audit.

## Step 1: Work out what you have

Identify these inputs from the conversation:

- **The draft**: the text to audit. If the user gave none, ask for it.
- **Evidence**: source text the user pasted or attached, sources saved in ScholarMark (if connected), and anything the host lets you open, such as an open-access page.
- **References**: in-text citations, footnotes, a bibliography or reference list, and any DOIs.
- **Citation style**, if stated (APA, MLA, Chicago, Harvard, and so on). If it isn't stated, don't guess. Check locators for internal consistency only.

Decide the mode:

- **Text-only mode**: no ScholarMark tools are available. Audit against the evidence in the conversation. Everything else is `UNVERIFIABLE` or `NOT CHECKED`.
- **ScholarMark mode**: tools such as `get_projects`, `search_project_sources`, `read_source_text`, and `find_quote_in_source` are available. Also use the user's saved sources. See [references/scholarmark-tools.md](references/scholarmark-tools.md).

Only say ScholarMark is connected if its tools are available in this session. If the user wants library features and the tools are not available, tell them how to connect (see [Connecting ScholarMark](#connecting-scholarmark)) and carry on in text-only mode.

Ask a clarifying question only when the answer changes the audit, for example which ScholarMark project holds the sources. Otherwise state your assumption and proceed.

## Step 2: Extract auditable items

Split the draft into items and give each an ID (`C1`, `C2`, and so on) in reading order. Record:

- Where the item sits in the draft (paragraph number, or the opening words of the sentence).
- The claim, in at most one sentence.
- The citation as written, if any.
- Any direct quotation, copied exactly from the draft.
- Any locator (page, page range, section, paragraph, timestamp).
- Any statistic, date, or named finding. These must match the source exactly, including units and qualifiers.

Treat these as auditable: claims attributed to a source, direct quotations, statistics and dates, strong empirical claims without a citation, and every entry in the reference list. Do not audit the author's own argument, interpretation, or framing as if it needed a citation. Mark it `NO CITATION NEEDED` when that's the right call.

For long drafts, audit cited claims, quotations, and statistics first. If you cannot cover everything, say exactly which sections or items you covered.

## Step 3: Gather evidence for each item

Look for evidence in this order and record where each piece came from:

1. Source text in the conversation (pasted or attached).
2. ScholarMark saved sources, when connected.
3. Pages the host can open, when the host has web access and the user is fine with it. Use this for DOI and metadata checks and for open-access text. Respect paywalls and logins.

Read enough surrounding text to judge context. A sentence that matches on its own can still be misused, for example a view the source reports and then rejects, a finding limited to one sample, or a hedged result cited as certain.

## Step 4: Assess each item

Give every item four checks. The full definitions and the confidence criteria are in [references/status-rubric.md](references/status-rubric.md).

| Check | Statuses |
| --- | --- |
| Claim support | `SUPPORTED`, `PARTIALLY SUPPORTED`, `NOT SUPPORTED`, `CONTRADICTED`, `UNVERIFIABLE`, `CITATION NEEDED`, `NO CITATION NEEDED` |
| Quotation | `EXACT`, `MATCH (FORMATTING ONLY)`, `ALTERED`, `NOT FOUND`, `NOT CHECKED`, `N/A` |
| Locator | `CONSISTENT`, `MISMATCH`, `MISSING`, `UNVERIFIABLE`, `N/A` |
| Reference / DOI | `VERIFIED`, `METADATA MISMATCH`, `DOES NOT RESOLVE`, `MALFORMED`, `INCOMPLETE`, `NOT PROVIDED`, `NOT CHECKED` |

Then assign a confidence level (`HIGH`, `MEDIUM`, or `LOW`) for the item's overall result, and one concrete next action.

DOI format, resolution, metadata comparison, and locator rules are in [references/doi-and-locator-checks.md](references/doi-and-locator-checks.md). Follow them exactly. In particular:

- A DOI that is well formed but was not looked up is `NOT CHECKED`, not `VERIFIED`.
- A locator is `CONSISTENT` only when you read the passage itself together with a marker that places it, such as a page marker in the source text, or a documented equivalent listed in the locator checks. Plain text without page markers, which includes most ScholarMark sources, makes page locators `UNVERIFIABLE`.
- A work's page range from a metadata record (for example Crossref's `page` field) checks the reference entry's pages only. It never confirms or rejects the locator of a particular quotation or claim, because it says nothing about where that passage sits.

## Step 5: Report

Use the layout in [references/report-template.md](references/report-template.md):

1. **Coverage**: what you audited, which evidence you used, and what was unavailable.
2. **Summary**: counts by status, plus the items that most need attention.
3. **Item-by-item findings**: one block per item with its statuses, short evidence, confidence, and next action.
4. **Reference list checks**, if there is a reference list.
5. **Next steps**: a short, prioritized list.

Keep the tone factual and specific. Describe the gap ("the source reports 38%, the draft says 'most'"), not the writer. Don't call a mismatch plagiarism or misconduct. Point out what needs fixing and how.

## Step 6: Offer follow-ups

After the report, offer only actions that are possible in this session:

- Re-check items after the user pastes the missing pages or uploads the source.
- With ScholarMark connected and the user's go-ahead: save verified supporting passages as highlights (`save_annotations`, exact quotes only), save citation metadata you verified from a real record (`save_citation`), or save a source the user pasted (`save_source`). Confirm the project first.
- Suggest narrower wording for `PARTIALLY SUPPORTED` claims.

## Unavailable sources

When a source, page, or URL cannot be read, because it wasn't provided, returned an error, timed out, needs a login, is paywalled, is a scanned image with no readable text, or the cited page lies outside the excerpt you have:

1. Mark the affected checks `UNVERIFIABLE` or `NOT CHECKED`.
2. State the specific reason, for example "PDF page 14 not included in the pasted excerpt (pp. 1–9)" or "publisher page requires sign-in".
3. Don't infer the contents from the title, abstract, snippet, or memory.
4. Give the smallest request that would unblock the check, for example "Paste the paragraph on p. 14 that discusses retention rates" or "Upload the PDF to your ScholarMark project and ask me to re-check C4 and C7."

## Connecting ScholarMark

ScholarMark is optional. Text-only audits need no account. To audit against a saved library, the user connects the ScholarMark remote MCP server at `https://mcp.scholarmark.ai/mcp` and signs in with their ScholarMark account through OAuth. When this skill is installed as part of the ScholarMark plugin, the connection is already declared, and the user only needs to connect or sign in where the app prompts.

## Edge cases

- **Secondary citations** ("as cited in"): audit against the source the user actually has, and note that the original was not checked.
- **Several sources for one claim**: assess each source separately, then give the claim the status its best evidence supports, and say which source carries it.
- **Translations, OCR text, and transcripts**: treat differences caused by OCR or transcription as `MATCH (FORMATTING ONLY)` only when the wording is clearly the same. Otherwise use `ALTERED`, and say the source text may be imperfect.
- **Numbers**: a statistic is `SUPPORTED` only if the figure, unit, population, and time frame all match. A paraphrase that keeps the meaning ("38%" as "over a third") is fine. One that inverts it ("38%" as "most") is `CONTRADICTED`, and one that drops a qualifier or narrows the population is `PARTIALLY SUPPORTED`.
- **Retractions and corrections**: flag one only if a record you retrieved in this session shows the notice.
- **The user's own sources**: if the user says something in the draft is their own data or argument, accept that and mark it `NO CITATION NEEDED`.
