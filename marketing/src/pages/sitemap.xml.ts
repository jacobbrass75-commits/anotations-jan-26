import type { APIRoute } from "astro";
import { SITE_ORIGIN, indexable } from "../config/release";
import { getGuides, guidePath, lastChanged } from "../lib/guides";

interface SitemapEntry {
  path: string;
  lastmod?: string;
}

const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Lists indexable pages only. Non-production releases publish an empty sitemap. */
export const GET: APIRoute = async () => {
  const guides = await getGuides();
  const newest = guides[0] ? lastChanged(guides[0]) : undefined;

  const entries: SitemapEntry[] = indexable
    ? [
        { path: "/" },
        { path: "/guides/", lastmod: newest },
        ...guides.map((guide) => ({ path: guidePath(guide), lastmod: lastChanged(guide) })),
      ]
    : [];

  const urls = entries.map((entry) =>
    [
      "  <url>",
      `    <loc>${escapeXml(new URL(entry.path, SITE_ORIGIN).toString())}</loc>`,
      entry.lastmod ? `    <lastmod>${entry.lastmod}</lastmod>` : null,
      "  </url>",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
