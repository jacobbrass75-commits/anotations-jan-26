# ScholarMark plugin (Claude, ChatGPT, and Codex)

Source, tooling, and listing material for the ScholarMark plugin. The plugin bundles:

- the **`citation-audit` Agent Skill**: a claim-to-evidence, quotation, locator, and DOI audit for student and academic writing, which works on pasted text alone;
- the existing **ScholarMark remote MCP server** at `https://mcp.scholarmark.ai/mcp` (host-AI mode, OAuth with dynamic client registration), so the audit can also use the user's saved library.

The plugin's only server addition is the default-off OpenAI domain-verification route in `mcp-server/server.mjs` (see `OPENAI_APPS_CHALLENGE_TOKEN` in [`mcp-server/README.md`](../../mcp-server/README.md)). The plugin points at the deployed connector documented in [`docs/integrations/scholarmark-mcp.md`](../../docs/integrations/scholarmark-mcp.md) and [`docs/integrations/host-ai-mode.md`](../../docs/integrations/host-ai-mode.md).

## Layout

```text
integrations/scholarmark-plugin/
├── plugin/                          # the distributable plugin folder
│   ├── .claude-plugin/plugin.json   # Claude manifest (MCP server declared inline)
│   ├── plugin.json                  # Agent Plugins manifest + extensions["com.openai"] (ChatGPT, Codex)
│   ├── mcp.json                     # Agent Plugins MCP config (OpenAI)
│   ├── skills/citation-audit/       # SKILL.md + references/
│   ├── assets/                      # logo.svg (copy of client/public/favicon.svg), logo.png, icon.png
│   ├── README.md                    # user-facing; the Claude directory shows it as the listing
│   └── LICENSE
├── listing/
│   ├── LISTING.md                   # listing fields, review materials, owner actions before submission
│   └── review-fixtures/             # synthetic source, sample draft, expected audit results
└── tools/
    ├── validate.mjs                 # offline checks, plus optional --live and --claude-cli
    ├── package.mjs                  # builds dist/*.zip deterministically and re-validates each archive
    └── build-icons.mjs              # renders the PNG icons from logo.svg with the repo's sharp
```

One folder serves both ecosystems. Claude Code and claude.ai read `.claude-plugin/plugin.json`, and OpenAI reads the root `plugin.json` and `mcp.json`. The packager builds a separate ZIP for each, so neither directory sees the other's manifest.

## Requirements

- Node 22.2 or later (`zlib.crc32`). `validate.mjs` and `package.mjs` use only Node built-ins.
- For `build-icons.mjs` only: `npm ci` at the repository root, for `sharp`.
- Optional: Claude Code 2.1.281 or later for `--claude-cli`. Tested with 2.1.296.

## Commands

Run these from the repository root.

```bash
# Offline checks: manifests, field limits, icons, contrast, skill front matter, review cases,
# README/tool consistency with mcp-server/dist/mcp-tools.js, file rules, secret scan.
node integrations/scholarmark-plugin/tools/validate.mjs

# Also run Claude Code's validator and unauthenticated, read-only live probes: every linked URL,
# OAuth discovery, anonymous initialize, and a 401 on tools/list. The probe session is deleted afterwards.
node integrations/scholarmark-plugin/tools/validate.mjs --live --claude-cli

# Build the upload ZIPs and SHA256SUMS in integrations/scholarmark-plugin/dist/ (git-ignored).
node integrations/scholarmark-plugin/tools/package.mjs

# Re-render assets/logo.png and assets/icon.png after the brand SVG changes.
node integrations/scholarmark-plugin/tools/build-icons.mjs
```

`validate.mjs` exits with code 1 on any error. Warnings, such as the missing demo video URL, don't fail the run. `package.mjs` refuses to write packages when validation fails, and validates each ZIP again after extracting it.

## Test locally

**Claude Code**

```bash
claude --plugin-dir integrations/scholarmark-plugin/plugin
```

In the session, run `/mcp` and choose `scholarmark` to complete ScholarMark OAuth in the browser. The skill loads as `scholarmark:citation-audit`. To test the packaged copy, pass `dist/scholarmark-claude-1.0.0.zip` to `--plugin-dir` instead.

