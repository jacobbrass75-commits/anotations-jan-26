---
title: "Using Claude or ChatGPT With a Persistent Source Library (ScholarMark Connector)"
description: "How to connect Claude or ChatGPT to ScholarMark so sources, exact-quote highlights, notes, and citations persist across chats. Setup, a worked session, and what the connector does and doesn't do."
category: "Writing workflows"
published: "2026-11-05"
---

**Disclosure:** ScholarMark publishes this guide, which is about a ScholarMark feature.

A common pattern: you paste an article into Claude or ChatGPT, have a good conversation about it, find three useful quotes, and then lose all of it when the chat scrolls away. Next week you paste the same article again.

ScholarMark's connector gives the assistant a place to put that work. Sources, highlighted quotes with your notes, summaries, and citation metadata get saved to your ScholarMark projects. They show up in the ScholarMark web app and can be searched from any later chat.

## What the connector is

It's a remote **MCP server**. MCP (Model Context Protocol) is the standard Claude and ChatGPT use to connect to outside tools. The endpoint is:

```text
https://mcp.scholarmark.ai/mcp
```

You sign in to your ScholarMark account when you connect it, and the assistant can then use ScholarMark tools on your behalf.

## Who does the thinking

By default, the connector runs in what ScholarMark calls **host-AI mode**. Your assistant (Claude or ChatGPT) does the reading, judging, and writing of notes. ScholarMark only stores the results, so it makes no AI calls of its own for these requests.

In practice: the quality of summaries and annotation notes depends on the assistant you're using. ScholarMark's job is keeping exact text, positions, and metadata intact.

## Setup

**Claude.** Anthropic's [custom connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) says custom remote connectors are available on Free, Pro, Max, Ultra, Team, and Enterprise plans.
- Individual plans: go to **Customize > Connectors**, add a custom connector, and enter the URL above.
- Team and Enterprise: an Owner first adds it under **Organization settings > Connectors**, then members connect it.

**ChatGPT.** Add the same URL as a custom MCP server. OpenAI's menu names for this have changed over time. Its current developer documentation for ChatGPT integrations is at [developers.openai.com](https://developers.openai.com/apps-sdk). Follow the steps there for your plan.

**A note on trust.** Anthropic's guide points out that custom connectors aren't verified by Anthropic, and advises connecting only to servers you trust. That advice applies to any connector, including this one. Read ScholarMark's [privacy policy](https://app.scholarmark.ai/privacy) before connecting.

## What the assistant can do once connected

| You ask for... | Tool the assistant uses |
|---|---|
| "Save this article to my thesis project" | `save_source` (stores the text verbatim, optionally with summary and citation) |
| "Highlight the passages about X" | `read_source_text`, then `save_annotations` |
| "Fix the note on that highlight" | `update_annotation` |
| "Add the citation details" | `save_citation` |
| "What have I saved about Y?" | `search` / `fetch`, or `search_project_sources` |
| "Is this exact quote really in the source?" | `find_quote_in_source` |
| "Show my web clips on Z" | `get_web_clips` |
| "Start a new project for my seminar paper" | `create_project` |

Deleting a highlight uses `delete_annotation`, and the connector's instructions tell the assistant to confirm with you first.

## How exact-quote highlighting works

This is the part that matters most for academic writing:

- The assistant sends each quote **copied exactly from the source text**.
- ScholarMark locates it in the stored source, tolerating differences in case, whitespace, and OCR-style punctuation.
- **Quotes that can't be found are reported back and not saved.** If the assistant paraphrases while claiming to quote, the mismatch surfaces instead of being stored as a fake highlight.

That gives you an automatic check that every saved quote actually exists in the source. It doesn't check whether the quote supports your claim. That's still your judgment.

## Worked session

**You:** *Here's an article for my thesis project on port labor. Save it to ScholarMark, then ask me what I'm looking for before you annotate it.* [paste article text]

**Assistant:** saves the source to your project with a summary and the citation details it can see in the text. Then it asks what you're looking for.

**You:** *Evidence that wage agreements came before federal law, and anything that limits that claim.*

**Assistant:** reads the source in pages and saves, say, four highlights:
- Key Quote: the sentence on wage floors, with the note "Core claim for §2. Note the single-employer qualification."
- Evidence: a passage with dates for three port agreements.
- Methodology: the passage saying the data comes from two firms' payroll records.
- Argument: the author's interpretation linking agreements to strikes.

It reports that one passage it tried to quote wasn't found in the source text, re-reads, and saves the corrected wording.

**One week later, in a new chat:** *What did I save about wage floors before 1938?* The assistant searches ScholarMark and returns the saved passages with their sources. Nothing needs to be pasted again.

**In the web app:** the same highlights appear on the source in your project, where you can add printed page numbers to the notes and generate Chicago, MLA, or APA citations.

## Limits to know

- **File uploads through the connector** are limited to PDF and TXT files with standard text extraction in host-AI mode. For scans and images, the assistant reads the file itself and saves the text with `save_source`. Check that transcription against the image before quoting it.
- **Pasted text is stored as given.** If you paste from a preprint, you've saved the preprint.
- **Page numbers** aren't inferred from pasted text. Add the printed page to the note yourself (see [page numbers for PDFs, scans, and e-books](/guides/citing-page-numbers-pdfs-scans-ebooks)).
- **The assistant can still misjudge relevance** or over-state what a passage shows. Read the highlights before you rely on them.
- **Course policies on AI** apply here as much as anywhere. Check yours.

## Next step

[Create a ScholarMark account](https://app.scholarmark.ai/sign-up), make a project for your current paper, then add the connector in Claude or ChatGPT and try the worked session with one source. For what to do with the saved quotes next, see [quote tracking from highlight to final draft](/guides/quote-tracking-from-highlight-to-final-draft).
