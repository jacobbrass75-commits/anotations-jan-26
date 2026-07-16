import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  getMarketingConsent,
  isMetaPixelConfigured,
  setMarketingConsent,
} from "@/lib/metaTracking";
import { trackSiteEvent } from "@/lib/siteAnalytics";

export function MarketingConsentBanner() {
  const [consent, setConsent] = useState(getMarketingConsent);

  if (!isMetaPixelConfigured() || consent !== "unknown") return null;

  const choose = (nextConsent: "granted" | "denied") => {
    setMarketingConsent(nextConsent);
    setConsent(nextConsent);
    if (nextConsent === "granted") {
      if (window.location.pathname.startsWith("/sign-up")) {
        trackSiteEvent("signup_started", { ctaOrFeature: "consent_granted_on_signup" });
      } else {
        trackSiteEvent("landing_view", { ctaOrFeature: "consent_granted_on_landing" });
      }
    }
  };

  return (
    <aside
      aria-label="Optional advertising analytics"
      className="fixed inset-x-3 bottom-24 z-[60] mx-auto max-w-md rounded-xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur md:bottom-4 md:left-4 md:right-auto md:mx-0"
    >
      <p className="text-sm font-semibold">Optional ad measurement</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Allow Meta analytics so we can measure which ads lead to registrations. ScholarMark works
        the same if you decline.{" "}
        <Link href="/privacy" className="underline underline-offset-2">
          Ad privacy choices
        </Link>
        .
      </p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => choose("granted")}>
          Allow
        </Button>
        <Button size="sm" variant="outline" onClick={() => choose("denied")}>
          No thanks
        </Button>
      </div>
    </aside>
  );
}
