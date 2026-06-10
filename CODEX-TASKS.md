# ScholarMark — Implementation Brief for Codex

You are implementing the remediation plan from a completed engineering audit (see `AUDIT-2026-06-09.md` for full findings; this file is self-contained — you do not need to read the audit to do the work).

## What this repo is

ScholarMark: a research/writing SaaS. React 18 + Vite + Wouter + TanStack Query + Tailwind/shadcn client (`client/`), Express 4 + Drizzle ORM + better-sqlite3 server (`server/`), shared Drizzle/Zod schema (`shared/schema.ts`), Chrome extension (`chrome-extension/`), standalone MCP server (`mcp-server/`). Auth is Clerk sessions + custom JWT + `sk_sm_` API keys + `mcp_sm_` OAuth tokens, all resolved in `server/auth.ts`. It is deployed to production (single Hetzner box, PM2, nginx) and has paying users — treat every change as production-affecting.

## Ground rules

1. **Work phase by phase, task by task, in order.** Each task = one commit with a clear message. Do not batch unrelated changes.
2. **After every task run:** `npm run check` (tsc, must exit 0) and `npm test` (sequential Vitest runner, ~5–10 min, must exit 0). Do not proceed with a red suite.
3. **Match existing conventions:** strict TS, named exports, feature-based route files registered via `register*Routes(app)`, storage modules per domain, Zod validation at boundaries. No new frameworks, no `any`, no class hierarchies.
4. **Do not** migrate off SQLite, introduce a vector DB, convert to a monorepo/workspaces, rewrite the React component tree, or touch `mcp-server/dist/` contents.
5. **Do not** change any API request/response shapes — the Chrome extension and MCP server depend on them.
6. If a task turns out to require changes beyond what's described, stop that task, leave a note in `CODEX-NOTES.md`, and continue with the next task.

Environment notes: dev runs on Windows and Linux. Tests must pass on both (Phase 1 fixes the current Windows breakage). `npm run dev` starts the server on port 5001. Tests are self-contained (SQLite + temp dirs, no external services), but the full integration suite needs no API keys.

---

## Phase 0 — Quick wins (all small, independent)

### 0.1 Fix Windows test bootstrap
`tests/server/helpers/bootstrapTempWorkspace.ts:17` calls `symlink(src, dest)`, which throws `EPERM` on Windows without admin rights, killing the whole sequential suite at `imageRoutes.test.ts`. Change to pass the symlink type so Windows uses a junction (junctions need no privileges and only work for directories, which this is):
```ts
await symlink(join(repoRoot, "node_modules"), join(tempDir, "node_modules"), "junction");
```
`"junction"` is ignored on POSIX, so this is safe cross-platform.
**Accept:** `npm test` passes on Windows (or at minimum `npx vitest run tests/server/imageRoutes.test.ts` passes).

### 0.2 Non-breaking dependency patch
Run `npm audit fix` (NOT `--force`). This should clear the `qs`/`body-parser`/`express` chain, `ws`, and `js-cookie` advisories within semver.
**Accept:** `npm run check` + `npm test` green; `npm audit --omit=dev` shows fewer findings than before; lockfile diff contains no major-version bumps.

### 0.3 Move type packages to devDependencies
`package.json` has `@types/cors` and `@types/multer` in `dependencies`. Move both to `devDependencies`.
**Accept:** `npm run check` green.

### 0.4 Allow pinch-zoom
`client/index.html:5` has `maximum-scale=1` in the viewport meta, which blocks zoom — an accessibility problem for a reading app. Remove `, maximum-scale=1`.
**Accept:** meta reads `width=device-width, initial-scale=1.0`.

### 0.5 Root README
There is no root `README.md`. Create one (~60 lines): what ScholarMark is (one paragraph), the four deployable surfaces (client, server, chrome-extension, mcp-server), prerequisites (Node 20+), setup (`npm install`, `npm run db:push`, `.env` keys required: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, Clerk keys — see `server/productionConfig.ts` for the authoritative list), commands table (`dev`, `build`, `check`, `test`, `smoke:local`), and links to `ARCHITECTURE.md` for the deep map and `deploy/` docs for operations. Do not duplicate content from those docs — link to them.
**Accept:** README exists, every command in it actually works.

