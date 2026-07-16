import { SignIn } from "@clerk/clerk-react";
import { Redirect } from "wouter";
import {
  EMBEDDED_BROWSER_AUTH_APPEARANCE,
  EmbeddedBrowserAuthNotice,
} from "@/components/EmbeddedBrowserAuthNotice";
import { isLocalDevAuthEnabled } from "@/lib/auth";
import { detectEmbeddedBrowser } from "@/lib/embeddedBrowser";
import { getSafeRedirectUrl, withRedirectUrl } from "@/lib/redirects";

export default function Login() {
  const redirectUrl = getSafeRedirectUrl();
  const embeddedBrowser = detectEmbeddedBrowser();

  if (isLocalDevAuthEnabled()) {
    return <Redirect to={redirectUrl} />;
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
        {embeddedBrowser && <EmbeddedBrowserAuthNotice kind={embeddedBrowser} />}
        <div className="flex min-h-[520px] justify-center" data-testid="signin-form-container">
          <SignIn
            routing="path"
            path="/sign-in"
            signUpUrl={withRedirectUrl("/sign-up", redirectUrl)}
            forceRedirectUrl={redirectUrl}
            fallbackRedirectUrl={redirectUrl}
            appearance={embeddedBrowser ? EMBEDDED_BROWSER_AUTH_APPEARANCE : undefined}
          />
        </div>
        {embeddedBrowser && (
          <p className="text-center text-xs leading-relaxed text-muted-foreground">
            If the form does not appear, open this page in Safari or Chrome from the menu above.
          </p>
        )}
      </div>
    </div>
  );
}
