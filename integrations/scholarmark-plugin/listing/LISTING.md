# ScholarMark plugin: listing and submission details

Listing copy, review materials, and the remaining owner actions for the ChatGPT/Codex plugin directory and the Claude plugin directory. The text lives in the manifests (`../plugin/plugin.json` and `../plugin/.claude-plugin/plugin.json`), so this file explains it rather than duplicating it. Edit the manifests, then re-run `node tools/validate.mjs`.

Facts below marked "checked 2026-11-05" were confirmed against the live service without signing in, using the probes in `tools/validate.mjs --live`.

## Listing fields

| Field | Value | Where it's set |
| --- | --- | --- |
| Package name | `scholarmark` | both manifests (`name`) |
| Display name | ScholarMark | `displayName` (Claude), `interface.displayName` (OpenAI) |
| Subtitle (OpenAI, 30 max) | Audit citations and evidence (28) | `interface.shortDescription` |
| Description | Package summary in `description`. Full OpenAI text in `interface.longDescription`. The Claude directory shows `../plugin/README.md`. | manifests, README |
| Developer / author | ScholarMark, support@scholarmark.ai, https://scholarmark.ai | `author`, `interface.developerName` |
| Website | https://scholarmark.ai | `homepage`, `interface.websiteURL` |
| Support | https://scholarmark.ai/support | `supportUrl`, `interface.supportURL` |
| Privacy policy | https://scholarmark.ai/privacy | `privacyPolicyUrl`, `interface.privacyPolicyURL` |
| Terms of service | https://scholarmark.ai/terms | `termsOfServiceUrl`, `interface.termsOfServiceURL` |
| Category (OpenAI) | Productivity | `interface.category`. Change it to the closest category the dashboard offers, such as an education category if one exists. |
| Capabilities (OpenAI) | Audit citations in pasted text; Check quotations against saved sources; Search your ScholarMark library; Save highlights and citations | `interface.capabilities` |
| Starter prompts | 3 prompts, each under 128 characters, with no @mentions | `interface.defaultPrompt` |
| Brand color | `#D4556B` (the site's `--primary`, in `client/src/index.css`): 3.95:1 against white, 4.07:1 against `#212121` | `interface.brandColor`, `brandColorDark` |
| Icon | `assets/logo.png` (512×512) and `assets/icon.png` (128×128), rendered from `assets/logo.svg`, a byte-for-byte copy of `client/public/favicon.svg` | `icon` (Claude), `interface.logo` and `composerIcon` (OpenAI) |
| License | MIT, matching `"license": "MIT"` in the repo's root `package.json` | `license`, `LICENSE` |
| MCP server | `https://mcp.scholarmark.ai/mcp`, Streamable HTTP, OAuth 2.0 with PKCE S256 and dynamic client registration (checked 2026-11-05) | `mcp.json` (OpenAI), inline `mcpServers` (Claude) |

The URLs all answered HTTP 200 on 2026-11-05. The site is a single-page app that returns 200 for any path. `/privacy`, `/terms`, and `/support` are real routes in `client/src/App.tsx`.

Copy rules applied, from the OpenAI plugin guidelines and the Claude Software Directory Policy: no comparisons with other products, no pricing or promotions, no unverifiable outcome claims, no "MCP" or "Plugin" in the name, and a stated list of limitations.

## Live service facts (checked 2026-11-05)

- `initialize` without a token succeeds and reports `ScholarMark 1.1.1`, protocol `2025-06-18`, with the host-AI usage instructions.
- `tools/list` without a token returns `401` with `WWW-Authenticate: Bearer resource_metadata="https://mcp.scholarmark.ai/.well-known/oauth-protected-resource"`.
- Protected resource metadata: resource `https://mcp.scholarmark.ai`, authorization server `https://app.scholarmark.ai`, scopes `read` and `write`.
- Authorization server metadata: `registration_endpoint` `https://app.scholarmark.ai/oauth/register`, PKCE `S256`, `client_id_metadata_document_supported: true`, and token endpoint auth methods `none` and `client_secret_post`.
- The tool list was not fetched live, because that needs a signed-in account. The 22 host-mode tool names come from `mcp-server/dist/mcp-tools.js`, and `tools/validate.mjs` checks the README, the skill, and the review cases against them.
- `/.well-known/openai-apps-challenge` returns `404` (route deployed, token unset). `/healthz` on both hosts and `https://scholarmark.ai/privacy` return `200` (rechecked anonymously 2026-11-05).

## Local tool evidence (not production)

`tests/server/mcpToolInventory.integration.test.ts` runs the real `mcp-server/server.mjs` in host-AI mode against the real backend on a temporary SQLite workspace, through the MCP SDK client, with synthetic users, seeded OAuth tokens, and the review fixture. It calls all 22 tools. It reads back every write: project, sources, summary, annotations (save, update, delete), citation, and attachments. It checks that missing IDs and missing fields are rejected. It also checks that a `read`-only token can read but each write gets `403` with a missing-`write`-permission message, that an expired token is rejected, and that another user's token sees no data. The run made no ScholarMark AI calls. Signed-in production behavior is still unverified. The eight review cases test model behavior, so they need a host chat with the plugin and the reviewer account. The test only confirms the fixture's page markers survive storage and quote lookup.

## Review materials (OpenAI MCP review)

`plugin.json` carries the five positive and three negative test cases and the release notes, so they're imported with the ZIP. They're written against a reviewer account seeded like this:

1. Create a dedicated ScholarMark test account that signs in with an email and password, with no MFA, email codes, or magic links. OpenAI rejects plugins whose test login needs extra steps. Confirm the Clerk sign-in flow allows this for the account.
2. Create a project named `Plugin Review Sample`.
3. Save `review-fixtures/riverside-survey-source.txt` into it as a source titled "Riverside volunteer survey". This is a synthetic document written for review. It's not a real publication, so there's no copyright concern.
4. Run all eight test cases yourself with that account before submitting. `review-fixtures/expected-results.md` has the expected audit outcomes for the sample draft.
5. Enter the credentials in the portal's **Review details** form, never in the package.

Still to provide: `review.demo_recording_url`, a reviewer-accessible video walkthrough of the test cases. `tools/validate.mjs` warns until it's set.

## Owner actions before submission

These can't be done from this folder, or they need account access.

| # | Item | Why | Status |
| --- | --- | --- | --- |
| 1 | **Deploy and review the privacy policy update** | `client/src/pages/Privacy.tsx` now has a connector section covering data sent to and from ScholarMark, processing roles, storage, logs, and controls, plus the backup rotation (14 most recent snapshots, from `deploy/backup-data.sh`). The update is deployed and the live disclosure has been verified. The OpenAI guidelines ask for **retention timelines**. The page states that saved content stays until the user deletes it and that backups rotate by count, and it gives no time period for logs or backups, because the repo doesn't set one. Decide whether to adopt a stated log and backup period, and have the owner or counsel review the text. | Live and verified; retention-period decision and owner/counsel review pending |
| 2 | **OpenAI domain verification** | The portal asks for its challenge token as plain text at `https://<host>/.well-known/openai-apps-challenge`, on the MCP hostname or an eligible parent domain. `mcp-server/server.mjs` serves that path from `OPENAI_APPS_CHALLENGE_TOKEN` and returns 404 while it's unset. The route is deployed and returns 404 (verified default-off). Copy the token from the portal's **Connect MCP server** dialog into the PM2 environment, restart, confirm `curl https://mcp.scholarmark.ai/.well-known/openai-apps-challenge` prints only the token, then complete the challenge in the portal. | Deployed default-off; portal token pending |
| 3 | Demo video | Required for OpenAI MCP review | Not done |
| 4 | Reviewer test account | See above. Also needed: OpenAI private test credentials in **Review details**. | Not done |
| 5 | Developer identity | OpenAI shows the verified developer identity's name, and the public URLs must identify the same publisher. Verify the individual or business identity under OpenAI organization settings. Claude submissions need a paid claude.ai plan. | Not done |
| 6 | Claude plugin-bundle source | The Claude directory takes a plugin bundle as a GitHub repository (root or subfolder) containing `.claude-plugin/plugin.json`. The GitHub plugin source has been validated and a draft is saved at https://claude.ai/directory/manage. The publisher terms still need to be accepted before submitting. | Draft saved; publisher terms pending |
| 7 | Name availability | Neither directory's name check can be run offline. `scholarmark` passes `claude plugin validate` and the Agent Plugins name pattern. | Check in each portal |
| 8 | Confirm license | The manifests declare MIT to match the root `package.json`. Change both manifests and `LICENSE` if the plugin should ship under different terms. | Confirm |
| 9 | Country availability | `publication.countries` is left out, so the dashboard's targeting is kept. | Set in dashboard if needed |

## Known discrepancy

OpenAI's packaging guide puts OAuth settings at `mcpServers.<name>.extensions["com.openai"].auth` in `mcp.json`. The published Agent Plugins `mcp.schema.json` 1.0.0 (fetched 2026-11-05) sets `additionalProperties: false` on server entries and doesn't list `extensions`. The package follows OpenAI's guide, because the OpenAI portal reads that block. If the upload rejects it, delete the `extensions` block. The server's OAuth discovery advertises the same DCR registration endpoint.

## Sources

- OpenAI, Package your plugin: https://developers.openai.com/plugins/build/plugins
- OpenAI, Upload and submit your plugin: https://developers.openai.com/plugins/deploy/submission
- OpenAI, Plugin guidelines: https://developers.openai.com/plugins/plugin-guidelines
- Claude Code, Plugin manifest reference: https://code.claude.com/docs/en/plugins-reference
- Claude Code, Publish and distribute a plugin: https://code.claude.com/docs/en/plugins/publish
- Claude, Build plugins for Claude: https://claude.com/resources/articles/build-plugins-for-claude
- Claude, Plugin pre-submission checklist: https://claude.com/docs/plugins/pre-submission-checklist
- Claude, Plugin feature support across platforms: https://claude.com/docs/plugins/platform-support