---

## Phase 1 — CI safety net

### 1.1 GitHub Actions workflow
Create `.github/workflows/ci.yml`:
- Trigger: `push` to `main` + all `pull_request`.
- Job `test`: matrix `os: [ubuntu-latest, windows-latest]`, Node 20, `actions/checkout` → `actions/setup-node` with `cache: npm` → `npm ci` → `npm run check` → `npm test`.
- Job `audit`: ubuntu only, `npm ci` → `npm audit --omit=dev --audit-level=high`. Set `continue-on-error: true` on this job for now (it goes red-blocking after Phase 2 lands).
**Accept:** workflow YAML is valid (`npx yaml-lint` or equivalent check), and the `test` job's steps run green locally when executed manually (`npm ci && npm run check && npm test`).
**Human follow-up (cannot be done by you):** enable branch protection on `main` requiring the `test` job.

---

## Phase 2 — Security

### 2.1 Upgrade Clerk SDKs (CRITICAL advisory)
Installed: `@clerk/express@1.7.76`, `@clerk/clerk-react@5.61.3`. `npm audit` reports a **critical** advisory on `@clerk/shared` ("middleware-based route protection bypass") and highs on the express/react packages. Upgrade `@clerk/express` and `@clerk/clerk-react` to the latest versions that clear the advisories (bump together; they share `@clerk/shared`).
Integration points to re-verify after the bump:
- `configureClerk()` / `clerkMiddleware()` — `server/auth.ts:437-452`
- `getAuth(req)` and `clerkClient.users.getUser()` — `server/auth.ts:461-470`
- Client: `@clerk/clerk-react` usage in `client/src/lib/auth.ts`, `client/src/pages/Login.tsx`, `Register.tsx`, `Account.tsx`
**Accept:** `npm audit` shows zero Clerk advisories; `npm run check` green; these suites pass: `tests/server/authRoutes.integration.test.ts`, `tests/server/oauthRoutes.integration.test.ts`, `tests/server/systemStatus.integration.test.ts`, plus the full `npm test`.
**Risk note:** if the new `clerkMiddleware()` signature changed, adapt `configureClerk` minimally; do not restructure the auth resolution order (API key → JWT → Clerk).

### 2.2 Upgrade drizzle-orm (SQL injection advisory)
Installed: `drizzle-orm@0.39.3` (high: SQL injection via improperly escaped identifiers). Upgrade `drizzle-orm` (and `drizzle-zod`/`drizzle-kit` if peer ranges require) to the latest version clearing the advisory. The repo uses the better-sqlite3 driver (`server/db.ts:1-2`) and standard query-builder calls — check the drizzle changelog for breaking changes between 0.39 and target before bumping.
**Accept:** `npm audit` shows zero drizzle advisories; full `npm test` green (the integration tests exercise the queries heavily).

### 2.3 Rate limiting
Add `express-rate-limit`. Create `server/rateLimits.ts` exporting three limiters:
- `authLimiter`: 20 requests / 15 min, keyed by IP. Apply to `/api/auth/*` (registered in `server/authRoutes.ts`) and the OAuth token/authorize endpoints (`server/oauthRoutes.ts`).
- `aiLimiter`: 30 requests / min, keyed by `req.user?.userId ?? req.ip`. Apply to the AI-spend routes: chat (`server/chatRoutes.ts`), writing (`server/writingRoutes.ts`, `writingStyleRoutes.ts`), humanizer (`server/humanizerRoutes.ts`), annotation/analysis + uploads (the relevant POSTs in `server/routes.ts` and `server/projectRoutes.ts`), image generation (`server/replit_integrations/image/routes.ts`).
- `globalLimiter`: 600 requests / 15 min backstop, applied app-wide in `server/index.ts` **after** the CORS/body middleware, **excluding** `/healthz` and `/readyz`.
Notes: `app.set("trust proxy", true)` is already set (`server/index.ts:20`), so `req.ip` is correct behind nginx. Use `standardHeaders: true, legacyHeaders: false`. For keyed-by-user limiters, the key generator runs before `requireAuth` populates `req.user` if mounted globally — so mount `aiLimiter` per-route *after* `requireAuth` in the route definitions, not globally.
Add one integration test (`tests/server/rateLimits.integration.test.ts`, modeled on existing integration tests) asserting a 429 after exceeding `authLimiter` and that headers include `RateLimit-*`.
**Accept:** new test passes; full suite green; SSE streaming endpoints still work (limits apply at request start only).

