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

## Notes

- The live deployment runs `node server.mjs` under PM2.
- `server.mjs` is the active entrypoint.
- The service expects nginx to proxy `/mcp` with `Accept: application/json, text/event-stream` for Claude's initialize probe.
- OAuth discovery and token aliases on `mcp.scholarmark.ai` are proxied back to the main app service.

## Tools

- `create_project`
- `get_projects`
- `get_source_library`
- `get_project_sources`
- `add_source_to_project`
- `upload_text_to_project`
- `upload_file_to_project`
- `get_source_status`
- `get_source_summary`
- `get_source_annotations`
- `search_project_sources`
- `get_source_chunks`
- `find_quote_in_source`
- `get_web_clips`
- `start_conversation`
- `get_conversations`
- `send_message`
- `compile_paper`
- `verify_paper`

Docs for client setup live in:

- `../docs/integrations/scholarmark-mcp.md`
- `../docs/integrations/gemini-mcp.md`
- `../docs/integrations/claude-mcp.md`
- `../docs/integrations/openai-chatgpt-mcp.md`
