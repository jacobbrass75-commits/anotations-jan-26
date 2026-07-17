import {
  getMarketingConsent,
  getMetaBrowserIdentifiers,
  trackMetaPixelEvent,
} from "@/lib/metaTracking";
import { getAnalyticsId } from "@/lib/analyticsIdentity";
import { readSiteAttribution } from "@/lib/siteAttribution";

export type SiteEventName =
  | "landing_view"
  | "engaged_10_seconds"
  | "scroll_50_percent"
  | "primary_cta_click"
  | "pricing_view"
  | "signup_started"
  | "signup_details_submitted"
  | "signup_verification_sent"
  | "signup_verification_succeeded"
  | "signup_hosted_fallback"
  | "signup_completed"
  | "checkout_started"
  | "purchase_completed"
  | "first_project_created";

export interface SiteEventOptions {
  ctaOrFeature?: string;
  value?: number;
  currency?: string;
}

function newId(): string {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto?.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function deviceCategory(): "mobile" | "tablet" | "desktop" | "unknown" {
  const width = window.innerWidth;
  if (!Number.isFinite(width)) return "unknown";
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

function approximate(value: number): number {
  return Math.max(0, Math.round(value / 100) * 100);
}

export function trackSiteEvent(eventName: SiteEventName, options: SiteEventOptions = {}): void {
  if (import.meta.env.DEV || typeof window === "undefined") return;

  try {
    const metaEventId = newId();
    const marketingConsent = getMarketingConsent() === "granted";
    const metaIdentifiers = getMetaBrowserIdentifiers();
    trackMetaPixelEvent(eventName, metaEventId, options);

    const body = JSON.stringify({
      eventName,
      metaEventId,
      marketingConsent,
      visitorId: getAnalyticsId(localStorage, "scholarmark_visitor_id"),
      sessionId: getAnalyticsId(sessionStorage, "scholarmark_session_id"),
      path: window.location.pathname.slice(0, 500),
      clientTimestamp: Date.now(),
      ...readSiteAttribution(new URLSearchParams(window.location.search)),
      ctaOrFeature: options.ctaOrFeature,
      deviceCategory: deviceCategory(),
      viewportWidth: approximate(window.innerWidth),
      viewportHeight: approximate(window.innerHeight),
      eventSourceUrl: `${window.location.origin}${window.location.pathname}`.slice(0, 1000),
      fbp: metaIdentifiers.fbp,
      fbc: metaIdentifiers.fbc,
      value: options.value,
      currency: options.currency,
    });
    void fetch("/api/site-analytics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => undefined);
  } catch {
    // Analytics must never block or break the product experience.
  }
}
