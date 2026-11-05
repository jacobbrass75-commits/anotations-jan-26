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
- If the Astro marketing site should be live, confirm `.env` has `SCHOLARMARK_MARKETING_SITE=astro`
  and `SITE_RELEASE_ENV=production` and the server runs Node 22.12+. See
  [MARKETING-SITE.md](./MARKETING-SITE.md). Leave it unset (or `spa`) to keep the SPA root.
  If the system Node is older (production is 20.20), point the marketing build at the
  standalone Node 22 instead of upgrading the system Node. The exact `/opt/app/.env` flags:

  ```bash
  SCHOLARMARK_MARKETING_SITE=astro
  SITE_RELEASE_ENV=production
  PUBLIC_PRO_PRICE_LIVE=true
  SCHOLARMARK_MARKETING_NODE_PATH=/opt/app/.tools/node-v22.22.0-linux-x64/bin/node
  ```

  `scripts/build.ts` runs that binary's bundled `npm-cli.js` and puts its directory first on
  the marketing build's `PATH`, so Astro runs on it too. The app and PM2 keep the system
  Node. The build log prints `marketing: using Node v22.22.0 (...)`. An unset
  `SITE_RELEASE_ENV` builds as `staging` (noindex), and the smoke then fails on the guides
  sitemap/canonical check. Leave `SCHOLARMARK_MARKETING_NODE_PATH` unset on Windows and dev
  machines that already run Node 22.12+.
- If Meta tracking is enabled, confirm the Pixel ID, Conversions API token, allowed origins, and
  consent banner in production. Use `META_TEST_EVENT_CODE` only while validating Events Manager,
  then remove it.

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
