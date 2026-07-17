import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, LoaderCircle, MailCheck, ShieldCheck } from "lucide-react";
import { useSignUp } from "@clerk/clerk-react";
import type { SignUpResource } from "@clerk/shared/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getClerkErrorCode, getClerkErrorMessage } from "@/lib/clerkErrors";
import { activateClerkSession } from "@/lib/clerkSession";
import { withAuthOperationDelayNotice } from "@/lib/authOperation";
import {
  deriveEmbeddedSignUpStep,
  getRequiredProfileFields,
  type EmbeddedSignUpStep,
} from "@/lib/embeddedAuthFlow";
import { buildClerkAccountPortalUrl, withRedirectUrl } from "@/lib/redirects";

const CLERK_LOAD_TIMEOUT_MS = 8_000;

export function EmbeddedSignUpForm({ redirectUrl }: { redirectUrl: string }) {
  const { isLoaded, signUp, setActive } = useSignUp();
  const [step, setStep] = useState<EmbeddedSignUpStep>(() => deriveEmbeddedSignUpStep(signUp));
  const [emailAddress, setEmailAddress] = useState(signUp?.emailAddress ?? "");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [delayMessage, setDelayMessage] = useState<string | null>(null);
  const activatingSession = useRef(false);

  const portalUrl = useMemo(
    () => buildClerkAccountPortalUrl("sign-up", redirectUrl),
    [redirectUrl],
  );
  const signInUrl = useMemo(() => withRedirectUrl("/sign-in", redirectUrl), [redirectUrl]);
  const requiredProfileFields = signUp ? getRequiredProfileFields(signUp) : [];

  useEffect(() => {
    if (isLoaded) {
      setLoadTimedOut(false);
      return;
    }
    const timeout = window.setTimeout(() => setLoadTimedOut(true), CLERK_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [isLoaded]);

  useEffect(() => {
    if (!isLoaded || !signUp) return;
    const nextStep = deriveEmbeddedSignUpStep(signUp);
    setStep(nextStep);
    if (signUp.emailAddress) setEmailAddress(signUp.emailAddress);
  }, [isLoaded, signUp]);

  const activateCompletedSignUp = useCallback(
    async (result: SignUpResource): Promise<boolean> => {
      if (result.status !== "complete" || !result.createdSessionId || !setActive) return false;
      if (activatingSession.current) return true;
      activatingSession.current = true;
      try {
        await withAuthOperationDelayNotice(
          activateClerkSession({
            setActive,
            sessionId: result.createdSessionId,
            redirectUrl,
            taskFallbackUrl: portalUrl,
          }),
          "Your account is ready, but opening the session is still processing. Use the secure hosted signup page below if it does not finish.",
          setDelayMessage,
        );
        return true;
      } catch (caught) {
        activatingSession.current = false;
        throw caught;
      }
    },
    [portalUrl, redirectUrl, setActive],
  );

  useEffect(() => {
    if (!isLoaded || !signUp || signUp.status !== "complete") return;
    void activateCompletedSignUp(signUp).catch((caught) => {
      setError(
        getClerkErrorMessage(caught, "Your account is ready, but sign-in could not finish."),
      );
    });
  }, [activateCompletedSignUp, isLoaded, signUp]);

  async function advanceSignUp(result: SignUpResource, sendVerificationCode: boolean) {
    if (await activateCompletedSignUp(result)) return;
    const nextStep = deriveEmbeddedSignUpStep(result);
    if (nextStep === "verification" && sendVerificationCode) {
      await withAuthOperationDelayNotice(
        result.prepareEmailAddressVerification({ strategy: "email_code" }),
        "The verification email is still being requested. Do not resend yet; use the secure hosted signup page below if needed.",
        setDelayMessage,
      );
      setNotice("We sent a six-digit verification code to your email.");
    }
    setStep(nextStep);
  }

  async function handleDetailsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!isLoaded || !signUp || !setActive) {
      setError("Secure signup is still loading. Retry, or use the secure signup page below.");
      return;
    }
    if (password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await withAuthOperationDelayNotice(
        signUp.create({ emailAddress: emailAddress.trim(), password }),
        "Secure signup is still processing. Do not submit it again; use the secure hosted signup page below if it does not finish.",
        setDelayMessage,
      );
      setPassword("");
      await advanceSignUp(created, true);
    } catch (caught) {
      const errorCode = getClerkErrorCode(caught);
      setError(
        errorCode === "form_identifier_exists"
          ? "We couldn't create an account with those details. Try signing in if you have used this email before."
          : getClerkErrorMessage(caught, "We couldn't start signup. Please try again."),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!isLoaded || !signUp) {
      setError("Secure signup is still loading. Please retry.");
      return;
    }
    if (requiredProfileFields.includes("first_name") && !firstName.trim()) {
      setError("Enter your first name.");
      return;
    }
    if (requiredProfileFields.includes("last_name") && !lastName.trim()) {
      setError("Enter your last name.");
      return;
    }
    if (requiredProfileFields.includes("legal_accepted") && !legalAccepted) {
      setError("Accept the Terms and Privacy Policy to continue.");
      return;
    }

    setIsSubmitting(true);
    try {
      const updated = await withAuthOperationDelayNotice(
        signUp.update({
          ...(requiredProfileFields.includes("first_name") ? { firstName: firstName.trim() } : {}),
          ...(requiredProfileFields.includes("last_name") ? { lastName: lastName.trim() } : {}),
          ...(requiredProfileFields.includes("legal_accepted") ? { legalAccepted } : {}),
        }),
        "Your account details are still being saved. Do not submit them again; use the secure hosted signup page below if needed.",
        setDelayMessage,
      );
      await advanceSignUp(updated, true);
    } catch (caught) {
      setError(getClerkErrorMessage(caught, "We couldn't save those details. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerificationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!isLoaded || !signUp) {
      setError("Secure signup is still loading. Please retry.");
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
        signUp.attemptEmailAddressVerification({ code: normalizedCode }),
        "Your verification is still processing. Do not submit the code again; use the secure hosted signup page below if needed.",
        setDelayMessage,
      );
      setCode("");
      await advanceSignUp(verified, false);
    } catch (caught) {
      setError(getClerkErrorMessage(caught, "That code could not be verified. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResendCode() {
    setError(null);
    setNotice(null);
    if (!isLoaded || !signUp) {
      setError("Secure signup is still loading. Please retry.");
      return;
    }
    setIsSubmitting(true);
    try {
      await withAuthOperationDelayNotice(
        signUp.prepareEmailAddressVerification({ strategy: "email_code" }),
        "The new code is still being requested. Do not resend again; use the secure hosted signup page below if needed.",
        setDelayMessage,
      );
      setNotice("A new six-digit code is on its way.");
    } catch (caught) {
      setError(getClerkErrorMessage(caught, "We couldn't resend the code yet. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  }

  const title =
    step === "verification"
      ? "Check your email"
      : step === "profile"
        ? "Finish your profile"
        : step === "unsupported"
          ? "Finish secure setup"
          : step === "complete"
            ? "Opening ScholarMark"
            : "Create your free account";

  return (
    <Card
      className="w-full border-primary/20 bg-card/95 shadow-sm"
      data-testid="embedded-signup-form"
    >
      <CardHeader className="space-y-2 pb-4">
        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.2em] text-primary">
          {step === "verification" ? (
            <MailCheck className="h-4 w-4" />
          ) : (
            <ShieldCheck className="h-4 w-4" />
          )}
          Works inside Instagram
        </div>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {step === "verification"
            ? `Enter the code sent to ${emailAddress}.`
            : step === "profile"
              ? "Add the remaining details required for your account."
              : step === "unsupported"
                ? "This account needs an additional secure setup step."
                : step === "complete"
                  ? "Your secure session is being prepared."
                  : "Use email and password here. No credit card required."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {delayMessage && (
          <div className="mb-4">
            <AuthMessage kind="error">{delayMessage}</AuthMessage>
          </div>
        )}
        {step === "details" && (
          <form className="space-y-4" onSubmit={handleDetailsSubmit} noValidate>
            <div className="space-y-2">
              <Label htmlFor="embedded-signup-email">Email address</Label>
              <Input
                id="embedded-signup-email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                value={emailAddress}
                onChange={(event) => setEmailAddress(event.target.value)}
                placeholder="you@example.edu"
                data-testid="embedded-signup-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="embedded-signup-password">Password</Label>
              <div className="relative">
                <Input
                  id="embedded-signup-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 8 characters"
                  className="pr-11"
                  data-testid="embedded-signup-password"
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
            {error && <AuthMessage kind="error">{error}</AuthMessage>}
            {notice && <AuthMessage>{notice}</AuthMessage>}
            <Button className="h-12 w-full" type="submit" disabled={!isLoaded || isSubmitting}>
              {!delayMessage && (isSubmitting || !isLoaded) ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : null}
              {!isLoaded
                ? "Preparing secure signup"
                : isSubmitting
                  ? delayMessage
                    ? "Signup is still processing"
                    : "Creating account"
                  : "Continue with email"}
            </Button>
          </form>
        )}

        {step === "profile" && (
          <form className="space-y-4" onSubmit={handleProfileSubmit} noValidate>
            {requiredProfileFields.includes("first_name") && (
              <div className="space-y-2">
                <Label htmlFor="embedded-signup-first-name">First name</Label>
                <Input
                  id="embedded-signup-first-name"
                  autoComplete="given-name"
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  required
                />
              </div>
            )}
            {requiredProfileFields.includes("last_name") && (
              <div className="space-y-2">
                <Label htmlFor="embedded-signup-last-name">Last name</Label>
                <Input
                  id="embedded-signup-last-name"
                  autoComplete="family-name"
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  required
                />
              </div>
            )}
            {requiredProfileFields.includes("legal_accepted") && (
              <label className="flex items-start gap-3 text-sm leading-relaxed">
                <input
                  className="mt-1"
                  type="checkbox"
                  checked={legalAccepted}
                  onChange={(event) => setLegalAccepted(event.target.checked)}
                />
                <span>
                  I agree to the{" "}
                  <a className="underline" href="/terms" target="_top">
                    Terms
                  </a>{" "}
                  and{" "}
                  <a className="underline" href="/privacy" target="_top">
                    Privacy Policy
                  </a>
                  .
                </span>
              </label>
            )}
            {error && <AuthMessage kind="error">{error}</AuthMessage>}
            <Button className="h-12 w-full" type="submit" disabled={isSubmitting}>
              {isSubmitting && !delayMessage ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : null}
              {isSubmitting ? (delayMessage ? "Still saving" : "Saving") : "Continue"}
            </Button>
          </form>
        )}

        {step === "verification" && (
          <form className="space-y-4" onSubmit={handleVerificationSubmit} noValidate>
            <div className="space-y-2">
              <Label htmlFor="embedded-signup-code">Six-digit code</Label>
              <Input
                id="embedded-signup-code"
                name="code"
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
                data-testid="embedded-signup-code"
              />
            </div>
            {error && <AuthMessage kind="error">{error}</AuthMessage>}
            {notice && <AuthMessage>{notice}</AuthMessage>}
            <Button className="h-12 w-full" type="submit" disabled={isSubmitting}>
              {isSubmitting && !delayMessage ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : null}
              {isSubmitting
                ? delayMessage
                  ? "Verification is still processing"
                  : "Verifying"
                : "Verify and open ScholarMark"}
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

        {step === "unsupported" && (
          <div className="space-y-4">
            {error && <AuthMessage kind="error">{error}</AuthMessage>}
            <Button className="h-12 w-full" asChild>
              <a href={portalUrl} target="_top">
                Continue secure account setup
              </a>
            </Button>
          </div>
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
                Retry secure signup
              </button>
            </div>
          )}
          <a
            className="font-semibold text-primary underline underline-offset-2"
            href={portalUrl}
            target="_top"
          >
            Use the secure hosted signup page
          </a>
          <p>
            Already have an account?{" "}
            <a
              className="font-semibold text-primary underline underline-offset-2"
              href={signInUrl}
              target="_top"
            >
              Sign in with email
            </a>
          </p>
          <p>
            Google sign-in is blocked by Instagram. To use Google, choose Open in browser from
            Instagram&apos;s menu.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function AuthMessage({
  children,
  kind = "notice",
}: {
  children: React.ReactNode;
  kind?: "notice" | "error";
}) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={
        kind === "error"
          ? "rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
          : "text-sm text-muted-foreground"
      }
    >
      {children}
    </div>
  );
}
