import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "./auth";
import { requireAdmin } from "./analyticsRoutes";
import { sqlite } from "./db";
import { createLogger } from "./logger";

const logger = createLogger("siteAnalyticsRoutes");

const pageViewSchema = z.object({
  visitorId: z.string().min(8).max(100),
  sessionId: z.string().min(8).max(100),
  path: z.string().min(1).max(500).startsWith("/"),
  referrer: z.string().max(1000).optional().nullable(),
  utmSource: z.string().max(100).optional().nullable(),
  utmMedium: z.string().max(100).optional().nullable(),
  utmCampaign: z.string().max(200).optional().nullable(),
  utmContent: z.string().max(200).optional().nullable(),
});

function referrerHost(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().slice(0, 255);
  } catch {
    return null;
  }
}

function epoch(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

export function registerSiteAnalyticsRoutes(app: Express): void {
  app.post("/api/site-analytics/page-view", (req: Request, res: Response) => {
    const parsed = pageViewSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid page view" });

    const view = parsed.data;
    sqlite
      .prepare(`INSERT INTO site_page_views (
        id, visitor_id, session_id, path, referrer, referrer_host,
        utm_source, utm_medium, utm_campaign, utm_content, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        randomUUID(), view.visitorId, view.sessionId, view.path,
        view.referrer || null, referrerHost(view.referrer), view.utmSource || null,
        view.utmMedium || null, view.utmCampaign || null, view.utmContent || null, Date.now(),
      );
    return res.status(204).end();
  });

  app.get(
    "/api/admin/site-analytics",
    requireAuth,
    requireAdmin,
    (req: Request, res: Response) => {
      try {
        const now = Date.now();
        const from = epoch(req.query.from, now - 7 * 86_400_000);
        const to = epoch(req.query.to, now);
        if (from > to) return res.status(400).json({ message: "Invalid time range" });

        const totals = sqlite.prepare(`SELECT COUNT(*) AS page_views,
          COUNT(DISTINCT visitor_id) AS unique_visitors,
          COUNT(DISTINCT session_id) AS sessions
          FROM site_page_views WHERE created_at BETWEEN ? AND ?`).get(from, to);
        const sources = sqlite.prepare(`SELECT
          COALESCE(NULLIF(utm_source, ''), NULLIF(referrer_host, ''), 'direct') AS source,
          COUNT(*) AS page_views, COUNT(DISTINCT visitor_id) AS unique_visitors
          FROM site_page_views WHERE created_at BETWEEN ? AND ?
          GROUP BY source ORDER BY page_views DESC LIMIT 20`).all(from, to);
        const pages = sqlite.prepare(`SELECT path, COUNT(*) AS page_views,
          COUNT(DISTINCT visitor_id) AS unique_visitors
          FROM site_page_views WHERE created_at BETWEEN ? AND ?
          GROUP BY path ORDER BY page_views DESC LIMIT 20`).all(from, to);
        const campaigns = sqlite.prepare(`SELECT utm_campaign AS campaign,
          COALESCE(utm_source, 'unknown') AS source, COUNT(*) AS page_views,
          COUNT(DISTINCT visitor_id) AS unique_visitors
          FROM site_page_views WHERE created_at BETWEEN ? AND ? AND utm_campaign IS NOT NULL
          GROUP BY utm_campaign, utm_source ORDER BY page_views DESC LIMIT 20`).all(from, to);

        return res.json({ period: { from, to }, totals, sources, pages, campaigns });
      } catch (error) {
        logger.error({ err: error }, "Site analytics query failed");
        return res.status(500).json({ message: "Failed to fetch site analytics" });
      }
    },
  );
}
