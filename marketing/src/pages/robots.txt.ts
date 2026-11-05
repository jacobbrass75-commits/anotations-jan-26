import type { APIRoute } from "astro";
import { SITE_ORIGIN, indexable } from "../config/release";

/**
 * Production allows crawling and points at the sitemap. Every other release
 * (staging, preview, development) blocks crawlers outright.
 */
export const GET: APIRoute = () => {
  const body = indexable
    ? ["User-agent: *", "Allow: /", "", `Sitemap: ${SITE_ORIGIN}/sitemap.xml`, ""]
    : ["User-agent: *", "Disallow: /", ""];

  return new Response(body.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
