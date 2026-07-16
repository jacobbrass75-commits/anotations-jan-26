import { useEffect, useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildDirectSignupUrl } from "@/lib/redirects";

export default function DirectSignup() {
  const signupUrl = useMemo(() => buildDirectSignupUrl(window.location.search), []);

  useEffect(() => {
    window.location.replace(signupUrl);
  }, [signupUrl]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-sm space-y-4 text-center">
        <div className="text-xs font-mono uppercase tracking-[0.3em] text-muted-foreground">
          ScholarMark
        </div>
        <h1 className="text-2xl font-semibold">Opening your free account setup</h1>
        <p className="text-sm text-muted-foreground">
          No credit card required. If the page does not continue automatically, use the button
          below.
        </p>
        <Button className="h-12 w-full" asChild>
          <a href={signupUrl} target="_top" data-testid="direct-signup-fallback">
            Continue to free signup
            <ArrowRight className="ml-2 h-4 w-4" />
          </a>
        </Button>
      </div>
    </main>
  );
}
