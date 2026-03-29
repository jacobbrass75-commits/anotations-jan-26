# ScholarMark Test Strategy

Last updated 2026-03-26.

## Goal

Move the repo from ad hoc manual validation to a production-gating test pyramid:

- fast unit coverage for pure logic
- integration coverage for routes, storage, auth, and queue behavior
- end-to-end coverage for the main research workflows
- provider contract checks for Anthropic, OpenAI, Gemini, Clerk, and MCP

## Current State

There was no first-class automated test runner configured in this repo before this pass.

This update adds:

- Vitest as the baseline runner
- sequential Vitest orchestration to avoid the repo's multi-file worker crash path
- merged V8 coverage reporting across isolated per-file runs
- route-level integration tests for auth and extension compatibility flows
- a full-process app bootstrap smoke test that exercises the real server over HTTP from an isolated data directory
- an initial set of unit and integration-style tests for pure logic and database bootstrap behavior

That is a starting point, not production-ready coverage.

### Baseline executed in this pass

- `npm test`: 29 tests passed across 11 suites
- `npm run test:coverage`:
  - lines: 6.14%
  - statements: 6.02%
  - functions: 5.65%
  - branches: 3.86%

Covered modules today:

- `shared/annotationLinks.ts`
- `client/src/lib/documentExportUtils.ts`
- `server/auth.ts`
- `server/authRoutes.ts`
- `server/quoteJumpLinks.ts`
- `server/chunker.ts`
- `server/citationGenerator.ts`
- `server/sourceFiles.ts`
- `server/db.ts`
- `server/extensionRoutes.ts`
- `server/humanizer.ts`

The baseline also surfaced and fixed a real defect in `server/chunker.ts` where overlap plus
sentence-boundary snapping could stop forward progress and spin forever.

The new full-process smoke test also surfaced two production-relevant environment constraints:

- the app cannot serve even public routes without syntactically valid Clerk keys in the environment
- booting against the repo's current live `data/` snapshot can fail before startup if the local SQLite shape is behind what `server/db.ts` assumes

## Feature Coverage Matrix

| Area | Current automated status | Next requirement before production |
| --- | --- | --- |
| Auth and API-key lifecycle | Partially covered | Add Clerk-session and route-ownership coverage |
| Database bootstrap and support tables | Baseline covered | Add migration/backward-compatibility tests against fixture DB snapshots |
| Shared URL/jump-link helpers | Covered | Keep as unit coverage |
| Markdown export and citation formatting utilities | Covered | Keep as unit coverage |
| Humanizer validation and provider fallback | Covered at logic level | Add live provider contract smoke tests |
| File source persistence | Covered | Add API-level upload/source retrieval tests |
| Extension compatibility save endpoint | Partially covered | Add project-ownership and persistence error-path tests |
| Document upload and OCR modes | Not yet covered end-to-end | Add route tests plus fixture PDFs, images, HEIC, and ZIP bundles |
| Single-document annotation pipeline | Not yet covered end-to-end | Add deterministic pipeline tests with provider mocks and result fixtures |
| Project CRUD, folders, templates, and project docs | Not yet covered | Add API integration suite with isolated SQLite fixtures |
| Project search and citation endpoints | Not yet covered | Add ranking and formatting contract tests |
| Chat conversations and SSE streaming | Not yet covered | Add mocked Anthropic stream integration tests |
| Compile and verify workflows | Not yet covered | Add source-grounding and SSE contract tests |
| Writing pipeline (`/api/write`) | Not yet covered | Add SSE integration tests and generated-paper persistence tests |
| Web clips and extension compatibility | Partially covered | Add first-party web clip CRUD and promotion tests |
| OAuth and MCP token lifecycle | Not yet covered | Add auth-code, token, revoke, and MCP transport smoke tests |
| Admin analytics | Not yet covered | Add analytics fixture DB tests and authorization tests |
| Full app bootstrap and public route shell | Smoke covered | Add browser E2E interactions and authenticated page coverage |
| Frontend page workflows | Not yet covered beyond shell smoke | Add React Testing Library and Playwright happy-path coverage |

## Test Layers

### 1. Unit tests

Use for:

- string and markdown transforms
- citation formatting
- URL and jump-link helpers
- chunking logic
- humanizer validation and fallback behavior
- file path and MIME inference

These should stay fast and deterministic.

### 2. Integration tests

Use for:

- storage layers against isolated SQLite databases
- route handlers with mocked auth and providers
- OCR queue state transitions
- conversation/message persistence
- analytics queries
- OAuth token issuance and revocation

This layer should become the main regression barrier for backend behavior.

### 3. End-to-end tests

Use for real user flows:

- sign in and land on dashboard
- upload a document and wait for readiness
- analyze a document and create/edit/delete annotations
- create a project, attach sources, and run multi-prompt analysis
- use writing workspace, compile, and verify
- save and promote a web clip
- connect the extension and save a clip
- call the MCP server with a valid OAuth token

This should be Playwright-based and run against seeded local fixtures.

### 4. Provider contract tests

Run on a smaller schedule with real credentials:

- Anthropic streaming and tool-use response shape
- OpenAI embeddings and vision OCR request compatibility
- Gemini humanizer response shape
- Clerk session resolution
- MCP initialization and streamable transport negotiation

These are essential because large parts of the app are orchestration around third-party APIs.

## Production Gates

Before calling the product production-ready, the release pipeline should enforce:

1. `npm run check`
2. `npm run test`
3. `npm run test:coverage`
4. backend integration suite against isolated SQLite fixtures
5. Playwright happy-path suite across dashboard, projects, document analysis, writing, and web clips
6. OAuth + MCP smoke tests
7. provider contract smoke tests behind protected credentials

## Minimum Coverage Target

Use these targets after the integration and E2E layers exist:

- 85% line coverage on `shared/` and pure utilities
- 75% line coverage on `server/` business logic
- 60% line coverage on `client/src/` feature components and hooks
- 100% coverage for release-critical flows through E2E or integration tests:
  upload, analyze, annotate, cite, write, compile, verify, clip, and MCP auth

## Immediate Gaps

The highest-value untested risks right now are:

- Clerk and tier enforcement behavior
- multi-provider OCR execution
- project route correctness
- Anthropic streaming in chat/compile/verify
- writing pipeline persistence and source selection
- extension-to-backend and MCP-to-backend contracts
- frontend asset correctness after the HTML shell loads in dev/prod

## New Project-Specific Subagents

This repo already had generic architecture and testing agents under `.claude/agents/`.
This pass adds project-specific variants for faster future work:

- `scholarmark-doc-maintainer`
- `scholarmark-test-planner`

Use them when the work is specifically about this codebase rather than generic review/testing.
