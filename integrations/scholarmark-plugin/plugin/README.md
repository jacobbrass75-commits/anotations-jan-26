# ScholarMark

ScholarMark helps students and researchers check academic writing against its sources. The plugin has two parts:

- **The `citation-audit` skill** reviews the claims, direct quotations, page locators, and references in a draft. It reports a status, a confidence level, and a next step for each item. It works on text you paste, with no account.
- **The ScholarMark connector** links your AI app to your ScholarMark library at `https://mcp.scholarmark.ai/mcp`, so the assistant can search sources you've saved, confirm quotations against the stored text, and save highlights and citations when you ask.

## What the audit reports

For each item in your draft:

| Check | Possible results |
| --- | --- |
| Claim support | supported, partially supported, not supported, contradicted, unverifiable, citation needed, no citation needed |
| Quotation | exact, formatting-only differences, altered, not found, not checked |
| Locator (page, section) | consistent, mismatch, missing, unverifiable |
| Reference and DOI | verified, metadata mismatch, does not resolve, malformed, incomplete, not provided, not checked |

Every item also gets a confidence level (high, medium, or low) and a suggested next action, such as "paste page 14 so this quote can be checked".

The skill is written to:

- keep what it checked separate from what it couldn't check, and say why something couldn't be checked;
- not supply quotations, page numbers, DOIs, or other citation details that it hasn't found in a source or a retrieved record;
- show only short excerpts from sources, not long passages;
- write to your ScholarMark library only when you ask.

The assistant can still make mistakes. Check important findings against the original sources.

## Example prompts

- "Audit the citations in this paragraph and flag claims the sources don't support." Paste the paragraph, plus any source passages you have.
- "Check whether the quotes in my draft match the source text word for word."
- "Check the DOIs and page numbers in my reference list."
- With ScholarMark connected: "Audit this section against the sources in my Thesis project."

## Connecting ScholarMark (optional)

You only need a ScholarMark account to use your saved library. When your app asks you to connect ScholarMark, sign in through the ScholarMark OAuth page at `app.scholarmark.ai` and approve access. You can disconnect at any time from your app's connector or plugin settings.

- **Claude (claude.ai and the desktop app)**: open the plugin's **Connectors** tab and connect ScholarMark.
- **Claude Code**: the connector loads with the plugin. Run `/mcp` and choose ScholarMark to sign in.
- **ChatGPT and Codex**: connect ScholarMark when prompted during install or first use.

## Data and network use

- **The skill** runs inside your AI app. It has no scripts, hooks, or executables of its own.
- **ScholarMark connector**: when it's connected and the assistant uses a ScholarMark tool, the tool's inputs go to `mcp.scholarmark.ai` and are processed under your ScholarMark account. Inputs include search terms, quotations being checked, and, when you ask to save, source text, highlights, notes, and citation details. ScholarMark stores what you choose to save in your account. It runs in host-AI mode: your AI app does the reading and analysis, and ScholarMark stores the results.
- **DOI checks**: if your AI app has web access, the assistant may look up a DOI at `doi.org`, `api.crossref.org`, or `api.datacite.org`. It sends only the DOI, not your draft.
- **Other pages**: the assistant may open a source URL you give it, through your app's own browsing tools, to read open-access text.

Privacy policy: https://scholarmark.ai/privacy

Terms of service: https://scholarmark.ai/terms

Support: https://scholarmark.ai/support or support@scholarmark.ai

## ScholarMark tools

Read-only tools: `get_projects`, `get_project_sources`, `get_source_library`, `search_project_sources`, `search`, `fetch`, `read_source_text`, `find_quote_in_source`, `get_source_summary`, `get_source_annotations`, `get_source_status`, `get_web_clips`.

Tools that change your library, used only when you ask: `save_source`, `save_annotations`, `save_citation`, `save_source_summary`, `update_annotation`, `delete_annotation`, `create_project`, `add_source_to_project`, `upload_text_to_project`, `upload_file_to_project`.

## Limitations

- The audit can only judge evidence it can read. Missing, paywalled, sign-in-only, or image-only pages are reported as unverifiable.
- A page locator is confirmed only when the audit reads the passage alongside a page marker in the source text. Most pasted and stored text has no page markers, so page locators are often reported as unverifiable. A work's page range from a DOI record checks the reference entry only.
- DOI lookups need web access in your AI app. Without it, DOIs are format-checked only.

## License

MIT. See [LICENSE](LICENSE).
