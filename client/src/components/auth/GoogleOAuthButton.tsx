import { useState } from "react";
import { useSignIn, useSignUp } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";

interface GoogleOAuthButtonProps {
  mode: "sign-in" | "sign-up";
  redirectUrlComplete: string;
}

export function GoogleOAuthButton({ mode, redirectUrlComplete }: GoogleOAuthButtonProps) {
  const signInState = useSignIn();
  const signUpState = useSignUp();
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const isLoaded = mode === "sign-in" ? signInState.isLoaded : signUpState.isLoaded;
  const auth = mode === "sign-in" ? signInState.signIn : signUpState.signUp;

  async function handleGoogleAuth() {
    if (!auth || isStarting) return;

    setError(null);
    setIsStarting(true);

    try {
      const params = {
        strategy: "oauth_google" as const,
        redirectUrl: "/sso-callback",
        redirectUrlComplete,
        ...(mode === "sign-in" ? { continueSignIn: true } : { continueSignUp: true }),
      };

      await auth.authenticateWithRedirect(params);
    } catch (authError) {
      console.error("Google OAuth failed to start:", authError);
      setError("Google sign-in could not start. Try again or use email.");
      setIsStarting(false);
    }
  }

  return (
    <div className="w-full space-y-2">
      <Button
        type="button"
        variant="outline"
        className="w-full bg-background"
        disabled={!isLoaded || !auth || isStarting}
        onClick={() => {
          void handleGoogleAuth();
        }}
      >
        <span className="font-semibold normal-case tracking-normal">G</span>
        Continue with Google
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
