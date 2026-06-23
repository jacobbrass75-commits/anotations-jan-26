# OpenAI And ChatGPT MCP Setup

ScholarMark can connect to OpenAI products through remote MCP. Use this page to choose the right lane.

Endpoint:

```text
https://mcp.scholarmark.ai/mcp
```

## Decision Matrix

| Lane | Use When | How ScholarMark Connects |
| --- | --- | --- |
| ChatGPT developer mode connector | You want to test ScholarMark inside ChatGPT | Add `https://mcp.scholarmark.ai/mcp` as a custom connector |
| ChatGPT app with Apps SDK | You want a polished publishable ChatGPT app | Keep MCP tools, optionally add iframe UI resources |
| Responses API remote MCP | You are building your own OpenAI API app | Pass ScholarMark as a `type: "mcp"` tool with `server_url` |
| Deep research/company knowledge | You want read-only retrieval | Add a narrow search/fetch-oriented tool profile before publishing |

ScholarMark is currently best suited for ChatGPT developer mode and Responses API remote MCP. Apps SDK UI can come later.

## ChatGPT Developer Mode

1. Enable developer mode in ChatGPT settings.
2. Go to `Settings > Connectors > Create`.
3. Add:

```text
Connector name: ScholarMark
Connector URL: https://mcp.scholarmark.ai/mcp
Description: Source-grounded academic writing workspace for projects, uploaded sources, quote verification, and draft review.
```

4. Create the connector.
5. Complete OAuth linking when prompted.
6. Refresh connector metadata after changing ScholarMark tool definitions.

Recommended first test prompt:

```text
Use ScholarMark to list my projects. Then list the sources in the most recent project.
```

Quote-accuracy test prompt:

```text
Find three usable quotes in my ScholarMark project about my topic. For each quote, call find_quote_in_source and only include it if ScholarMark confirms the quote exists.
```

## Responses API Remote MCP

API developers can attach ScholarMark as a remote MCP tool.

Example shape:

```javascript
import OpenAI from "openai";

const client = new OpenAI();

const response = await client.responses.create({
  model: "gpt-5.5",
  tools: [
    {
      type: "mcp",
      server_label: "scholarmark",
      server_description:
        "ScholarMark academic source and writing tools for projects, uploaded sources, quotes, and verification.",
      server_url: "https://mcp.scholarmark.ai/mcp",
      authorization: `Bearer ${process.env.SCHOLARMARK_MCP_ACCESS_TOKEN}`,
      allowed_tools: [
        "get_projects",
        "get_project_sources",
        "get_source_summary",
        "get_source_annotations",
        "search_project_sources",
        "get_source_chunks",
        "find_quote_in_source",
        "get_web_clips"
      ],
      require_approval: "always"
    }
  ],
  input: "Find source-backed quotes for my paper."
});

console.log(response.output_text);
```

Use read-only `allowed_tools` first. Add upload and writing tools only after user approval and OAuth storage are correct.

## Full Tool Profile

For developer-mode testing after OAuth is stable:

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

## Deep Research And Company Knowledge

OpenAI deep research/company knowledge style integrations work best with narrow retrieval tools. Before treating ScholarMark as a broad research connector, add or map a `search`/`fetch` style read-only pair that returns concise source snippets and stable document references.

Do not expose write tools in this profile:

- `create_project`
- `add_source_to_project`
- `upload_text_to_project`
- `upload_file_to_project`
- `send_message`
- `compile_paper`

Keep `find_quote_in_source` available because it verifies exact quote text against ScholarMark source content.

## Auth Notes

ChatGPT app auth is client-managed by ChatGPT against ScholarMark OAuth metadata. Responses API auth is developer-managed: your application must obtain and pass the ScholarMark access token.

ScholarMark must keep:

- protected resource metadata at `https://mcp.scholarmark.ai/.well-known/oauth-protected-resource`;
- OAuth metadata at `https://app.scholarmark.ai/.well-known/oauth-authorization-server`;
- OAuth authorization-code with PKCE;
- DCR support for clients that dynamically register;
- the `resource` parameter echoed through authorization and token exchange;
- bearer token verification on every MCP request.

## Test Checklist

- ChatGPT developer mode scans the MCP server and shows tools.
- OAuth opens ScholarMark login and returns to ChatGPT.
- `get_projects` works after linking.
- `upload_text_to_project` creates a source and project document.
- `find_quote_in_source` returns `found: true` for a known quote.
- `verify_paper` returns a report for a small compiled draft.
- Refresh connector metadata after tool changes.

## Official References

- ChatGPT developer mode: https://developers.openai.com/api/docs/guides/developer-mode
- Connect from ChatGPT: https://developers.openai.com/apps-sdk/deploy/connect-chatgpt
- Apps SDK MCP server: https://developers.openai.com/apps-sdk/build/mcp-server
- Apps SDK authentication: https://developers.openai.com/apps-sdk/build/auth
- OpenAI MCP and connectors: https://developers.openai.com/api/docs/guides/tools-connectors-mcp
- Build MCP servers for ChatGPT and API integrations: https://developers.openai.com/api/docs/mcp
