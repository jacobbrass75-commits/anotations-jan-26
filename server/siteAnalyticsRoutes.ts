import { randomUUID } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { optionalAuth, requireAuth } from "./auth";
import { requireAdmin } from "./analyticsRoutes";
import { sqlite } from "./db";
import { createLogger } from "./logger";
import { getUserById } from "./authStorage";
import {
  isMetaConversionsConfigured,
  isRecentMetaRegistration,
  sendMetaConversion,
} from "./metaConversions";

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

const FUNNEL_EVENTS = [
  "landing_view",
  "engaged_10_seconds",
  "scroll_50_percent",
  "primary_cta_click",
  "pricing_view",
  "signup_started",
  "signup_details_submitted",
  "signup_verification_sent",
  "signup_verification_succeeded",
  "signup_completed",
  "checkout_started",
  "purchase_completed",
  "first_project_created",
] as const;

const SITE_EVENTS = [...FUNNEL_EVENTS, "signup_hosted_fallback"] as const;

const siteEventSchema = pageViewSchema.extend({
  eventName: z.enum(SITE_EVENTS),
  clientTimestamp: z.number().int().positive().optional().nullable(),
  ctaOrFeature: z.string().max(200).optional().nullable(),
  deviceCategory: z.enum(["mobile", "tablet", "desktop", "unknown"]),
  viewportWidth: z.number().int().min(0).max(10_000).optional().nullable(),
  viewportHeight: z.number().int().min(0).max(10_000).optional().nullable(),
  metaEventId: z
    .string()
    .min(8)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional()
    .nullable(),
  marketingConsent: z.boolean().optional().default(false),
  eventSourceUrl: z.string().url().max(1000).optional().nullable(),
  fbp: z.string().max(500).optional().nullable(),
  fbc: z.string().max(500).optional().nullable(),
  value: z.number().min(0).max(1_000_000).optional().nullable(),
  currency: z.string().length(3).optional().nullable(),
});

function referrerHost(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().slice(0, 255);
  } catch {
    return null;
  }
}

function safeReferrer(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.slice(0, 1000);
  } catch {
    return null;
  }
}

