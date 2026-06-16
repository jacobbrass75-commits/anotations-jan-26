import { SignIn } from "@clerk/clerk-react";
import { Redirect } from "wouter";
import { isLocalDevAuthEnabled } from "@/lib/auth";
import { getSafeRedirectUrl, withRedirectUrl } from "@/lib/redirects";

export default function Login() {
  const redirectUrl = getSafeRedirectUrl();

  if (isLocalDevAuthEnabled()) {
    return <Redirect to={redirectUrl} />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl={withRedirectUrl("/sign-up", redirectUrl)}
        forceRedirectUrl={redirectUrl}
        fallbackRedirectUrl={redirectUrl}
      />
    </div>
  );
}
