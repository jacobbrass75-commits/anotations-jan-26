import { useEffect } from "react";
import { useLocation } from "wouter";

function storedId(storage: Storage, key: string): string {
  const existing = storage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  storage.setItem(key, value);
  return value;
}

export function SiteAnalyticsTracker() {
  const [pathname] = useLocation();

  useEffect(() => {
    if (import.meta.env.DEV || pathname.startsWith("/admin/")) return;

    const params = new URLSearchParams(window.location.search);
    const body = JSON.stringify({
      visitorId: storedId(localStorage, "scholarmark_visitor_id"),
      sessionId: storedId(sessionStorage, "scholarmark_session_id"),
      path: `${pathname}${window.location.search}`.slice(0, 500),
      referrer: document.referrer || null,
      utmSource: params.get("utm_source"),
      utmMedium: params.get("utm_medium"),
      utmCampaign: params.get("utm_campaign"),
      utmContent: params.get("utm_content"),
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/site-analytics/page-view", new Blob([body], { type: "application/json" }));
    } else {
      void fetch("/api/site-analytics/page-view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      });
    }
  }, [pathname]);

  return null;
}
