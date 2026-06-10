import { SignIn } from "@clerk/clerk-react";
import { Redirect } from "wouter";
import { GoogleOAuthButton } from "@/components/auth/GoogleOAuthButton";
import { isLocalDevAuthEnabled } from "@/lib/auth";
import { getSafeRedirectUrl, withRedirectUrl } from "@/lib/redirects";

export default function Login() {
  if (isLocalDevAuthEnabled()) {
    return <Redirect to="/" />;
  }

  const redirectUrl = getSafeRedirectUrl();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-4">
        <GoogleOAuthButton mode="sign-in" redirectUrlComplete={redirectUrl} />
        <SignIn
          routing="path"
          path="/sign-in"
          signUpUrl={withRedirectUrl("/sign-up", redirectUrl)}
          forceRedirectUrl={redirectUrl}
          fallbackRedirectUrl={redirectUrl}
        />
      </div>
    </div>
  );
}
