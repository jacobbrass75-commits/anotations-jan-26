# ScholarMark Production Release Checklist

## Local verification

```bash
npm run check
npm run test
CLERK_ALLOW_TEST_KEYS_IN_PRODUCTION=true \
VITE_CLERK_PUBLISHABLE_KEY=pk_test_local \
CLERK_SECRET_KEY=sk_test_local \
npm run build
npm run extension:package
```

## Pre-deploy

- Confirm the target ref/commit.
- Confirm production `.env` has live Clerk keys, AI provider keys, `JWT_SECRET`, `APP_BASE_URL`, `ALLOWED_ORIGINS`, `ADMIN_USER_IDS`, and `MCP_RESOURCE_URL`.
- Confirm `CHROME_EXTENSION_IDS` is set after the Chrome extension is published. Until then, set `EXTENSION_CORS_MODE=disabled` so extension origins are denied explicitly.
- Confirm the backup timer is active or run `deploy/backup-data.sh` manually.
- Confirm the rollback target is known.

## Deploy

```bash
APP_REF=origin/master bash deploy/deploy-prod.sh
```

The remote refresh script performs a pre-deploy backup, dependency install, schema bootstrap, build, PM2 reload, readiness checks, and `scripts/smoke-prod.mjs`.

## Post-deploy smoke

```bash
APP_BASE_URL=https://app.scholarmark.ai \
MCP_BASE_URL=https://mcp.scholarmark.ai \
npm run smoke:prod
```

Manually verify sign-in, upload, project analysis, chat, writing, web clips, extension auth, admin analytics, and MCP connection from Claude.

## Rollback

Use [ROLLBACK.md](./ROLLBACK.md) if health checks fail or a release causes production regressions.
