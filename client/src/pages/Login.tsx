import { SignIn } from "@clerk/clerk-react";
import { Redirect } from "wouter";
import { EmbeddedSignInForm } from "@/components/auth/EmbeddedSignInForm";
import { isLocalDevAuthEnabled } from "@/lib/auth";
import { detectEmbeddedBrowser } from "@/lib/embeddedBrowser";
import { getSafeRedirectUrl, withRedirectUrl } from "@/lib/redirects";

export default function Login() {
  const redirectUrl = getSafeRedirectUrl();
  const embeddedBrowser = detectEmbeddedBrowser();

  if (isLocalDevAuthEnabled()) {
    return <Redirect to={redirectUrl} />;
  }

  if (embeddedBrowser) {
    return (
      <div className="min-h-screen bg-background px-4 py-5">
        <div className="mx-auto flex w-full max-w-md flex-col gap-4">
          <a
            href="/"
            target="_top"
            className="text-center text-sm font-bold uppercase tracking-[0.2em] text-primary"
          >
            ScholarMark
          </a>
          <EmbeddedSignInForm redirectUrl={redirectUrl} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-md flex-col justify-center gap-4">
        <a
          href="/"
          target="_top"
          className="text-center text-sm font-bold uppercase tracking-[0.2em] text-primary"
        >
          ScholarMark
        </a>
        <div className="flex min-h-[520px] justify-center" data-testid="signin-form-container">
          <SignIn
            routing="path"
            path="/sign-in"
            signUpUrl={withRedirectUrl("/sign-up", redirectUrl)}
            forceRedirectUrl={redirectUrl}
            fallbackRedirectUrl={redirectUrl}
          />
        </div>
      </div>
    </div>
  );
}
