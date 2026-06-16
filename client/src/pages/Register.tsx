import { SignUp } from "@clerk/clerk-react";
import { Redirect } from "wouter";
import { isLocalDevAuthEnabled } from "@/lib/auth";
import { getSafeRedirectUrl, withRedirectUrl } from "@/lib/redirects";

export default function Register() {
  const redirectUrl = getSafeRedirectUrl();

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
