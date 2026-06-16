# ScholarMark

ScholarMark is a research and writing workspace for students, researchers, and writers. It helps users collect sources, annotate evidence, generate citations, clip web material, and draft or verify academic writing with AI assistance.

## Deployable Surfaces

This repository contains four deployable surfaces:

- `client/` - React/Vite web app.
- `server/` - Express API, auth, document processing, AI workflows, and production static serving.
- `chrome-extension/` - Chrome extension for clipping and saving web research.
- `mcp-server/` - Standalone MCP resource server.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system map.

## Prerequisites

- Node.js 20 or newer.
- npm, included with Node.
- A local `.env` file for provider credentials and runtime settings.

Production configuration is validated by [server/productionConfig.ts](server/productionConfig.ts). At minimum, local and production work commonly need:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- Clerk publishable and secret keys (`VITE_CLERK_PUBLISHABLE_KEY` or `CLERK_PUBLISHABLE_KEY`, plus `CLERK_SECRET_KEY`)
- Stripe billing keys (`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`) when card subscriptions are enabled. Stripe prices are resolved by the lookup keys `scholarmark_pro_monthly` and `scholarmark_max_monthly` unless `STRIPE_PRO_PRICE_ID` and `STRIPE_MAX_PRICE_ID` are set.

Production also validates additional settings such as `JWT_SECRET`, public app origins, Chrome extension IDs, and MCP URLs. Treat `server/productionConfig.ts` as the authoritative list.

## Setup

Install dependencies:

```bash
npm install
```

Initialize or update the local database schema:

```bash
npm run db:push
```

Start local development:

```bash
npm run dev
```

The web app is served by the Express/Vite development server.

## Commands

| Command               | Purpose                                                   |
| --------------------- | --------------------------------------------------------- |
| `npm run dev`         | Start the local development server.                       |
| `npm run build`       | Build the client, server, and deployable artifacts.       |
| `npm run check`       | Run TypeScript type checking.                             |
| `npm test`            | Run the sequential Vitest suite.                          |
| `npm run smoke:local` | Smoke-check a running local app with MCP checks disabled. |

## Operations

Deployment, rollback, backups, release checks, and host hardening live under [deploy/](deploy/). Start with [deploy/RELEASE.md](deploy/RELEASE.md), [deploy/ROLLBACK.md](deploy/ROLLBACK.md), and [deploy/BACKUPS.md](deploy/BACKUPS.md) rather than duplicating those procedures here.

For testing strategy and coverage expectations, see [TEST_STRATEGY.md](TEST_STRATEGY.md).
