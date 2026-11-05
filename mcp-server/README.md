# ScholarMark MCP Server

Runtime snapshot of the live MCP service behind `https://mcp.scholarmark.ai`.

Canonical endpoint:

```text
https://mcp.scholarmark.ai/mcp
```

Use Streamable HTTP at `/mcp` for new clients. `/sse` is kept for legacy clients.

## Start

```bash
cd mcp-server
npm install
npm start
```

## Environment

- `MCP_SERVER_PORT`: Port to bind. Defaults to `5002`.
- `SCHOLARMARK_BACKEND_URL`: ScholarMark app backend. Defaults to `http://127.0.0.1:5001`.
- `MCP_AUTHORIZATION_SERVER`: OAuth authorization server base URL.
- `MCP_RESOURCE_URL`: Public MCP resource URL.
- `MCP_AI_MODE`: `host` (default) or `server`. In `host` mode, Claude or ChatGPT does the AI work and ScholarMark only stores the results, so ScholarMark makes no OpenAI or Anthropic calls. See `../docs/integrations/host-ai-mode.md`.
- `SCHOLARMARK_APP_URL`: Web app base URL used for links in tool results. Defaults to `https://app.scholarmark.ai`.
- `OPENAI_APPS_CHALLENGE_TOKEN`: Optional. The domain-verification token the OpenAI plugin portal shows when you connect the MCP server. When set, `GET /.well-known/openai-apps-challenge` returns exactly that token as `text/plain`. When unset, or when the value isn't a single line of printable ASCII up to 1024 characters, the route returns 404. The server logs only whether the route is enabled. Set it in the PM2 process environment on the server and keep it out of the repo.

## Notes

- The live deployment runs `node server.mjs` under PM2.
- `server.mjs` is the active entrypoint.
- The service expects nginx to proxy `/mcp` with `Accept: application/json, text/event-stream` for Claude's initialize probe.
- OAuth discovery and token aliases on `mcp.scholarmark.ai` are proxied back to the main app service.

## Tools

Always available (no ScholarMark AI spend):

- `save_source`
- `read_source_text`
- `save_source_summary`
- `save_annotations`
- `update_annotation`
- `delete_annotation`
- `save_citation`
- `search`
- `fetch`
- `create_project`
- `get_projects`
- `get_source_library`
- `get_project_sources`
- `add_source_to_project`
- `upload_text_to_project`
- `upload_file_to_project` (in `host` mode, only `.pdf`/`.txt` files with standard extraction)
- `get_source_status`
- `get_source_summary`
- `get_source_annotations`
- `search_project_sources`
- `find_quote_in_source`
- `get_web_clips`

Only with `MCP_AI_MODE=server` (these run ScholarMark's own models):

- `get_source_chunks`
- `start_conversation`
- `get_conversations`
- `send_message`
- `compile_paper`
- `verify_paper`

Docs for client setup live in:

- `../docs/integrations/host-ai-mode.md`
- `../docs/integrations/scholarmark-mcp.md`
- `../docs/integrations/gemini-mcp.md`
- `../docs/integrations/claude-mcp.md`
- `../docs/integrations/openai-chatgpt-mcp.md`