### 2.4 Stop logging response bodies
`server/index.ts:116-134` (`summarizeApiResponse`) serializes up to 2,000 chars of every JSON API response into stdout — that's user documents/drafts going into PM2 logs. Change the request logger to log only `method path status durationMs userId` (userId from `req.user?.userId` if set). Delete `summarizeApiResponse` and the `res.json` monkey-patch (`index.ts:139-145`).
**Accept:** `npm run check` green; manual run of `npm run dev` shows log lines without bodies; `tests/server/appBootstrap.e2e.test.ts` passes.

### 2.5 Externalize hardcoded CORS entries
`server/index.ts:32-37` hardcodes `ALWAYS_ALLOWED_ORIGINS` (claude.ai, scholarmark.ai hosts) and line 56 allows `http://89.167.10.34`. Keep behavior identical by default but source these from env: append entries from a new optional `EXTRA_ALLOWED_ORIGINS` (CSV) env var, and move the raw-IP allowance behind it. Keep `claude.ai`/`claude.com` hardcoded (MCP clients need them unconditionally) but delete the `89.167.10.34` regex line — add a comment in `.env.example` (create it if absent) showing `EXTRA_ALLOWED_ORIGINS=http://89.167.10.34` for the current prod box.
**Accept:** `npm test` green; CORS behavior unchanged when `EXTRA_ALLOWED_ORIGINS` carries the IP.

---

## Phase 3 — Quality infrastructure

### 3.1 ESLint + Prettier
- Add ESLint flat config (`eslint.config.js`): `typescript-eslint` recommended (not type-checked mode — keep it fast), `eslint-plugin-react-hooks` for `client/`, ignores for `dist/`, `node_modules/`, `mcp-server/dist/`, `coverage/`, `chrome-extension/` (plain JS, skip for now).
- Add Prettier with a minimal `.prettierrc` matching current style (2-space indent, double quotes, semicolons, trailing commas where valid — verify against existing files, the codebase is consistent).
- Scripts: `"lint": "eslint ."` and `"format": "prettier --write ."`.
- Run `eslint --fix` and `prettier --write` once; commit the mechanical diff **separately** from the config commit.
- Triage remaining violations: fix trivial ones; for anything requiring logic changes, add a targeted `eslint-disable-next-line` with a `TODO:` comment rather than changing behavior.
- Add `npm run lint` as a step in the CI `test` job.
**Accept:** `npm run lint` exits 0; `npm run check` + `npm test` green; no behavioral diffs (formatting-only).

### 3.2 Split `server/chatRoutes.ts` (1,690 lines)
Extract by responsibility, keeping `chatRoutes.ts` as HTTP wiring only:
- `server/chat/promptBuilder.ts` — system prompt assembly, source formatting, voice/style blocks
- `server/chat/streamProtocol.ts` — SSE event emission, stream tag parsing (`TOOL_REQUEST_REGEX`, `STREAM_TAG_PREFIXES` and friends)
- `server/chat/toolRequests.ts` — `<chunk_request>`/`<context_request>` handling
Move code verbatim where possible; export the same names; update imports in `server/writingRoutes.ts` and anything else importing from `chatRoutes` (check `clipText`, `buildAuthorLabel` — those live in `writingRoutes` and are imported BY chatRoutes, so the dependency direction must not become circular: if extraction creates a cycle, move the shared helpers into `server/chat/shared.ts`).
**Accept:** `chatRoutes.ts` < 600 lines; zero circular imports (`npx madge --circular server/` or manual verification); `tests/server/chatRoutes.integration.test.ts` and full suite pass **unchanged** (do not modify tests).

