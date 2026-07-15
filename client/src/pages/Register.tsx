import { SignUp } from "@clerk/clerk-react";
import { useEffect } from "react";
import { Redirect } from "wouter";
import { SIGNUP_IN_PROGRESS_KEY } from "@/components/SignupAnalyticsTracker";
import { isLocalDevAuthEnabled } from "@/lib/auth";
import { getSafeRedirectUrl, withRedirectUrl } from "@/lib/redirects";
import { trackSiteEvent } from "@/lib/siteAnalytics";

export default function Register() {
  const redirectUrl = getSafeRedirectUrl();

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SIGNUP_IN_PROGRESS_KEY) === "1") return;
      sessionStorage.setItem(SIGNUP_IN_PROGRESS_KEY, "1");
      trackSiteEvent("signup_started", { ctaOrFeature: "clerk_signup" });
    } catch {
      trackSiteEvent("signup_started", { ctaOrFeature: "clerk_signup" });
    }
  }, []);

  if (isLocalDevAuthEnabled()) {
    return <Redirect to={redirectUrl} />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <SignUp
        routing="path"
        path="/sign-up"
        signInUrl={withRedirectUrl("/sign-in", redirectUrl)}
        forceRedirectUrl={redirectUrl}
        fallbackRedirectUrl={redirectUrl}
      />
    </div>
  );
}
