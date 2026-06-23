# ScholarMark MCP Integration

ScholarMark exposes a remote MCP server for AI clients that can connect to external tools.

Canonical endpoint:

```text
https://mcp.scholarmark.ai/mcp
```

Legacy SSE endpoint:

```text
https://mcp.scholarmark.ai/sse
```

Use Streamable HTTP (`/mcp`) for new clients. Keep SSE only for clients that still require it.

## What It Enables

Connected MCP clients can work with ScholarMark projects without copying source text into chat:

- Create projects.
- List uploaded sources.
- Upload pasted text or base64-encoded files into a project.
- Attach existing library sources to projects.
- Check source processing status.
- Read project sources, summaries, quote annotations, chunks, and web clips.
- Start and continue ScholarMark writing conversations.
- Compile and verify paper drafts.
- Locate exact or OCR-tolerant quotes inside a source and return jump paths.

The quote workflow should use ScholarMark source tools before making source claims:

1. `get_projects`
2. `get_project_sources`
3. `search_project_sources`, `get_source_summary`, or `get_source_chunks`
4. `get_source_annotations`
5. `find_quote_in_source` before quoting in a draft
6. `verify_paper` before final export or submission

## Tool Surface

Source and project management:

- `create_project`
- `get_projects`
- `get_source_library`
- `get_project_sources`
- `add_source_to_project`
- `upload_text_to_project`
- `upload_file_to_project`
- `get_source_status`

Source reading and quote accuracy:

- `get_source_summary`
- `get_source_annotations`
- `search_project_sources`
- `get_source_chunks`
- `find_quote_in_source`
- `get_web_clips`

Writing workflow:

- `start_conversation`
- `get_conversations`
- `send_message`
- `compile_paper`
- `verify_paper`

## Source Roles

When adding or uploading sources, clients may set `source_role`:

- `evidence`: citable source material. Default.
- `background`: contextual source material. Use lightly.
- `style_reference`: writing sample for voice/style only. Do not cite or quote.

Use `style_reference` when a student uploads their own writing sample to guide tone.

## Uploading Through MCP

Text upload:

```json
{
  "project_id": "project-id",
  "title": "Research notes",
  "text": "Paste source text here.",
  "source_role": "evidence"
}
```

File upload:

```json
{
  "project_id": "project-id",
  "filename": "article.pdf",
  "mime_type": "application/pdf",
  "file_base64": "JVBERi0x...",
  "ocr_mode": "standard",
  "source_role": "evidence"
}
```

Supported `ocr_mode` values:

- `standard`
- `advanced`
- `vision`
- `vision_batch`

After uploading PDFs or images with OCR, call `get_source_status` until the source is `ready`.

## Recommended Tool Profiles

Full app workflow:

```json
[
  "create_project",
  "get_projects",
  "get_source_library",
  "get_project_sources",
  "add_source_to_project",
  "upload_text_to_project",
  "upload_file_to_project",
  "get_source_status",
  "get_source_summary",
  "get_source_annotations",
  "search_project_sources",
  "get_source_chunks",
  "find_quote_in_source",
  "get_web_clips",
  "start_conversation",
  "get_conversations",
  "send_message",
  "compile_paper",
  "verify_paper"
]
```

Read-only research profile:

```json
[
  "get_projects",
  "get_project_sources",
  "get_source_summary",
  "get_source_annotations",
  "search_project_sources",
  "get_source_chunks",
  "find_quote_in_source",
  "get_web_clips"
]
```

Writing-safe profile:

```json
[
  "get_projects",
  "get_project_sources",
  "get_source_summary",
  "get_source_annotations",
  "search_project_sources",
  "get_source_chunks",
  "find_quote_in_source",
  "start_conversation",
  "get_conversations",
  "send_message",
  "compile_paper",
  "verify_paper"
]
```

## Auth

ScholarMark MCP uses OAuth 2.0/PKCE for remote clients.

Discovery endpoints:

```text
https://mcp.scholarmark.ai/.well-known/oauth-protected-resource
https://app.scholarmark.ai/.well-known/oauth-authorization-server
```

Rules:

- The MCP server returns `401` plus `WWW-Authenticate` when a token is required.
- OAuth tokens are sent to MCP as `Authorization: Bearer mcp_sm_...`.
- The MCP server passes tokens to the ScholarMark backend for user and scope validation.
- Do not put bearer tokens in URLs.

## Client Guides

- [Gemini MCP setup](./gemini-mcp.md)
- [Claude MCP setup](./claude-mcp.md)
- [OpenAI and ChatGPT MCP setup](./openai-chatgpt-mcp.md)

## Official References

- MCP specification: https://modelcontextprotocol.io
- Gemini CLI MCP docs: https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html
- Claude Code MCP docs: https://code.claude.com/docs/en/mcp
- Claude API MCP connector: https://platform.claude.com/docs/en/agents-and-tools/mcp-connector
- ChatGPT Apps SDK MCP server docs: https://developers.openai.com/apps-sdk/build/mcp-server
- OpenAI MCP and connectors: https://developers.openai.com/api/docs/guides/tools-connectors-mcp
