import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { unified } from "@astrojs/markdown-remark";
import mdx from "@astrojs/mdx";
import { defineConfig } from "astro/config";
import type { AstroIntegration } from "astro";
import { SITE_ORIGIN, guidesFixtureDir, indexable, releaseEnv } from "./src/config/release";
import rehypeSiteLinks from "./src/lib/rehypeSiteLinks";
import { SKILL_DOWNLOAD_GUIDE, skillDownloadPath, skillZipName } from "./src/lib/skillDownload";
import { buildClaudeSkill } from "../integrations/scholarmark-plugin/tools/claude-skill.mjs";

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

/**
 * Builds the native Claude skill ZIP from the canonical skill in
 * ../integrations/scholarmark-plugin and writes it to downloads/. Nothing is checked in:
 * every build regenerates the same bytes. A real build fails if the guide doesn't link to
 * that exact file. The Express handler serves it on the canonical host only.
 */
function skillDownload(): AstroIntegration {
  let root: URL | undefined;
  return {
    name: "scholarmark-skill-download",
    hooks: {
      "astro:config:setup": ({ config }) => {
        root = config.root;
      },
      "astro:build:done": async ({ dir, logger }) => {
        if (!root) throw new Error("skill download: project root is unknown");
        const plugins = new URL("../integrations/scholarmark-plugin/", root);
        const skill = buildClaudeSkill(
          fileURLToPath(new URL("plugin/", plugins)),
          fileURLToPath(new URL("skills-only/", plugins)),
        );
        if (skill.fileName !== skillZipName) {
          throw new Error(
            `skill download: built ${skill.fileName}, but the guide links ${skillZipName}`,
          );
        }
        const downloads = new URL("downloads/", dir);
        await mkdir(downloads, { recursive: true });
        await writeFile(new URL(skill.fileName, downloads), skill.zip);
        if (!guidesFixtureDir) {
          const guide = await readFile(
            new URL(`guides/${SKILL_DOWNLOAD_GUIDE}/index.html`, dir),
            "utf8",
          );
          if (!guide.includes(`href="${skillDownloadPath}"`)) {
            throw new Error(
              `skill download: /guides/${SKILL_DOWNLOAD_GUIDE}/ does not link ${skillDownloadPath}`,
            );
          }
        }
        logger.info(`wrote ${skillDownloadPath.slice(1)} (${skill.zip.length} bytes)`);
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
  integrations: [mdx(), staticHostHeaders(), skillDownload()],
  vite: {
    // Keep the repo-root Tailwind PostCSS config from being picked up by this site.
    css: { postcss: { plugins: [] } },
  },
  devToolbar: {
    enabled: false,
  },
});
