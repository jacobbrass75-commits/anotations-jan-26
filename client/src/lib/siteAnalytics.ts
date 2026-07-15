export type SiteEventName =
  | "landing_view"
  | "engaged_10_seconds"
  | "scroll_50_percent"
  | "primary_cta_click"
  | "pricing_view"
  | "signup_started"
  | "signup_completed"
  | "checkout_started"
  | "purchase_completed"
  | "first_project_created";

interface SiteEventOptions {
  ctaOrFeature?: string;
}

const ATTRIBUTION_KEY = "scholarmark_site_attribution";
let memoryVisitorId: string | null = null;
let memorySessionId: string | null = null;

function newId(): string {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto?.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function storedId(storage: Storage, key: string): string {
  try {
    const existing = storage.getItem(key);
    if (existing) return existing;
    const value = newId();
    storage.setItem(key, value);
    return value;
  } catch {
    if (key.includes("visitor")) return (memoryVisitorId ??= newId());
    return (memorySessionId ??= newId());
  }
}

function safeReferrer(): string | null {
  if (!document.referrer) return null;
  try {
    const url = new URL(document.referrer);
    return `${url.origin}${url.pathname}`.slice(0, 1000);
  } catch {
    return null;
  }
}

function readAttribution() {
  const params = new URLSearchParams(window.location.search);
  const current = {
    utmSource: params.get("utm_source"),
    utmMedium: params.get("utm_medium"),
    utmCampaign: params.get("utm_campaign"),
    utmContent: params.get("utm_content"),
    referrer: safeReferrer(),
  };
  try {
    const stored = JSON.parse(sessionStorage.getItem(ATTRIBUTION_KEY) ?? "{}") as typeof current;
    const merged = Object.fromEntries(
      Object.entries({ ...stored, ...current }).filter(([, value]) => value),
    );
    sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(merged));
    return merged;
  } catch {
    return current;
  }
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
    const body = JSON.stringify({
      eventName,
      visitorId: storedId(localStorage, "scholarmark_visitor_id"),
      sessionId: storedId(sessionStorage, "scholarmark_session_id"),
      path: window.location.pathname.slice(0, 500),
      clientTimestamp: Date.now(),
      ...readAttribution(),
      ctaOrFeature: options.ctaOrFeature,
      deviceCategory: deviceCategory(),
      viewportWidth: approximate(window.innerWidth),
      viewportHeight: approximate(window.innerHeight),
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
