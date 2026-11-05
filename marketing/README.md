# ScholarMark marketing site

Static Astro site for `https://scholarmark.ai`: homepage, guide listing and guide pages.
The product itself stays at `https://app.scholarmark.ai`; every signup, sign-in, pricing,
privacy, terms and support link points there.

This package is standalone. It has its own `package.json` and lockfile, and nothing in the
repo-root app build depends on it.

## Commands

Run from `marketing/` (Node 22.22 or newer):

| Command               | Purpose                                                            |
| --------------------- | ------------------------------------------------------------------ |
| `npm ci`              | Install from the lockfile                                          |
| `npm run dev`         | Local dev server                                                   |
| `npm run build`       | Static build into `dist/`                                          |
| `npm run check`       | `astro check` (types, content schema, templates)                   |
| `npm run verify`      | Build the fixture matrix and check routes, links, SEO and copy     |
| `npm run verify:dist` | Check an existing `dist/` built from the real guides               |

`verify:dist` reads the same environment variables as the build, so run both with the same
settings, for example `SITE_RELEASE_ENV=production npm run build && SITE_RELEASE_ENV=production npm run verify:dist`.

## Release environment

Indexing is opt-in. Set these on the build host (CI or static-host settings). `.env` files
are deliberately not read for them.

| Variable                | Values                                                   | Default       |
| ----------------------- | -------------------------------------------------------- | ------------- |
| `SITE_RELEASE_ENV`      | `production`, `staging`, `preview`, `development`        | `development` |
| `PUBLIC_PRO_PRICE_LIVE` | `true` shows "Pro is $5/month"; anything else hides it   | unset         |

- **production**: `index, follow`, canonical URLs on `https://scholarmark.ai`, full
  `sitemap.xml`, and `robots.txt` that allows crawling and lists the sitemap.
- **anything else**: `noindex, nofollow` on every page, no canonical tags, an empty sitemap,
  `robots.txt` with `Disallow: /`, and `X-Robots-Tag: noindex` in `_headers`.
- If the host reports a preview build (`VERCEL_ENV=preview|development`, or Netlify
  `CONTEXT=deploy-preview|branch-deploy`), the build stays non-indexable even when
  `SITE_RELEASE_ENV=production` is set. Cloudflare Pages doesn't expose an equivalent, so
  set `SITE_RELEASE_ENV=production` only on the production branch there.

Until `PUBLIC_PRO_PRICE_LIVE=true`, the site quotes no dollar amounts and links to the live
app pricing page, which currently charges $14 for Pro.

## Signup flow and attribution

Signup CTAs go to the same URL the current landing page uses:
`https://app.scholarmark.ai/sign-up?redirect_url=/pricing?onboarding=1&source=summer`.

`src/scripts/attribution.ts` copies `utm_*` and `fbclid` from the landing URL onto signup
links (kept in `sessionStorage` for the visit), and adds `embedded_auth=1` in Instagram and
Facebook in-app browsers, matching `buildAttributedSignupUrl` in the app. The marketing site
itself loads no analytics, pixels or third-party resources (fonts are self-hosted), sets no
cookies, and its client script sends nothing anywhere, so it needs no consent banner. The app's consent-gated Meta measurement
takes over after signup.

## Writing guides

Guides are Markdown or MDX files directly in `src/content/guides/`. The file name becomes the
URL, so `organize-research-sources.md` publishes at `/guides/organize-research-sources/`.
Use lowercase, hyphenated file names; subfolders aren't supported.

Required frontmatter:

```yaml
---
title: "Under 120 characters"
description: "Under 300 characters, used for the meta description and cards"
category: "Citation guides"
published: "2026-11-05"
updated: "2026-11-20" # optional, must not be earlier than published
---
```

The build fails if a field is missing or a date isn't a real `YYYY-MM-DD` date. Quoted and
unquoted dates both work.

When guides are built, links are normalized: `/guides/foo` and `https://scholarmark.ai/guides/foo`
become `/guides/foo/`, and a bare `https://app.scholarmark.ai/sign-up` link gets the onboarding
redirect and campaign forwarding. External links in guide prose are allowed.
`npm run verify:dist` reports links to guides that don't exist yet.

## Layout

```
src/
  config/release.ts       release environment, origins, price flag
  content.config.ts       guides collection schema
  layouts/BaseLayout.astro  head/SEO, header, footer, skip link
  components/             Button, Logo, SiteHeader, SiteFooter, CtaBand, GuideCard,
                          WorkspaceIllustration (HTML/CSS, labeled as an illustration)
  lib/                    links, guide helpers, rehype link normalizer
  pages/                  index, guides/, guides/[slug]/, 404, robots.txt, sitemap.xml
  styles/global.css       design tokens and shared primitives
scripts/verify.mjs        route and link verification
tests/fixtures/           fixture guides used only by `npm run verify`
```
