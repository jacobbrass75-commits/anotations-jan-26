# Claude MCP Setup

ScholarMark is designed to connect to Claude as a remote MCP server.

Endpoint:

```text
https://mcp.scholarmark.ai/mcp
```

Use Streamable HTTP for new Claude integrations. Treat `/sse` as legacy.

## Claude Web And Claude Desktop

For individual Pro/Max users:

1. Open Claude.
2. Go to `Customize > Connectors`.
3. Click `+` and choose `Add custom connector`.
4. Enter the remote MCP server URL:

```text
https://mcp.scholarmark.ai/mcp
```

5. Connect and complete ScholarMark OAuth.
6. Enable the connector in a conversation from the `+` menu.

For Team and Enterprise workspaces, an owner or primary owner must add the custom connector in organization connector settings first. Individual users then connect their own ScholarMark account.

## Claude Code

Add ScholarMark as a remote HTTP MCP server:

```bash
claude mcp add --transport http scholarmark https://mcp.scholarmark.ai/mcp
```

Then open Claude Code and check:

```text
/mcp
```

If auth is required, follow the browser login flow from the `/mcp` panel.

Project-scoped `.mcp.json` example:

```json
{
  "mcpServers": {
    "scholarmark": {
      "type": "http",
      "url": "https://mcp.scholarmark.ai/mcp",
      "timeout": 300000
    }
  }
}
```

Read-only first-pass config:

```json
{
  "mcpServers": {
    "scholarmark": {
      "type": "http",
      "url": "https://mcp.scholarmark.ai/mcp",
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

## Claude Messages API

Claude API callers can attach ScholarMark as an MCP server in `mcp_servers` and enable a `mcp_toolset`.

Example shape:

```python
response = client.beta.messages.create(
    model="claude-opus-4-8",
    max_tokens=2000,
    messages=[{"role": "user", "content": "List my ScholarMark projects."}],
    mcp_servers=[
        {
            "type": "url",
            "url": "https://mcp.scholarmark.ai/mcp",
            "name": "scholarmark",
            "authorization_token": "SCHOLARMARK_OAUTH_ACCESS_TOKEN"
        }
    ],
    tools=[
        {
            "type": "mcp_toolset",
            "mcp_server_name": "scholarmark"
        }
    ],
    betas=["mcp-client-2025-11-20"]
)
```

The API path expects the developer application to obtain and provide the OAuth access token. Claude web/desktop handles OAuth through connector linking.

## Auth Notes

ScholarMark remote MCP auth should keep these behaviors:

- Permit unauthenticated MCP `initialize`.
- Require bearer auth for protected tools.
- Return `401` with protected resource metadata for missing auth.
- Support OAuth with PKCE and dynamic client registration.
- Keep `MCP_RESOURCE_URL` as `https://mcp.scholarmark.ai`, without `/mcp`.

Claude Code can complete OAuth through a local callback. Claude web/Desktop custom connectors connect from Anthropic cloud infrastructure, so `https://mcp.scholarmark.ai/mcp` must be publicly reachable.

## Quote-Accuracy Prompt

```text
Use ScholarMark sources only. Before quoting, call find_quote_in_source for each quote and include only quotes that return found=true.
```

## Official References

- Claude custom remote MCP connectors: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- Claude Code MCP docs: https://code.claude.com/docs/en/mcp
- Claude API MCP connector: https://platform.claude.com/docs/en/agents-and-tools/mcp-connector
- Claude remote MCP servers: https://platform.claude.com/docs/en/agents-and-tools/remote-mcp-servers
