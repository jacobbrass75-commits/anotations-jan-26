# Go Live: ScholarMark For Claude And ChatGPT

This release turns ScholarMark into a storage backend for Claude and ChatGPT. Users paste a document into chat. The assistant asks what they're looking for, then reads and annotates the document with the user's own plan, and ScholarMark stores the result. In this mode ScholarMark makes no OpenAI or Anthropic calls. For details, see [docs/integrations/host-ai-mode.md](docs/integrations/host-ai-mode.md).

Endpoint once live: `https://mcp.scholarmark.ai/mcp`

---

## 1. Get the code into a working git checkout

The folder these changes were made in (`anotations-jan-26-incident-hostname-20260808`) has a broken git link, so nothing is committed yet. Copy the changed files into a working clone:

```bash
git clone <your-scholarmark-repo-url> ~/Desktop/scholarmark-live
```

```bash
cd ~/Desktop/anotations-jan-26-incident-hostname-20260808 && rsync -R \
  server/hostAiMode.ts \
  server/routes.ts \
  server/documentIngestion.ts \
  server/projects/documentHandlers.ts \
  mcp-server/server.mjs \
  mcp-server/dist/mcp-tools.js \
  mcp-server/dist/backend-client.js \
  mcp-server/deploy/ecosystem.config.cjs \
  mcp-server/README.md \
  tests/server/mcpHostMode.integration.test.ts \
  .github/workflows/ci.yml \
  docs/integrations/host-ai-mode.md \
  docs/integrations/claude-mcp.md \
  docs/integrations/openai-chatgpt-mcp.md \
  docs/integrations/scholarmark-mcp.md \
  ARCHITECTURE.md \
  GO-LIVE-MCP.md \
  ~/Desktop/scholarmark-live/
```

Then check that the diff contains only these changes. If the clone is newer than this folder, `git diff` will show any lines in these files that this copy would overwrite.

```bash
cd ~/Desktop/scholarmark-live && git status && git diff --stat
```

## 2. Verify locally

```bash
npm ci && npm ci --prefix mcp-server
```

```bash
npm run check && npm run lint && npm test
```

`tests/server/mcpHostMode.integration.test.ts` starts the real MCP server against the backend. It checks that saving, annotating, searching, and fetching all work with the token budget used up, and that no AI function is called.

## 3. Commit and push

```bash
git checkout -b mcp-host-ai-mode
git add -A && git commit -m "Add host-AI mode so Claude/ChatGPT can use ScholarMark as storage"
git push -u origin mcp-host-ai-mode
```

Open a PR, let CI pass, and merge into the branch you deploy from. `deploy/deploy-prod.sh` defaults to `origin/master`.

## 4. Before deploying, know what changes for existing users

- **No new required env vars.** `mcp-server/deploy/ecosystem.config.cjs` now sets `MCP_AI_MODE=host` and `SCHOLARMARK_APP_URL` explicitly.
- **Six tools disappear for existing MCP users:** `get_source_chunks`, `start_conversation`, `send_message`, `get_conversations`, `compile_paper`, and `verify_paper`. These run ScholarMark's own models. To keep them, set `MCP_AI_MODE: "server"` in that ecosystem file. Host-mode tools are available in both modes.
- **The web app is unchanged.** Only requests that come through the MCP server skip ScholarMark's AI.
- **Uploads from the MCP server are restricted.** In host mode, `upload_file_to_project` accepts only `.pdf` and `.txt` files with standard text extraction. For scans and images, the assistant reads the file itself and saves the text.

## 5. Deploy

Run the usual release flow from [deploy/RELEASE.md](deploy/RELEASE.md):

```bash
APP_REF=origin/master bash deploy/deploy-prod.sh
```

`refresh-prod.sh` backs up the data, rebuilds the app, runs `npm ci` in `/opt/app/mcp-server`, reloads PM2 with `--update-env`, and runs the smoke checks. Nginx needs no changes.

Then run the smoke test against production:

```bash
APP_BASE_URL=https://app.scholarmark.ai MCP_BASE_URL=https://mcp.scholarmark.ai npm run smoke:prod
```

## 6. Confirm the live server is in host mode

```bash
curl -s https://mcp.scholarmark.ai/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

The response should show `"version":"1.1.0"`, and its `instructions` should mention `save_annotations`. On the server, `pm2 logs scholarmark-mcp` should print `AI mode: host` at startup.

## 7. Connect and test from Claude and ChatGPT

**Claude** (web, desktop, mobile; Pro/Max/Team/Enterprise): go to `Customize > Connectors > Add custom connector`, enter `https://mcp.scholarmark.ai/mcp`, then sign in to ScholarMark. On Team and Enterprise, an owner has to add the connector first.

**ChatGPT:** turn on developer mode, go to `Settings > Connectors > Create`, enter the same URL, then sign in. After any tool change, refresh the connector so it picks up the new tool list.

**Test prompt** for both:

```text
Here's a source for my thesis. Save it to ScholarMark in a project called "Test", ask me what I'm looking for, then annotate it.
<paste a few paragraphs>
```

Pass criteria:

- The assistant calls `save_source` and asks about your goal.
- It calls `save_annotations` and reports which quotes it saved.
- The project and highlights show up at app.scholarmark.ai.
- In a new chat, "search ScholarMark for <keyword>" finds them.

## 8. Roll back if needed

Follow [deploy/ROLLBACK.md](deploy/ROLLBACK.md). To bring back only the server-AI tools without a full rollback, set `MCP_AI_MODE: "server"` in `mcp-server/deploy/ecosystem.config.cjs` on the server, then run:

```bash
cd /opt/app/mcp-server && pm2 startOrReload deploy/ecosystem.config.cjs --update-env
```

## 9. List it in the Claude and ChatGPT directories (optional, needs your accounts)

The code already meets the technical requirements:

- remote Streamable HTTP
- OAuth with PKCE and dynamic client registration
- a title and read-only/destructive annotations on every tool
- server instructions

What's left:

- [ ] Privacy policy page that covers data received from Claude and ChatGPT
- [ ] Support contact email or page
- [ ] Reviewer test account with a sample project, sources, and annotations
- [ ] Listing assets: name, short description, logo, and 3 to 5 example prompts
- [ ] Submit to the Anthropic connectors directory. Check the current requirements first: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- [ ] Submit to the ChatGPT app directory through the Apps SDK. Check the current requirements first: https://developers.openai.com/apps-sdk

Until a listing is approved, anyone can add ScholarMark as a custom connector with the URL above.

## 10. Clean up the local test

The local test servers (backend on `:5001`, MCP on `:5002`) and their throwaway database live in this session's scratchpad. Stop them when you're done. They have no effect on production.
