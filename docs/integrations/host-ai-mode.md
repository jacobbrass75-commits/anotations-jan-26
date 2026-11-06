# Host-AI Mode (Claude / ChatGPT Do The Thinking)

In host-AI mode, ScholarMark is the storage layer and the user's own Claude or ChatGPT subscription does the AI work. The user pastes a document into chat. The assistant asks what they are looking for, reads the document, and saves the results to ScholarMark: the source, a summary, highlighted quotes with notes, and a citation. Everything then shows up in the ScholarMark web app and is searchable from any later chat.

ScholarMark makes **no OpenAI or Anthropic calls** for these requests, so they cost nothing in provider credits and do not count against the user's ScholarMark token budget.

Host-AI mode is the default. Set `MCP_AI_MODE=server` on the MCP server to also expose the tools that run ScholarMark's own models.

## How It Works

```text
Claude / ChatGPT  --MCP + OAuth-->  mcp-server (/mcp)  --X-ScholarMark-AI-Mode: host-->  Express API
   (reads, judges,                   resolves quote                                       stores only:
    writes notes)                    positions locally                                    no summary, citation,
                                                                                          context, or embedding calls
```

- The MCP server sends `X-ScholarMark-AI-Mode: host` on every backend request (`mcp-server/dist/backend-client.js`).
- The backend checks it with `isHostAiRequest()` (`server/hostAiMode.ts`) and skips:
  - the auto-summary on `/api/upload-text` and text-layer `/api/upload`
  - retrieval context and citation extraction on `POST /api/projects/:projectId/documents`
  - the embedding on `POST /api/project-documents/:id/annotations`. Keyword search still works because `searchableContent` is stored.
  - the token-budget gate on `/api/upload-text`
- `PUT /api/documents/:id/summary` stores a summary that the assistant wrote.
- The server sends usage instructions in the MCP `initialize` response, so Claude and ChatGPT know the workflow without a system prompt.

## Tools In Host-AI Mode

| Tool                                                                                                                                                                                                                                                                     | Purpose                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `save_source`                                                                                                                                                                                                                                                            | Save pasted text verbatim, optionally attach it to a project, and include the summary, key concepts, and citation in one call                                 |
| `read_source_text`                                                                                                                                                                                                                                                       | Read stored text in pages, using absolute character offsets                                                                                                   |
| `save_source_summary`                                                                                                                                                                                                                                                    | Store a summary, main arguments, and key concepts                                                                                                             |
| `save_annotations`                                                                                                                                                                                                                                                       | Highlight exact quotes with a category and note. Positions are found with case, whitespace, and OCR tolerance, and quotes that aren't found are reported back |
| `update_annotation` / `delete_annotation`                                                                                                                                                                                                                                | Edit or remove a saved highlight                                                                                                                              |
| `save_citation`                                                                                                                                                                                                                                                          | Store citation metadata for footnotes and bibliography                                                                                                        |
| `search` / `fetch`                                                                                                                                                                                                                                                       | Search across all projects and open results. This is the shape ChatGPT deep research and company knowledge expect                                             |
| `get_projects`, `create_project`, `get_source_library`, `get_project_sources`, `add_source_to_project`, `search_project_sources`, `get_source_summary`, `get_source_annotations`, `find_quote_in_source`, `get_web_clips`, `get_source_status`, `upload_text_to_project` | Existing storage and read tools; all are free                                                                                                                 |
| `upload_file_to_project`                                                                                                                                                                                                                                                 | Restricted to `.pdf` and `.txt` files with standard text extraction. For scans and images, the assistant reads the file itself and calls `save_source`        |

These tools are hidden in host-AI mode because they spend ScholarMark credits: `get_source_chunks`, `start_conversation`, `send_message`, `get_conversations`, `compile_paper`, and `verify_paper`.

Every tool has a `title` and `readOnlyHint`, `destructiveHint`, and `openWorldHint` annotations. Both connector directories check for these.

