import { SignUp } from "@clerk/clerk-react";
import { Redirect } from "wouter";
import { GoogleOAuthButton } from "@/components/auth/GoogleOAuthButton";
import { isLocalDevAuthEnabled } from "@/lib/auth";
import { getSafeRedirectUrl, withRedirectUrl } from "@/lib/redirects";

export default function Register() {
  if (isLocalDevAuthEnabled()) {
    return <Redirect to="/" />;
  }

  const redirectUrl = getSafeRedirectUrl();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-4">
        <GoogleOAuthButton mode="sign-up" redirectUrlComplete={redirectUrl} />
        <SignUp
          routing="path"
          path="/sign-up"
          signInUrl={withRedirectUrl("/sign-in", redirectUrl)}
          forceRedirectUrl={redirectUrl}
          fallbackRedirectUrl={redirectUrl}
        />
      </div>
    </div>
  );
}