### 3.3 Split `server/projectRoutes.ts` (1,540 lines)
Same pattern: keep route registration + extract `server/projects/analysisHandlers.ts` (pipeline/multi-prompt processing glue) and `server/projects/documentHandlers.ts` (upload/ingest/document CRUD glue), or a split along whatever seams the file actually presents — read it first and follow its natural sections.
**Accept:** `projectRoutes.ts` < 700 lines; `tests/server/projectRoutes.integration.test.ts` + full suite pass unchanged.

### 3.4 Structured logging
Add `pino`. Create `server/logger.ts` exporting a root logger (JSON in production, `pino-pretty` transport in dev) and `createLogger(module: string)` returning a child logger. Replace the 189 `console.log/error/warn` calls across `server/` mechanically: `console.error(msg, err)` → `logger.error({ err }, msg)`, etc. Replace the `log()` helper in `server/index.ts:105-114` with the pino logger (keep the exported `log` function signature so `server/vite.ts` imports still work, but have it delegate to pino).
Do NOT add Sentry (needs a human-owned DSN — note it in `CODEX-NOTES.md` as a follow-up).
**Accept:** `rg "console\.(log|error|warn)" server/ --type ts` returns zero matches outside tests; full suite green; dev server boots with readable logs.

### 3.5 Consolidate root docs
- Delete `CODEBASE.md`, `CODEBASE_INVENTORY.md`, `CODEBASE_REFERENCE.md` after confirming `ARCHITECTURE.md` covers their load-bearing content; if any section exists ONLY in the deleted files (e.g., a table not in ARCHITECTURE.md), move that section into `ARCHITECTURE.md` first.
- Move `TASK-auth.md`, `TASK-chat.md`, `TASK-citations.md`, `TASK-extension.md`, `TASK-theme.md`, `TASK-writing.md`, and `writing-section-explainer.md` into `changelog/planning/`.
- Update any links to moved/deleted files (`rg` for the filenames across the repo, including `.claude/`).
**Accept:** root contains README, ARCHITECTURE, TEST_STRATEGY, AUDIT, this file; no broken relative links (`rg "CODEBASE_(INVENTORY|REFERENCE)|CODEBASE\.md|TASK-"` shows only changelog/planning and historical mentions).

---

## Phase 4 — Academic UI & typography

Goal: replace the anime theming ("Darling in the Franxx" light / Evangelion-NERV dark) with a quiet academic look. **Key existing bug:** `client/index.html:18` loads only Rajdhani + Share Tech Mono from Google Fonts, while `client/src/index.css:74-76` declares Inter/Merriweather/JetBrains Mono — which therefore never load; body text currently renders system fallbacks.

### 4.1 Fonts
- `npm i @fontsource-variable/source-serif-4 @fontsource-variable/inter @fontsource-variable/jetbrains-mono`
- Import the three in `client/src/main.tsx` (before `index.css`).
- Remove the Google Fonts `<link>` tags and preconnects from `client/index.html:16-18`.
- Update `index.css` font vars: `--font-sans: 'Inter Variable', system-ui, sans-serif; --font-serif: 'Source Serif 4 Variable', Georgia, serif; --font-mono: 'JetBrains Mono Variable', monospace;`
- Delete the dark-mode Rajdhani heading rule (`index.css:237-241`).
**Accept:** `npm run build` succeeds; no `fonts.googleapis.com` references remain (`rg "googleapis" client/`).