## Stored Text And The Original Attachment

Each source has two copies of its text:

- **Stored text** is `fullText`. `read_source_text`, `fetch`, `search`, `find_quote_in_source`, and annotation positions all use it, and every character offset refers to it.
- **The original attachment** is the file served by `GET /api/documents/:id/source`.

`save_source` and `upload_text_to_project` send the text with `verbatim=true` to `/api/upload-text`. The backend then keeps it as given, including leading and trailing whitespace, tabs, runs of spaces, and a final newline. Line breaks are the one exception: multipart form fields always carry them as CRLF, so they're stored as LF. The original attachment holds the same bytes as the stored text. The tool result reports `characters`, `inputCharacters`, and `storedVerbatim`. When `storedVerbatim` is false, which happens when the input used CR or CRLF line breaks, `storedTextNote` explains the difference. In that case, take offsets from `read_source_text`.

Blank text is refused by the MCP server. The backend applies the existing minimum (10 characters after whitespace cleanup) in both modes.

The web paste box sends no `verbatim` field, so it keeps the legacy cleanup: line breaks become LF, tabs become spaces, runs of spaces collapse, and the ends are trimmed. Its original attachment is the raw form field. `.txt` and PDF files sent to `/api/upload`, including through `upload_file_to_project`, are also cleaned up, and their original attachment is the uploaded file byte for byte. Sources saved before this change keep the stored text they already have.

## Connecting

- Claude (web, desktop, mobile): `Customize > Connectors > Add custom connector` with `https://mcp.scholarmark.ai/mcp`. See [claude-mcp.md](claude-mcp.md).
- ChatGPT: open [ChatGPT Plugins](https://chatgpt.com/plugins), select the plus button, then **Add custom MCP server** with the same URL. See [openai-chatgpt-mcp.md](openai-chatgpt-mcp.md).

Both clients connect from their own cloud, so the endpoint has to be publicly reachable over HTTPS. `localhost` will not work for Claude web or ChatGPT. For local testing, use Claude Code (`claude mcp add --transport http scholarmark http://localhost:5002/mcp`) or a tunnel.

Example first prompt:

```text
Here's an article for my thesis project. Save it to ScholarMark, then ask me what I'm looking for before you annotate it.
<paste document>
```

## Listing In The Claude Directory And ChatGPT App Directory

The code side is ready: remote Streamable HTTP, OAuth 2.1 with PKCE and dynamic client registration, tool titles and annotations, and server instructions. What remains needs account access and review:

1. Deploy this version of `mcp-server/` and the backend to `mcp.scholarmark.ai` and `app.scholarmark.ai`.
2. Publish a privacy policy that covers data received from Claude and ChatGPT, and a support contact.
3. Create a reviewer test account with sample projects. Both reviews sign in through OAuth.
4. Prepare a listing: name, short description, logo, and example prompts.
5. Submit through each platform's partner or developer process. Check the current requirements on the official pages before submitting:
   - Anthropic connectors directory: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
   - OpenAI Apps SDK: https://developers.openai.com/apps-sdk

Until a listing is approved, each user can still add ScholarMark as a custom connector using the URL above.

## Configuration

| Variable              | Default                      | Meaning                                                                                                        |
| --------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `MCP_AI_MODE`         | `host`                       | `host` hides server-AI tools and tags backend requests; `server` keeps all tools and ScholarMark AI enrichment |
| `SCHOLARMARK_APP_URL` | `https://app.scholarmark.ai` | Base URL for `viewInApp` and `search` result links                                                             |

## Tests

`tests/server/mcpHostMode.integration.test.ts` starts the real backend routes and `mcp-server/server.mjs`, connects an MCP client over Streamable HTTP, and runs save, read, annotate, search, and fetch with an exhausted token budget. It asserts that no summary, citation, context, or embedding function is called. Run `npm ci` in `mcp-server/` first.
