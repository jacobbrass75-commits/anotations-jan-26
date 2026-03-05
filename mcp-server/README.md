# ScholarMark MCP Server

Runtime snapshot of the live MCP service behind `https://mcp.scholarmark.ai`.

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