### 4.2 Color tokens
Edit only the CSS variables in `client/src/index.css` (the Tailwind config consumes them — don't touch its mappings):
Light mode (`:root`): keep warm-paper `--background`/`--card`; change `--primary: 215 45% 32%` (Oxford blue), `--ring` to match, `--sidebar-primary` and `--sidebar-ring` to match; `--secondary: 215 15% 45%`; charts → `--chart-1: 215 45% 40%` (blue), `--chart-2: 40 65% 50%` (ochre), `--chart-3: 150 25% 40%` (sage), `--chart-4: 350 45% 40%` (burgundy), `--chart-5: 215 10% 55%` (slate).
Dark mode (`.dark`): `--background: 220 10% 10%`, `--card: 220 10% 13%`, borders `220 8% 20%`, `--primary: 40 50% 60%` (desaturated gold), `--ring` to match, sidebar tokens to the same neutral family, muted-foreground `220 8% 65%`.
Verify every foreground/background pair ≥ 4.5:1 contrast (compute, don't eyeball).
Also remove the dead zero-alpha shadow tokens (`index.css:82-89` and the `.dark` copies) — they render nothing.
**Accept:** app renders in both modes with no rose/orange/purple remnants; `npm run build` green.

### 4.3 Strip sci-fi chrome
In `client/src/App.tsx`: remove `BootSequence` (lines 9, 72, 78 — and the `booted` state), `DataTicker` (lines 8, 84), and the `eva-scanlines` class (line 79 — it's defined nowhere in CSS; dead). Delete `client/src/components/BootSequence.tsx` and `DataTicker.tsx`. Remove the `eva` color block from `tailwind.config.ts:84-92` and the `eva-fade-in` keyframes/animation if unused after a `rg "eva-fade-in" client/` check.
**Accept:** `npm run check` green; `rg -i "eva|scanline|BootSequence|DataTicker" client/src/` returns nothing (except any unrelated words); app loads straight to content.

### 4.4 Reading typography
- In `index.css` `@layer base`: keep body at `--font-sans`; add a `.reading-surface` utility: `font-family: var(--font-serif); font-size: 1.0625rem; line-height: 1.7; max-width: 70ch; hyphens: auto; text-rendering: optimizeLegibility;`
- Apply `.reading-surface` (or `prose` + serif) to the document reader body (`client/src/components/DocumentViewer.tsx` / `HighlightedText.tsx` container), the writing pane content (`client/src/components/WritingPane.tsx`), and chat markdown prose (`client/src/components/chat/ChatMessages.tsx` / `markdownConfig.tsx`) — find the outermost text container in each and add the class; do not restructure components.
- Customize the typography plugin once in `tailwind.config.ts` (`theme.extend.typography`) so `prose` uses the serif for body and tightened headings, instead of per-component styles.
**Accept:** reader/writing/chat show serif body text at comfortable measure; UI chrome (sidebar, buttons, tables) stays sans; `npm run build` green.

---

## Phase 5 (optional — only if time remains) — Writing benchmark harness

Implement family 6 ("citation mechanics") of the benchmark described in `AUDIT-2026-06-09.md` §8, inside `.claude/skills/scholarmark-thesis/benchmarks/`:
- `fixtures/citations/records.json`: 10 metadata records (books, journal articles, websites; edge cases: no author, 12 authors, DOI vs URL).
- `expected/citations/{apa7,mla9,chicago-nb}.json`: hand-verified correct strings (generate carefully; these are the answer key — accuracy matters more than coverage, do 10 well).
- `run_citation_bench.py` (match the style of the existing scripts in `scripts/` there): takes a JSONL of model outputs, scores exact-match per style after whitespace normalization, prints a per-style accuracy table.
**Accept:** `python run_citation_bench.py --self-test` validates the answer key parses and a known-good sample scores 100%.

---

## Deferred — do NOT attempt (needs human coordination)

- Versioned DB migrations (replacing `server/db.ts` raw SQL + `ensureColumn`) — touches prod schema; needs a restore-drill rehearsal first.
- Sentry integration — needs a human-owned DSN.
- `sqlite-vec` embedding index, upload streaming to disk — premature at current scale.
- Branch protection, GitHub secrets, deploys.

## Final checklist (verify before finishing)

- [ ] `npm run check` exit 0
- [ ] `npm test` exit 0 (full sequential suite)
- [ ] `npm run lint` exit 0
- [ ] `npm audit --omit=dev` → zero critical/high
- [ ] `npm run build` exit 0
- [ ] No API request/response shape changes
- [ ] One commit per task, messages like `fix(tests): use junction symlinks for Windows compatibility`
- [ ] Anything skipped or discovered → documented in `CODEX-NOTES.md`
