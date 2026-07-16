import { useEffect } from "react";
import { useLocation } from "wouter";
import { trackSiteEvent } from "@/lib/siteAnalytics";

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

function attribution(params: URLSearchParams) {
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

export function SiteAnalyticsTracker() {
  const [pathname] = useLocation();

  useEffect(() => {
    if (import.meta.env.DEV || pathname.startsWith("/admin/")) return;

    const params = new URLSearchParams(window.location.search);
    const source = attribution(params);
    const body = JSON.stringify({
      visitorId: storedId(localStorage, "scholarmark_visitor_id"),
      sessionId: storedId(sessionStorage, "scholarmark_session_id"),
      path: pathname.slice(0, 500),
      ...source,
    });

    void fetch("/api/site-analytics/page-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => undefined);
  }, [pathname]);

  useEffect(() => {
    if (import.meta.env.DEV || pathname.startsWith("/admin/")) return;

    if (
      pathname === "/" ||
      pathname === "/start" ||
      pathname.startsWith("/summer") ||
      pathname.startsWith("/invite")
    ) {
      trackSiteEvent("landing_view");
    } else if (pathname === "/pricing") {
      trackSiteEvent("pricing_view");
    }

    const engagedTimer = window.setTimeout(() => trackSiteEvent("engaged_10_seconds"), 10_000);
    let sentScroll = false;
    const onScroll = () => {
      const total = document.documentElement.scrollHeight - window.innerHeight;
      if (!sentScroll && total > 0 && window.scrollY / total >= 0.5) {
        sentScroll = true;
        trackSiteEvent("scroll_50_percent");
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(engagedTimer);
      window.removeEventListener("scroll", onScroll);
    };
  }, [pathname]);

  return null;
}