function epoch(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

export function registerSiteAnalyticsRoutes(app: Express): void {
  const optionalRegistrationAuth = (req: Request, res: Response, next: NextFunction) => {
    if (req.body?.eventName === "signup_completed") {
      void optionalAuth(req, res, next);
      return;
    }
    next();
  };

  app.post(
    "/api/site-analytics/event",
    optionalRegistrationAuth,
    async (req: Request, res: Response) => {
      const parsed = siteEventSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid analytics event" });

      try {
        const event = parsed.data;
        let authoritativeRegistration = event.eventName !== "signup_completed";
        let eventUserId: string | null = null;
        if (event.eventName === "signup_completed" && req.user?.userId) {
          const user = await getUserById(req.user.userId);
          authoritativeRegistration =
            req.user.authType === "clerk" &&
            req.user.authEmailVerified === true &&
            isRecentMetaRegistration(req.user.authCreatedAt) &&
            user?.emailVerified === true;
          if (authoritativeRegistration) eventUserId = user!.id;
        }

        // A completion is a business conversion, not a client assertion. Do
        // not persist it unless the request belongs to a newly-created,
        // verified local account.
        if (!authoritativeRegistration) return res.status(204).end();

        const inserted = sqlite
          .prepare(
            `INSERT OR IGNORE INTO site_events (
        id, event_name, user_id, visitor_id, session_id, path, referrer_host,
        utm_source, utm_medium, utm_campaign, utm_content, cta_or_feature,
        device_category, viewport_width, viewport_height, client_timestamp, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            event.eventName,
            eventUserId,
            event.visitorId,
            event.sessionId,
            event.path,
            referrerHost(event.referrer),
            event.utmSource || null,
            event.utmMedium || null,
            event.utmCampaign || null,
            event.utmContent || null,
            event.ctaOrFeature || null,
            event.deviceCategory,
            event.viewportWidth ?? null,
            event.viewportHeight ?? null,
            event.clientTimestamp ?? null,
            Date.now(),
          );
        if (inserted.changes === 0) return res.status(204).end();
        const shouldForwardToMeta =
          event.marketingConsent &&
          authoritativeRegistration &&
          Boolean(event.metaEventId && event.eventSourceUrl) &&
          !["internal_verification", "deployment_test"].includes(event.utmSource || "") &&
          isMetaConversionsConfigured();

        if (shouldForwardToMeta) {
          void sendMetaConversion({
            siteEventName: event.eventName,
            eventId: event.metaEventId!,
            eventTimeMs: event.clientTimestamp,
            eventSourceUrl: event.eventSourceUrl!,
            visitorId: event.visitorId,
            email: req.user?.email,
            clientIpAddress: req.ip || req.socket.remoteAddress,
            clientUserAgent: req.get("user-agent"),
            fbp: event.fbp,
            fbc: event.fbc,
            ctaOrFeature: event.ctaOrFeature,
            value: event.value,
            currency: event.currency,
          });
        }

        return res.status(204).end();
      } catch (error) {
        logger.error({ err: error }, "Site-event ingestion failed");
        return res.status(503).json({ message: "Analytics temporarily unavailable" });
      }
    },
  );

  app.post("/api/site-analytics/page-view", (req: Request, res: Response) => {
    const parsed = pageViewSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid page view" });

    try {
      const view = parsed.data;
      sqlite
        .prepare(
          `INSERT INTO site_page_views (
          id, visitor_id, session_id, path, referrer, referrer_host,
          utm_source, utm_medium, utm_campaign, utm_content, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          view.visitorId,
          view.sessionId,
          view.path,
          safeReferrer(view.referrer),
          referrerHost(view.referrer),
          view.utmSource || null,
          view.utmMedium || null,
          view.utmCampaign || null,
          view.utmContent || null,
          Date.now(),
        );
      return res.status(204).end();
    } catch (error) {
      logger.error({ err: error }, "Page-view ingestion failed");
      return res.status(503).json({ message: "Analytics temporarily unavailable" });
    }
  });

  app.get("/api/admin/site-analytics", requireAuth, requireAdmin, (req: Request, res: Response) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      const now = Date.now();
      const from = epoch(req.query.from, now - 7 * 86_400_000);
      const to = epoch(req.query.to, now);
      if (from > to) return res.status(400).json({ message: "Invalid time range" });

      const totals = sqlite
        .prepare(
          `SELECT COUNT(*) AS page_views,
          COUNT(DISTINCT visitor_id) AS unique_visitors,
          COUNT(DISTINCT session_id) AS sessions
          FROM site_page_views WHERE created_at BETWEEN ? AND ?`,
        )
        .get(from, to);
      const sources = sqlite
        .prepare(
          `SELECT
          COALESCE(NULLIF(utm_source, ''), NULLIF(referrer_host, ''), 'direct') AS source,
          COUNT(*) AS page_views, COUNT(DISTINCT visitor_id) AS unique_visitors
          FROM site_page_views WHERE created_at BETWEEN ? AND ?
          GROUP BY source ORDER BY page_views DESC LIMIT 20`,
        )
        .all(from, to);
      const pages = sqlite
        .prepare(
          `SELECT path, COUNT(*) AS page_views,
          COUNT(DISTINCT visitor_id) AS unique_visitors
          FROM site_page_views WHERE created_at BETWEEN ? AND ?
          GROUP BY path ORDER BY page_views DESC LIMIT 20`,
        )
        .all(from, to);
      const campaigns = sqlite
        .prepare(
          `SELECT utm_campaign AS campaign,
          COALESCE(utm_source, 'unknown') AS source, COUNT(*) AS page_views,
          COUNT(DISTINCT visitor_id) AS unique_visitors
          FROM site_page_views WHERE created_at BETWEEN ? AND ? AND utm_campaign IS NOT NULL
          GROUP BY utm_campaign, utm_source ORDER BY page_views DESC LIMIT 20`,
        )
        .all(from, to);

      const funnelRows = sqlite
        .prepare(
          `SELECT event_name, COUNT(*) AS event_count,
          COUNT(DISTINCT visitor_id) AS unique_visitors
          FROM site_events WHERE created_at BETWEEN ? AND ?
          GROUP BY event_name`,
        )
        .all(from, to) as Array<{
        event_name: string;
        event_count: number;
        unique_visitors: number;
      }>;
      const funnelMap = new Map(funnelRows.map((row) => [row.event_name, row]));
      const funnel = FUNNEL_EVENTS.map((eventName) => ({
        eventName,
        eventCount: funnelMap.get(eventName)?.event_count ?? 0,
        uniqueVisitors: funnelMap.get(eventName)?.unique_visitors ?? 0,
      }));

      return res.json({ period: { from, to }, totals, sources, pages, campaigns, funnel });
    } catch (error) {
      logger.error({ err: error }, "Site analytics query failed");
      return res.status(500).json({ message: "Failed to fetch site analytics" });
    }
  });
}