**claude.ai and the desktop app**: in **Customize > Plugins**, choose **Add > Upload plugin** and select `dist/scholarmark-claude-1.0.0.zip`. Then connect ScholarMark from the plugin's **Connectors** tab.

**ChatGPT desktop and Codex**: add a personal marketplace entry, as described in the OpenAI guide's "Install a local plugin manually" section. Copy `plugin/` to `~/.codex/plugins/scholarmark`, then add this to `~/.agents/plugins/marketplace.json`:

```json
{
  "name": "local-scholarmark",
  "interface": { "displayName": "ScholarMark (local)" },
  "plugins": [
    {
      "name": "scholarmark",
      "source": { "source": "local", "path": "./.codex/plugins/scholarmark" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Productivity"
    }
  ]
}
```

Restart the ChatGPT desktop app and install from the local source. If the ScholarMark tools don't appear, add the server through ChatGPT **Plugins > + > Add custom MCP server** with `https://mcp.scholarmark.ai/mcp`, as described in [`docs/integrations/openai-chatgpt-mcp.md`](../../docs/integrations/openai-chatgpt-mcp.md).

**Behavior QA**: run the sample draft in `listing/review-fixtures/` in text-only and connected modes, and compare the results with `expected-results.md`. No `claude plugin eval` suite is included yet.

**Tool QA (local)**: `npx vitest run tests/server/mcpToolInventory.integration.test.ts` calls all 22 host-mode tools through `mcp-server/server.mjs` against a temporary local backend with synthetic data, and checks readback, missing-data rejection, and read-only scope. It needs `npm ci` in both the repo root and `mcp-server/`. It doesn't stand in for a signed-in production check.

## Submit

Neither submission has been made. See [`listing/LISTING.md`](listing/LISTING.md) for the owner actions that come first. The privacy policy update is live, and the OpenAI domain-verification route is deployed and returns 404 until the token is set. The Claude directory draft is saved and waits on publisher terms. OpenAI still needs private test credentials, the domain token, the reviewer login, and the demo video.

- **ChatGPT and Codex**: upload `dist/scholarmark-openai-<version>.zip` in the OpenAI Platform dashboard's Plugins page, connect the MCP server (OAuth with DCR, read from `mcp.json`), complete domain verification, enter reviewer credentials, and submit. Guide: https://developers.openai.com/plugins/deploy/submission
- **Claude directory**: push `plugin/` to a GitHub repository you control, then submit it as a **Plugin bundle** at https://claude.ai/directory/manage. Guide: https://claude.com/docs/plugins/submit

## Keeping it in sync

- **Server tools**: the README tool lists, the skill's tool references, and the OpenAI review cases are checked against `mcp-server/dist/mcp-tools.js` on every `validate.mjs` run. After changing tools on the server, re-run it. OpenAI rescans the hosted MCP server separately, so tool changes don't need a new ZIP.
- **Metadata or skill changes**: bump `version` in **both** manifests (the validator requires them to match), rebuild with `package.mjs`, and upload a new ZIP to OpenAI. For Claude, push the new version to the repository.
- **Brand mark**: copy the new `client/public/favicon.svg` to `plugin/assets/logo.svg`, then run `build-icons.mjs`.

## Design notes

- **Inline MCP server for Claude**: the server is declared in `.claude-plugin/plugin.json` under `mcpServers` with `"type": "http"`. The manifest reference supports this, and it avoids a root `.mcp.json`.
- **OAuth**: no client ID or secret ships. Both clients discover the authorization server from `/.well-known/oauth-protected-resource` and register dynamically. `mcp.json` declares `auth.type: "oauth"` with `client.mode: "dcr"`. See the schema discrepancy note in `listing/LISTING.md`.
- **Host-AI mode only**: the skill uses only tools the live server exposes in host-AI mode. Tools that spend ScholarMark AI credits aren't referenced.
- **No hooks, scripts, or executables in the plugin**: only Markdown, JSON, and images ship. This keeps both directories' security scans simple and lets the plugin install on claude.ai.
