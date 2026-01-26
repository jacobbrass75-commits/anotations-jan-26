# SourceAnnotator - Internal Reference Documentation

This folder contains comprehensive documentation of the SourceAnnotator codebase for development reference. These docs are maintained and updated as the codebase evolves.

## Document Index

| File | Description |
|------|-------------|
| [overview.md](overview.md) | High-level project overview, tech stack, and architecture |
| [database-schema.md](database-schema.md) | Complete database schema with all tables, columns, types, and relationships |
| [server-api.md](server-api.md) | All API endpoints with request/response shapes |
| [server-internals.md](server-internals.md) | Server file-by-file breakdown, AI pipeline, storage layers |
| [client-architecture.md](client-architecture.md) | Frontend pages, components, hooks, routing, and data flow |
| [config-and-setup.md](config-and-setup.md) | Configuration files, build setup, environment variables, npm scripts |

## Quick Reference

- **Dev server**: `npm run dev` (port 5001)
- **Database**: SQLite at `./data/sourceannotator.db`
- **Schema file**: `shared/schema.ts`
- **Path aliases**: `@/` = `client/src/`, `@shared/` = `shared/`
- **AI Model**: `gpt-4o-mini` for analysis, `text-embedding-3-small` for embeddings

## Last Updated

2026-01-26 - Initial documentation generation
