# Gemini MCP Setup

ScholarMark can be used from Gemini through MCP-capable Gemini surfaces. The cleanest path today is Gemini CLI with the remote Streamable HTTP endpoint.

Endpoint:

```text
https://mcp.scholarmark.ai/mcp
```

## Gemini CLI

Add ScholarMark with the CLI:

```bash
gemini mcp add --transport http scholarmark https://mcp.scholarmark.ai/mcp
gemini mcp list
```

Or edit `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "scholarmark": {
      "httpUrl": "https://mcp.scholarmark.ai/mcp",
      "timeout": 300000
    }
  }
}
```

Use `/mcp` inside Gemini CLI to confirm the server is connected and tools were discovered.

## Safer First Allowlist

Start with read-only tools while testing auth and quote retrieval:

```json
{
  "mcpServers": {
    "scholarmark": {
      "httpUrl": "https://mcp.scholarmark.ai/mcp",
      "timeout": 300000,
      "includeTools": [
        "get_projects",
        "get_project_sources",
        "get_source_summary",
        "get_source_annotations",
        "search_project_sources",
        "get_source_chunks",
        "find_quote_in_source",
        "get_web_clips"
      ]
    }
  }
}
```

Add write tools only after the read-only workflow is working:

```json
{
  "includeTools": [
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
}
```

## Auth Notes

Gemini CLI supports OAuth discovery for remote SSE and HTTP MCP servers. ScholarMark should trigger this by:

- returning `401` for protected tool calls without a bearer token;
- including `WWW-Authenticate: Bearer resource_metadata="https://mcp.scholarmark.ai/.well-known/oauth-protected-resource"`;
- exposing protected resource metadata on the MCP host;
- exposing OAuth authorization server metadata on `https://app.scholarmark.ai/.well-known/oauth-authorization-server`;
- supporting browser-based authorization and local callback handling.

Gemini CLI OAuth requires a local browser and localhost callback. For headless environments, prefer a controlled header-token setup only if the client can safely store and send `Authorization: Bearer ...`.

## ADK And Gemini API

Google ADK supports MCP toolsets, including Streamable HTTP. Use the ScholarMark endpoint as the remote toolset URL and start with a read-only allowlist.

The Gemini API SDK examples show MCP tools mostly through local sessions. For production ScholarMark use, prefer Gemini CLI or ADK until your API host has explicit MCP client lifecycle and auth handling.

## Suggested Prompts

```text
Use ScholarMark to list my projects and show which sources are attached to each.
```

```text
In ScholarMark, find exact quotes about adolescent social media and mental health. Verify each quote with find_quote_in_source before using it.
```

```text
Upload this pasted source text to my ScholarMark project as background, then summarize what it can and cannot support.
```

## Official References

- Gemini CLI MCP server docs: https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html
- Gemini CLI source docs: https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md
- ADK MCP tools: https://adk.dev/tools-custom/mcp-tools/
- ADK MCP overview: https://adk.dev/mcp/
- Gemini API function calling and MCP: https://ai.google.dev/gemini-api/docs/function-calling
- Gemini Deep Research MCP servers: https://ai.google.dev/gemini-api/docs/interactions/deep-research
