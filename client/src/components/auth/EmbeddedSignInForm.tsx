import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, LoaderCircle, MailCheck, ShieldCheck } from "lucide-react";
import { useSignIn } from "@clerk/clerk-react";
import type { EmailCodeFactor, SignInResource } from "@clerk/shared/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getClerkErrorMessage } from "@/lib/clerkErrors";
import { activateClerkSession } from "@/lib/clerkSession";
import { withAuthOperationDelayNotice } from "@/lib/authOperation";
import { findEmailCodeSecondFactor } from "@/lib/embeddedAuthFlow";
import { buildClerkAccountPortalUrl, withRedirectUrl } from "@/lib/redirects";

const CLERK_LOAD_TIMEOUT_MS = 8_000;
type SignInStep = "credentials" | "second-factor" | "complete";

export function EmbeddedSignInForm({ redirectUrl }: { redirectUrl: string }) {
  const { isLoaded, signIn, setActive } = useSignIn();
  const [step, setStep] = useState<SignInStep>(() =>
    signIn?.status === "needs_second_factor"
      ? "second-factor"
      : signIn?.status === "complete"
        ? "complete"
        : "credentials",
  );
  const [emailAddress, setEmailAddress] = useState(signIn?.identifier ?? "");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [secondFactor, setSecondFactor] = useState<EmailCodeFactor | null>(() =>
    signIn ? findEmailCodeSecondFactor(signIn) : null,
  );
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [delayMessage, setDelayMessage] = useState<string | null>(null);
  const activatingSession = useRef(false);
  const preparingRestoredFactor = useRef(false);

  const portalUrl = useMemo(
    () => buildClerkAccountPortalUrl("sign-in", redirectUrl),
    [redirectUrl],
  );
  const signUpUrl = useMemo(() => withRedirectUrl("/sign-up", redirectUrl), [redirectUrl]);

  useEffect(() => {
    if (isLoaded) {
      setLoadTimedOut(false);
      return;
    }
    const timeout = window.setTimeout(() => setLoadTimedOut(true), CLERK_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [isLoaded]);

  const activateCompletedSignIn = useCallback(
    async (result: SignInResource): Promise<boolean> => {
      if (result.status !== "complete" || !result.createdSessionId || !setActive) return false;
      if (activatingSession.current) return true;
      activatingSession.current = true;
      setStep("complete");
      try {
        await withAuthOperationDelayNotice(
          activateClerkSession({
            setActive,
            sessionId: result.createdSessionId,
            redirectUrl,
            taskFallbackUrl: portalUrl,
          }),
          "Sign-in completed, but opening the session is still processing. Use the secure hosted sign-in page below if it does not finish.",
          setDelayMessage,
        );
        return true;
      } catch (caught) {
        activatingSession.current = false;
        setStep("credentials");
        throw caught;
      }
    },
    [portalUrl, redirectUrl, setActive],
  );

  const prepareEmailSecondFactor = useCallback(
    async (resource: SignInResource, announce: boolean) => {
      const factor = findEmailCodeSecondFactor(resource);
      if (!factor) {
        setError(
          "This account uses another security method. Continue on the secure hosted sign-in page.",
        );
        return false;
      }
      await withAuthOperationDelayNotice(
        resource.prepareSecondFactor({
          strategy: "email_code",
          emailAddressId: factor.emailAddressId,
        }),
        "The security email is still being requested. Do not resend yet; use the secure hosted sign-in page below if needed.",
        setDelayMessage,
      );
      setSecondFactor(factor);
      setStep("second-factor");
      if (announce) setNotice(`We sent a six-digit code to ${factor.safeIdentifier}.`);
      return true;
    },
    [],
  );

  useEffect(() => {
    if (!isLoaded || !signIn) return;
    if (signIn.identifier) setEmailAddress(signIn.identifier);
    if (signIn.status === "complete") {
      void activateCompletedSignIn(signIn).catch((caught) => {
        setError(
          getClerkErrorMessage(caught, "Sign-in completed, but the session could not open."),
        );
      });
      return;
    }
    if (signIn.status !== "needs_second_factor") return;

    const factor = findEmailCodeSecondFactor(signIn);
    if (!factor) {
      setSecondFactor(null);
      setStep("credentials");
      setError(
        "This account uses another security method. Continue on the secure hosted sign-in page.",
      );
      return;
    }
    setSecondFactor(factor);
    setStep("second-factor");
    if (
      signIn.secondFactorVerification.strategy !== "email_code" &&
      !preparingRestoredFactor.current
    ) {
      preparingRestoredFactor.current = true;
      void prepareEmailSecondFactor(signIn, true)
        .catch((caught) => {
          setError(getClerkErrorMessage(caught, "We couldn't send the security code."));
        })
        .finally(() => {
          preparingRestoredFactor.current = false;
        });
    }
  }, [activateCompletedSignIn, isLoaded, prepareEmailSecondFactor, signIn]);

  async function handleCredentialsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!isLoaded || !signIn) {
      setError("Secure sign-in is still loading. Retry, or use the secure sign-in page below.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await withAuthOperationDelayNotice(
        signIn.create({
          identifier: emailAddress.trim(),
          password,
          strategy: "password",
        }),
        "Secure sign-in is still processing. Do not submit it again; use the secure hosted sign-in page below if it does not finish.",
        setDelayMessage,
      );
      setPassword("");
      if (await activateCompletedSignIn(result)) return;
      if (result.status === "needs_second_factor") {
        await prepareEmailSecondFactor(result, true);
        return;
      }
      setError("Sign-in needs another secure step. Continue on the hosted sign-in page below.");
    } catch (caught) {
      setError(
        getClerkErrorMessage(caught, "We couldn't sign you in. Check your email and password."),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSecondFactorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!isLoaded || !signIn) {
      setError("Secure sign-in is still loading. Please retry.");
      return;
    }
    const normalizedCode = code.replace(/\D/g, "");
    if (normalizedCode.length !== 6) {
      setError("Enter the six-digit code from your email.");
      return;
    }

    setIsSubmitting(true);
    try {
      const verified = await withAuthOperationDelayNotice(
        signIn.attemptSecondFactor({
          strategy: "email_code",
          code: normalizedCode,
        }),
        "Your security code is still being verified. Do not submit it again; use the secure hosted sign-in page below if needed.",
        setDelayMessage,
      );
      setCode("");
      if (await activateCompletedSignIn(verified)) return;
      setError("The code was accepted, but sign-in needs another secure step.");
    } catch (caught) {
      setError(getClerkErrorMessage(caught, "That code could not be verified. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResendCode() {
    setError(null);
    setNotice(null);
    if (!isLoaded || !signIn) {
      setError("Secure sign-in is still loading. Please retry.");
      return;
    }
    setIsSubmitting(true);
    try {
      await prepareEmailSecondFactor(signIn, false);
      setNotice("A new six-digit code is on its way.");
    } catch (caught) {
      setError(getClerkErrorMessage(caught, "We couldn't resend the code yet. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card
      className="w-full border-primary/20 bg-card/95 shadow-sm"
      data-testid="embedded-signin-form"
    >
      <CardHeader className="space-y-2 pb-4">
        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.2em] text-primary">
          {step === "second-factor" ? (
            <MailCheck className="h-4 w-4" />
          ) : (
            <ShieldCheck className="h-4 w-4" />
          )}
          Works inside Instagram
        </div>
        <CardTitle>
          {step === "second-factor"
            ? "Check your email"
            : step === "complete"
              ? "Opening ScholarMark"
              : "Sign in with email"}
        </CardTitle>
        <CardDescription>
          {step === "second-factor"
            ? `Enter the security code sent to ${secondFactor?.safeIdentifier ?? "your email"}.`
            : step === "complete"
              ? "Your secure session is being prepared."
              : "Google sign-in requires Safari or Chrome."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {delayMessage && (
          <div className="mb-4">
            <AuthError>{delayMessage}</AuthError>
          </div>
        )}
        {step === "credentials" && (
          <form className="space-y-4" onSubmit={handleCredentialsSubmit} noValidate>
            <div className="space-y-2">
              <Label htmlFor="embedded-signin-email">Email address</Label>
              <Input
                id="embedded-signin-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                value={emailAddress}
                onChange={(event) => setEmailAddress(event.target.value)}
                data-testid="embedded-signin-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="embedded-signin-password">Password</Label>
              <div className="relative">
                <Input
                  id="embedded-signin-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="pr-11"
                  data-testid="embedded-signin-password"
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground"
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div id="clerk-captcha" data-cl-theme="light" data-cl-size="flexible" />
            {error && <AuthError>{error}</AuthError>}
            <Button className="h-12 w-full" type="submit" disabled={!isLoaded || isSubmitting}>
              {!delayMessage && (isSubmitting || !isLoaded) ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : null}
              {!isLoaded
                ? "Preparing secure sign-in"
                : isSubmitting
                  ? delayMessage
                    ? "Sign-in is still processing"
                    : "Signing in"
                  : "Sign in"}
            </Button>
          </form>
        )}

        {step === "second-factor" && (
          <form className="space-y-4" onSubmit={handleSecondFactorSubmit} noValidate>
            <div className="space-y-2">
              <Label htmlFor="embedded-signin-code">Six-digit code</Label>
              <Input
                id="embedded-signin-code"
                type="text"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                required
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                className="h-12 text-center font-mono text-xl tracking-[0.35em]"
                data-testid="embedded-signin-code"
              />
            </div>
            {error && <AuthError>{error}</AuthError>}
            {notice && (
              <div role="status" className="text-sm text-muted-foreground">
                {notice}
              </div>
            )}
            <Button className="h-12 w-full" type="submit" disabled={isSubmitting}>
              {isSubmitting && !delayMessage ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : null}
              {isSubmitting
                ? delayMessage
                  ? "Verification is still processing"
                  : "Verifying"
                : "Verify and sign in"}
            </Button>
            <button
              type="button"
              className="w-full text-sm font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50"
              onClick={handleResendCode}
              disabled={isSubmitting}
            >
              Resend code
            </button>
          </form>
        )}

        {step === "complete" && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            {!delayMessage && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {delayMessage ? "Session setup is still processing" : "Opening your workspace"}
          </div>
        )}

        <div className="mt-5 space-y-3 border-t pt-4 text-center text-xs text-muted-foreground">
          {loadTimedOut && (
            <div className="space-y-2" role="alert">
              <p>The secure connection is taking longer than expected.</p>
              <button
                className="font-semibold text-primary underline underline-offset-2"
                type="button"
                onClick={() => window.location.reload()}
              >
                Retry secure sign-in
              </button>
            </div>
          )}
          <a
            className="font-semibold text-primary underline underline-offset-2"
            href={portalUrl}
            target="_top"
          >
            Use the secure hosted sign-in page
          </a>
          <p>
            Need an account?{" "}
            <a
              className="font-semibold text-primary underline underline-offset-2"
              href={signUpUrl}
              target="_top"
            >
              Create one with email
            </a>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function AuthError({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
    >
      {children}
    </div>
  );
}
