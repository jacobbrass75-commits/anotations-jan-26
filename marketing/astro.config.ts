import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { unified } from "@astrojs/markdown-remark";
import mdx from "@astrojs/mdx";
import { defineConfig } from "astro/config";
import type { AstroIntegration } from "astro";
import { SITE_ORIGIN, guidesFixtureDir, indexable, releaseEnv } from "./src/config/release";
import rehypeSiteLinks from "./src/lib/rehypeSiteLinks";

/**
 * Writes a `_headers` file understood by Cloudflare Pages and Netlify. Non-production
 * builds carry X-Robots-Tag so a staging or preview host stays out of search indexes
 * even when a crawler ignores the meta tag.
 */
function staticHostHeaders(): AstroIntegration {
  return {
    name: "scholarmark-static-headers",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        const pageHeaders = [
          "  X-Content-Type-Options: nosniff",
          "  Referrer-Policy: strict-origin-when-cross-origin",
          "  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()",
          "  Content-Security-Policy: frame-ancestors 'none'",
        ];
        if (!indexable) pageHeaders.push("  X-Robots-Tag: noindex, nofollow");

        const body = [
          "/*",
          ...pageHeaders,
          "",
          "/_astro/*",
          "  Cache-Control: public, max-age=31536000, immutable",
          "",
        ].join("\n");

        await writeFile(fileURLToPath(new URL("_headers", dir)), body, "utf8");
        logger.info(`release=${releaseEnv} indexable=${indexable}`);
      },
    },
  };
}

export default defineConfig({
  site: SITE_ORIGIN,
  output: "static",
  ...(guidesFixtureDir ? { cacheDir: "./node_modules/.astro-verify" } : {}),
  trailingSlash: "always",
  build: {
    format: "directory",
  },
  // Astro 7 defaults to JSX whitespace rules; keep HTML-aware compression so inline spacing is unchanged.
  compressHTML: true,
  // Guide links are normalized by the unified processor; .mdx inherits it from markdown.processor.
  markdown: {
    processor: unified({ rehypePlugins: [rehypeSiteLinks] }),
  },
  integrations: [mdx(), staticHostHeaders()],
  vite: {
    // Keep the repo-root Tailwind PostCSS config from being picked up by this site.
    css: { postcss: { plugins: [] } },
  },
  devToolbar: {
    enabled: false,
  },
});
