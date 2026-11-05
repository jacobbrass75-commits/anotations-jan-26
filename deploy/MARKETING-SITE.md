# Astro Marketing Site on scholarmark.ai

The static Astro site in `marketing/` is served by the existing Express app, on the
marketing host only, behind an explicit opt-in. With the switch off, the app behaves
exactly as before.

## Switch

| Variable                              | Values                                                                                       | Read by                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `SCHOLARMARK_MARKETING_SITE`          | `astro` enables, anything else (default `spa`) disables                                      | `scripts/build.ts`, server startup, `scripts/smoke-prod.mjs` |
| `SITE_RELEASE_ENV`                    | `production` makes the Astro build indexable; `staging`/`preview` builds are `noindex`       | Astro build (forwarded by `scripts/build.ts`)                |
| `SCHOLARMARK_MARKETING_PREVIEW_HOSTS` | Optional comma list of extra hosts treated as the marketing host (QA only, e.g. `localhost`) | server startup                                               |

Set these in `/opt/app/.env` only. Do not export them in the deploy shell: PM2 keeps
exported variables, and dotenv never overrides an existing one.

## What is served

On `scholarmark.ai` (`www` and HTTP are still 308-canonicalized first):

| Path                                                                                                | Served by                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                                                                                 | Astro, except paid Instagram UTMs, `ref`, `code`, `invite`, `sm_landing`, `sm_direct_signup`, `embedded_auth`, or a signed-in Clerk browser (`__client_uat`). Those keep the SPA landing.                                                                                    |
| `/guides`, `/guides/*`                                                                              | Astro. The canonical trailing-slash form is enforced with a 308 redirect; unknown guides return the Astro 404.                                                                                                                                                               |
| `/_astro/*`                                                                                         | Astro hashed assets on any host, `immutable`, and a 404 (never SPA HTML) on a miss.                                                                                                                                                                                          |
| `/robots.txt`, `/sitemap.xml`                                                                       | Composed by the server. Indexable release: app-private paths disallowed, Astro sitemap plus legacy public SPA pages (`/pricing`, `/faq`, `/blog`, `/blog/*`, `/privacy`, `/terms`, `/support`). Non-indexable release: Astro's blocking robots and empty sitemap, unchanged. |
| other Astro root files (e.g. `/og/*.png`)                                                           | Astro, if the SPA build has no file with the same path.                                                                                                                                                                                                                      |
| everything else (`/blog`, `/pricing`, `/start`, `/summer`, `/invite`, `/sign-*`, `/api`, OAuth/MCP) | Unchanged SPA/API behavior.                                                                                                                                                                                                                                                  |

On `app.scholarmark.ai`, `/guides/*` 308-redirects to `https://scholarmark.ai/guides/*`;
nothing else changes.

The build output is indexed once at startup, and requests are looked up in that index
by exact path. A request path is never joined to the filesystem. Dotfiles, symlinks,
`_headers`/`_redirects`, and Astro HTML pages outside `/` and `/guides` are not served;
the server logs any ignored pages. Rules in Astro's `_headers` file apply to marketing
responses, but the server keeps control of `Cache-Control`, so HTML is always `no-store`.

## Build and deploy

`deploy/refresh-prod.sh` needs no changes. It runs the root `npm ci`, then
`npm run build`, which loads `/opt/app/.env`. When `SCHOLARMARK_MARKETING_SITE=astro`,
`scripts/build.ts`:

1. Checks `marketing/package.json`, `marketing/package-lock.json`, and the Node version
   against `engines.node` (currently `>=22.12.0`).
2. Runs `npm ci` in `marketing/`, after the root install, never in parallel. It is
   skipped when the lockfile and Node version match the previous install.
3. Runs `npm run build` in `marketing/` with a scrubbed environment: system variables,
   `SITE_RELEASE_ENV`, and `PUBLIC_*` only. No app secrets reach the static build.
4. Builds the SPA and server as before, then swaps the output into `dist/marketing`
   atomically. Hashed `_astro` files from the previous build are kept for 7 days.

A marketing build failure aborts before `dist/` changes, so PM2 keeps the running release.
With the switch off, the Astro install and build are skipped entirely.

## Production switch

Preconditions: `node -v` on the server is at least 22.12, and `marketing/` (including
`package-lock.json`) is on the deployed ref.

```bash
# /opt/app/.env
SCHOLARMARK_MARKETING_SITE=astro
SITE_RELEASE_ENV=production
```

```bash
APP_REF=origin/master bash deploy/deploy-prod.sh
```

The deploy smoke (`scripts/smoke-prod.mjs`) reads `.env`. With the switch on, it also
checks the marketing root, the paid Instagram landing, `/blog`, `/pricing`, robots,
sitemap, and the `_astro` 404. To check through the public proxy afterwards:

```bash
APP_BASE_URL=https://app.scholarmark.ai MARKETING_BASE_URL=https://scholarmark.ai \
SCHOLARMARK_MARKETING_SITE=astro npm run smoke:prod
curl -sI https://scholarmark.ai/ | grep -i x-scholarmark-surface   # marketing
```

## Staging QA

Production cannot preview the Astro root without flipping it, so QA runs on a local
production build. `npm start` enforces the production config check, so use the same local
placeholder environment as [RELEASE.md](./RELEASE.md) (test Clerk keys with
`CLERK_ALLOW_TEST_KEYS_IN_PRODUCTION=true`, plus non-secret placeholder provider values).
Never copy production credentials to a workstation.

```bash
SCHOLARMARK_MARKETING_SITE=astro SITE_RELEASE_ENV=staging npm run build
NODE_ENV=production SCHOLARMARK_MARKETING_SITE=astro \
SCHOLARMARK_MARKETING_PREVIEW_HOSTS=localhost npm start
```

1. Browse `http://localhost:5001/`, `/guides/`, and a guide. Confirm `X-Robots-Tag: noindex`
   and a blocking `/robots.txt` (the staging gate).
2. Confirm SPA paths still work: `/?utm_source=ig&utm_medium=paid`, `/?ref=test`, `/blog`,
   `/pricing`, `/start`, `/sign-up`.
3. Run `APP_BASE_URL=http://127.0.0.1:5001 SCHOLARMARK_MARKETING_SITE=astro npm run smoke:local`.
   This uses marketing-host forwarding headers, so it exercises the real `scholarmark.ai`
   branch.
4. Rebuild with `SITE_RELEASE_ENV=production` and confirm `/sitemap.xml` lists the guides
   plus `/blog/*`, and `/robots.txt` points to it.

After the production flip, check from a phone that a paid Instagram ad URL still opens
the SPA landing in the Instagram in-app browser.

## Rollback

Fast path (no rebuild; the SPA build is always produced):

```bash
# /opt/app/.env
SCHOLARMARK_MARKETING_SITE=spa
```

```bash
sudo -H -u deploy pm2 reload sourceannotator --update-env
curl -sI https://scholarmark.ai/ | grep -i x-scholarmark-surface   # expect no output
```

With the switch off, the marketing middleware is never mounted, so behavior matches the
pre-integration app. If the switch is on but `dist/marketing` is missing or unreadable,
the server logs an error and serves the SPA root anyway. For a code-level rollback,
follow [ROLLBACK.md](./ROLLBACK.md). A later deploy rebuilds Astro only if the switch is
`astro` again.
