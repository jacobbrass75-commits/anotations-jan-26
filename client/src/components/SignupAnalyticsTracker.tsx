import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { trackSiteEvent } from "@/lib/siteAnalytics";

export const SIGNUP_IN_PROGRESS_KEY = "scholarmark_signup_in_progress";

export function SignupAnalyticsTracker() {
  const { isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    try {
      if (sessionStorage.getItem(SIGNUP_IN_PROGRESS_KEY) !== "1") return;
      sessionStorage.removeItem(SIGNUP_IN_PROGRESS_KEY);
      trackSiteEvent("signup_completed", { ctaOrFeature: "clerk_signup" });
    } catch {
      // Storage and analytics are optional; neither may block authentication.
    }
  }, [isLoaded, isSignedIn]);

  return null;
}
