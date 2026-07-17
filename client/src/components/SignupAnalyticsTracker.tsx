import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { trackSiteEvent } from "@/lib/siteAnalytics";
import { consumeSignupInProgress } from "@/lib/signupAnalyticsState";

const NEW_ACCOUNT_WINDOW_MS = 30 * 60 * 1000;

export function isRecentlyCreatedAccount(createdAt: string | null | undefined, now = Date.now()) {
  if (!createdAt) return false;
  const createdAtMs = new Date(createdAt).getTime();
  return (
    Number.isFinite(createdAtMs) && createdAtMs <= now && now - createdAtMs <= NEW_ACCOUNT_WINDOW_MS
  );
}

export function SignupAnalyticsTracker() {
  const { isLoaded, isSignedIn, user } = useAuth();

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;
    try {
      if (!consumeSignupInProgress()) return;
      if (isRecentlyCreatedAccount(user.createdAt)) {
        trackSiteEvent("signup_completed", { ctaOrFeature: "clerk_signup" });
      }
    } catch {
      // Storage and analytics are optional; neither may block authentication.
    }
  }, [isLoaded, isSignedIn, user]);

  return null;
}
