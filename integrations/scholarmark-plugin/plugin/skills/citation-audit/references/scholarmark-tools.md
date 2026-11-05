# Using ScholarMark tools in an audit

Use this file only when ScholarMark tools are available in the session. ScholarMark stores the user's sources, highlights, and citation metadata. You do the reading and judging; ScholarMark finds and stores text.

The tools act on the signed-in user's own ScholarMark account. If a tool returns an authorization error, tell the user to reconnect or sign in to ScholarMark in their app's connector or plugin settings, and continue in text-only mode.

## Read-only tools for auditing

| Tool | Use it to |
| --- | --- |
| `get_projects` | List the user's projects, to pick the one that holds the sources for this draft. |
| `get_project_sources` | List sources in a project and get each `project_document_id`. |
| `search_project_sources` | Search a project's source text and saved highlights for a claim's key terms. Use this to find candidate evidence. |
| `search` and `fetch` | Search everything the user has saved across projects, then open a result. `fetch` returns the text and any stored citation metadata. |
| `read_source_text` | Read a source's stored text in pages (default 20,000 characters, up to 60,000 per call). Continue from `nextOffset` until it is `null` before deciding a quote is `NOT FOUND`. |
| `find_quote_in_source` | Check a quotation against a source. Pass the quote exactly as it appears in the draft, plus `project_document_id` (or `document_id`). |
| `get_source_summary` | Load a stored summary and key concepts. A summary is not evidence. Use it to decide where to read, never to support a claim. |
| `get_source_annotations` | Load the user's saved highlights and notes for a source. |
| `get_source_status` | Check whether an uploaded source has finished processing. If it hasn't, its text may be incomplete, so mark checks that depend on it `NOT CHECKED`. |

## Reading `find_quote_in_source` results

The tool returns `found` and, when found, `match.matchType` and `match.matchedText`.

| `matchType` | Quotation status | What to do |
| --- | --- | --- |
| `exact` | `EXACT` | Nothing more needed. |
| `case_insensitive` | `MATCH (FORMATTING ONLY)` | Note the case difference. |
| `whitespace_insensitive` | `MATCH (FORMATTING ONLY)` | Usually line breaks or spacing. |
| `alphanumeric` | Compare `matchedText` with the draft yourself. | The letters and digits match but punctuation or spacing differs. Use `MATCH (FORMATTING ONLY)` unless a punctuation change alters meaning, in which case use `ALTERED`. |
| `annotation` | Not yet decided. | The quote matched a saved highlight rather than the current text. Read the source around the highlight's position with `read_source_text` before assigning a status. |
| `found: false` | `NOT FOUND` only after you have confirmed the source text is complete. | Check `get_source_status`. If the source is still processing or failed, use `NOT CHECKED`. Also try the quote without its outer punctuation or ellipses, because a quote that splices two passages won't match as one string. |

The tool confirms the wording only. You still have to judge, from the surrounding text, whether the passage supports the claim.

ScholarMark stores plain text. Page numbers are usually not preserved unless the original text contained them, so treat page locators as `UNVERIFIABLE` unless you can see page markers in what `read_source_text` returns.

## Tools that write: only with the user's go-ahead

| Tool | Use when the user asks to |
| --- | --- |
| `save_source` | Save source text they pasted, verbatim, optionally to a project. |
| `save_annotations` | Save verified supporting passages as highlights. Use exact quotes from the source and a note that ties each one to the claim ID. Report any quotes the tool returns in `notFound`. |
| `save_citation` | Store citation metadata. Include only fields you verified from the source itself or a retrieved record. Leave everything else out. |
| `save_source_summary`, `update_annotation` | Change stored summaries or highlight notes. This overwrites existing values, so confirm first. |
| `create_project`, `add_source_to_project`, `upload_text_to_project`, `upload_file_to_project` | Organize sources, when the user asks. |

Don't call `delete_annotation` during an audit. If the user asks to remove a highlight, confirm the specific highlight first.

## A typical connected audit

1. `get_projects`, then confirm the project with the user if more than one fits.
2. `get_project_sources` to map each cited author or work to a `project_document_id`. Mark any cited work that isn't in the project `UNVERIFIABLE` (not in library).
3. For each item: `search_project_sources` for its key terms, `read_source_text` around the hits, and `find_quote_in_source` for every direct quotation.
4. Report. Then offer to save the verified supporting passages with `save_annotations`.
