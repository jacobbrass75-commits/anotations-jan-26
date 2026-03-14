# ScholarMark MCP Server — Auth Flow & Maintenance Guide

## How It Works

The MCP server (`mcp.scholarmark.ai`) uses OAuth 2.0 with PKCE to authenticate Claude.ai users against the ScholarMark backend (`app.scholarmark.ai`).

### Auth Flow (working as of March 14, 2026)

1. **Claude sends `initialize`** → MCP server allows it without auth (health probe)
2. **Claude sends `notifications/initialized`** → Allowed via session reuse (no auth needed)
3. **Claude sends `tools/list`** → MCP server returns **401** with `WWW-Authenticate: Bearer resource_metadata="..."`
4. **Claude starts OAuth** → Discovers authorization server at `app.scholarmark.ai/.well-known/oauth-authorization-server`
5. **User approves** → Browser popup shows ScholarMark consent page (requires Clerk login)
6. **Claude gets Bearer token** → All subsequent requests include `Authorization: Bearer mcp_sm_...`
7. **Tools work** → MCP server passes token through to backend API for validation

### Key Architecture

```
Claude.ai  ──►  mcp.scholarmark.ai:5002 (MCP server)
                    │
                    ├── /.well-known/oauth-protected-resource → resource metadata
                    ├── /mcp → MCP protocol endpoint
                    │
                    └──► app.scholarmark.ai:5001 (main backend)
                            ├── /.well-known/oauth-authorization-server → OAuth discovery
                            ├── /oauth/authorize → consent page (requires Clerk session)
                            ├── /oauth/token → token exchange (PKCE)
                            └── /api/* → tool endpoints (validates Bearer token)
```

### Critical Auth Rules in `server.mjs`

1. **Session reuse comes BEFORE auth check** — so `notifications/initialized` works on existing sessions
2. **`tools/*` methods require auth even on existing sessions** — this triggers the OAuth flow
3. **`initialize` is allowed without auth** — acts as a health probe
4. **Simple `WWW-Authenticate` header** — `Bearer resource_metadata="url"` (no extra fields like realm/scope/error)

## Environment Variables (deploy/refresh-prod.sh)

| Variable | Value | Notes |
|----------|-------|-------|
| `MCP_SERVER_PORT` | `5002` | MCP server port |
| `SCHOLARMARK_BACKEND_URL` | `http://127.0.0.1:5001` | Internal backend URL |
| `MCP_AUTHORIZATION_SERVER` | `https://app.scholarmark.ai` | OAuth server URL |
| `MCP_RESOURCE_URL` | `https://mcp.scholarmark.ai` | **No `/mcp` suffix!** |

**Warning:** `MCP_RESOURCE_URL` must NOT have a `/mcp` path suffix. The resource metadata returns this value directly. Adding `/mcp` breaks the OAuth resource parameter matching.

## Common Issues & Fixes

### "credentials rejected, connection reverted"

**Cause:** Stale cached OAuth state on Claude's side.

**Fix:**
1. Disconnect ScholarMark in Claude.ai Settings → Integrations
2. Clear stale tokens: `sqlite3 /opt/app/data/sourceannotator.db "DELETE FROM mcp_tokens; DELETE FROM mcp_auth_codes;"`
3. Reconnect in Claude.ai

### Tools show as empty (`tools: []`)

**Cause:** `notifications/initialized` getting 401 before `tools/list` can run.

**Fix:** Ensure session reuse check runs BEFORE the auth gate in `server.mjs`. The session reuse block must come before the `isInitialize` / 401 block.

### PM2 env var not updating after deploy

**Cause:** PM2 inherits env from parent shell or saved process list.

**Fix:** Manually restart with explicit env:
```bash
pm2 delete scholarmark-mcp
cd /opt/app/mcp-server
MCP_SERVER_PORT=5002 \
SCHOLARMARK_BACKEND_URL=http://127.0.0.1:5001 \
MCP_AUTHORIZATION_SERVER=https://app.scholarmark.ai \
MCP_RESOURCE_URL=https://mcp.scholarmark.ai \
pm2 start server.mjs --name scholarmark-mcp --cwd /opt/app/mcp-server --interpreter /usr/bin/node
pm2 save
```

Verify with: `cat /proc/$(pm2 pid scholarmark-mcp)/environ | tr '\0' '\n' | grep MCP_`

### Stack overflow crash in `onclose`

**Cause:** `transport.onclose` calling `mcpServer.close()` which calls `transport.close()` → infinite recursion.

**Fix:** The `onclose` handler in `server.mjs` must ONLY clean up the session map. Never call `mcpServer.close()` or `transport.close()` inside it:
```js
transport.onclose = () => {
  const sid = transport.sessionId;
  if (sid) {
    mcpSessions.delete(sid);
  }
};
```

## Deployment

```bash
ssh root@89.167.10.34 "cd /opt/app && bash deploy/refresh-prod.sh"
```

If MCP env vars need fixing after deploy:
```bash
ssh root@89.167.10.34 "pm2 delete scholarmark-mcp && cd /opt/app/mcp-server && \
MCP_SERVER_PORT=5002 SCHOLARMARK_BACKEND_URL=http://127.0.0.1:5001 \
MCP_AUTHORIZATION_SERVER=https://app.scholarmark.ai MCP_RESOURCE_URL=https://mcp.scholarmark.ai \
pm2 start server.mjs --name scholarmark-mcp --cwd /opt/app/mcp-server --interpreter /usr/bin/node && pm2 save"
```

## Things NOT to Change

These were learned the hard way — changing any of these breaks the auth flow:

1. **Don't block `initialize` without auth** — Claude needs it for probing
2. **Don't use a complex `WWW-Authenticate` header** — stick to `Bearer resource_metadata="url"` only
3. **Don't add `/mcp` to `MCP_RESOURCE_URL`** — it must be `https://mcp.scholarmark.ai`
4. **Don't call `mcpServer.close()` in `transport.onclose`** — causes stack overflow
5. **Don't put auth check before session reuse** — breaks `notifications/initialized`
6. **Don't compile `dist/index.js` as a separate entry point** — `server.mjs` is the entry point, `dist/` is only for imported modules
