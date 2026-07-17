import { useEffect } from "react";
import { useLocation } from "wouter";
import { getAnalyticsId } from "@/lib/analyticsIdentity";
import { isPaidInstagramDirectSignup } from "@/lib/marketingEntry";
import { readSiteAttribution } from "@/lib/siteAttribution";
import { trackSiteEvent } from "@/lib/siteAnalytics";

export function SiteAnalyticsTracker() {
  const [pathname] = useLocation();

  useEffect(() => {
    if (import.meta.env.DEV || pathname.startsWith("/admin/")) return;

    const params = new URLSearchParams(window.location.search);
    const source = readSiteAttribution(params);
    const body = JSON.stringify({
      visitorId: getAnalyticsId(localStorage, "scholarmark_visitor_id"),
      sessionId: getAnalyticsId(sessionStorage, "scholarmark_session_id"),
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
      pathname.startsWith("/invite") ||
      (pathname.startsWith("/sign-up") && isPaidInstagramDirectSignup(window.location.search))
    ) {
      trackSiteEvent("landing_view", {
        ctaOrFeature: pathname.startsWith("/sign-up") ? "paid_instagram_direct_signup" : undefined,
      });
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
