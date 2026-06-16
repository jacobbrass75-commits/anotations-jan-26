import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { UserButton, useClerk } from "@clerk/clerk-react";
import { Link } from "wouter";
import {
  ArrowLeft,
  BookOpen,
  HardDrive,
  Link2,
  LogOut,
  MessageSquare,
  PenTool,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { isLocalDevAuthEnabled, useAuth, useUserTier } from "@/lib/auth";
import {
  formatAccountBytes,
  formatAccountDate,
  formatAccountTier,
  formatUsagePercent,
} from "@/lib/accountUtils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

interface UsageSnapshot {
  tokensUsed: number;
  tokenLimit: number;
  tokenPercent: number;
  storageUsed: number;
  storageLimit: number;
  storagePercent: number;
  tier: string;
  billingCycleStart: string | null;
}

const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || "support@scholarmark.ai";

const featureChecks = [
  { label: "Research chat", feature: "chat" as const },
  { label: "AI writing", feature: "writing" as const },
  { label: "Chrome extension", feature: "chrome_extension" as const },
  { label: "Vision OCR", feature: "vision_ocr" as const },
  { label: "Batch analysis", feature: "batch_analysis" as const },
  { label: "Source-verified drafting", feature: "source_verified" as const },
];

function ClerkHeaderControls({ onLogout }: { onLogout: () => void }) {
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="uppercase tracking-wider text-xs font-mono"
        onClick={onLogout}
        data-testid="button-sign-out"
      >
        <LogOut className="mr-2 h-4 w-4" />
        Sign Out
      </Button>
      <UserButton />
    </>
  );
}

function ClerkAccountCenterButton() {
  const clerk = useClerk();

  return (
    <Button
      className="uppercase tracking-wider text-xs font-mono"
      onClick={() => {
        const clerkWithProfile = clerk as typeof clerk & {
          openUserProfile?: () => void | Promise<void>;
        };
        void clerkWithProfile.openUserProfile?.();
      }}
      data-testid="button-open-account-center"
    >
      Open Account Center
    </Button>
  );
}

function formatSubscriptionStatus(status: string | null | undefined): string {
  if (!status) return "No active Stripe subscription";
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function Account() {
  const localDevAuth = isLocalDevAuthEnabled();
  const { user, isLoading, logout } = useAuth();
  const { can } = useUserTier();
  const [billingPortalLoading, setBillingPortalLoading] = useState(false);
  const [checkoutConfirmState, setCheckoutConfirmState] = useState<
    "idle" | "confirming" | "confirmed" | "error"
  >("idle");
  const [checkoutConfirmMessage, setCheckoutConfirmMessage] = useState("");
  const checkoutConfirmStartedRef = useRef(false);
  const checkoutReturn = useMemo(() => {
    if (typeof window === "undefined") {
      return { status: null, sessionId: null };
    }
    const params = new URLSearchParams(window.location.search);
    return {
      status: params.get("checkout"),
      sessionId: params.get("session_id"),
    };
  }, []);

  const { data: usage, isLoading: usageLoading } = useQuery<UsageSnapshot>({
    queryKey: ["/api/auth/usage"],
    queryFn: async () => {
      const response = await fetch("/api/auth/usage", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch account usage");
      }

      return response.json();
    },
  });

  const displayName = useMemo(() => {
    if (!user) return "ScholarMark User";
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
    return fullName || user.username || user.email;
  }, [user]);

  const tier = usage?.tier ?? user?.tier ?? "free";
  const tokenLimit = usage?.tokenLimit ?? user?.tokenLimit ?? 0;
  const tokensUsed = usage?.tokensUsed ?? user?.tokensUsed ?? 0;
  const storageLimit = usage?.storageLimit ?? user?.storageLimit ?? 0;
  const storageUsed = usage?.storageUsed ?? user?.storageUsed ?? 0;
  const tokenPercent = usage?.tokenPercent ?? formatUsagePercent(tokensUsed, tokenLimit);
  const storagePercent = usage?.storagePercent ?? formatUsagePercent(storageUsed, storageLimit);
  const billingCycleStart = usage?.billingCycleStart ?? user?.billingCycleStart ?? null;
  const hasStripeCustomer = Boolean(user?.stripeCustomerId);
  const subscriptionStatus = formatSubscriptionStatus(user?.subscriptionStatus);
  const subscriptionPeriodLabel = user?.subscriptionCurrentPeriodEnd
    ? user.cancelAtPeriodEnd
      ? `Paid access ends ${formatAccountDate(user.subscriptionCurrentPeriodEnd)}`
      : `Renews ${formatAccountDate(user.subscriptionCurrentPeriodEnd)}`
    : "Period end not available";

  useEffect(() => {
    if (
      checkoutReturn.status !== "success" ||
      checkoutConfirmStartedRef.current ||
      isLoading ||
      !user
    ) {
      return;
    }

    checkoutConfirmStartedRef.current = true;
    if (!checkoutReturn.sessionId) {
      setCheckoutConfirmState("error");
      setCheckoutConfirmMessage(
        `Stripe returned without a session id. Email ${SUPPORT_EMAIL} and we will sync the account.`,
      );
      return;
    }

    let cancelled = false;
    setCheckoutConfirmState("confirming");
    setCheckoutConfirmMessage("Confirming your Stripe subscription...");

    async function confirmCheckout() {
      try {
        const response = await apiRequest("POST", "/api/billing/stripe/checkout/confirm", {
          sessionId: checkoutReturn.sessionId,
        });
        const body = (await response.json()) as { tier?: string; subscriptionStatus?: string | null };
        await queryClient.invalidateQueries();
        await queryClient.refetchQueries({ queryKey: ["/api/auth/me"] });
        await queryClient.refetchQueries({ queryKey: ["/api/auth/usage"] });
        if (!cancelled) {
          setCheckoutConfirmState("confirmed");
          setCheckoutConfirmMessage(
            `Subscription confirmed${body.tier ? `: ${formatAccountTier(body.tier)} plan` : ""}.`,
          );
        }
      } catch (error) {
        console.error("[billing] checkout confirmation failed", error);
        if (!cancelled) {
          setCheckoutConfirmState("error");
          setCheckoutConfirmMessage(
            `Checkout completed, but automatic sync failed. Email ${SUPPORT_EMAIL} and we will fix access.`,
          );
        }
      }
    }

    void confirmCheckout();
    return () => {
      cancelled = true;
    };
  }, [checkoutReturn.sessionId, checkoutReturn.status, isLoading, user]);

  async function openBillingPortal() {
    try {
      setBillingPortalLoading(true);
      const response = await apiRequest("POST", "/api/billing/stripe/portal");
      const body = (await response.json()) as { url?: string };
      if (body.url) {
        window.location.assign(body.url);
      }
    } finally {
      setBillingPortalLoading(false);
    }
  }

  if (isLoading || usageLoading || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center eva-grid-bg">
        <div className="space-y-3 text-center">
          <div className="text-xs font-mono uppercase tracking-[0.3em] text-muted-foreground">
            Loading Account
          </div>
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon" data-testid="button-back-home">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <BookOpen className="h-5 w-5 text-primary" />
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.28em] text-muted-foreground">
                Account Console
              </div>
              <div className="text-sm font-sans uppercase tracking-[0.16em] text-primary">
                User Control Surface
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/pricing">
              <Button
                variant="outline"
                size="sm"
                className="uppercase tracking-wider text-xs font-mono"
                data-testid="button-manage-plan"
              >
                Manage Plan
              </Button>
            </Link>
            {localDevAuth ? (
              <Badge variant="secondary" className="uppercase tracking-wider text-[10px] font-mono">
                Local Dev Auth
              </Badge>
            ) : (
              <ClerkHeaderControls onLogout={logout} />
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 pb-8 space-y-6 eva-grid-bg">
        {checkoutConfirmState !== "idle" ? (
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${
              checkoutConfirmState === "error"
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-primary/30 bg-primary/10 text-foreground"
            }`}
          >
            {checkoutConfirmMessage}
          </div>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
          <Card className="eva-clip-panel eva-corner-decor border-border bg-card/80">
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="eva-section-title">Identity</div>
                  <CardTitle className="mt-2 text-3xl font-sans uppercase tracking-[0.12em] text-primary">
                    {displayName}
                  </CardTitle>
                  <CardDescription className="mt-2 text-sm font-mono">{user.email}</CardDescription>
                </div>
                <Badge variant="outline">{formatAccountTier(tier)} Plan</Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-border bg-background/50 p-4 space-y-2">
                <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-muted-foreground">
                  Account Status
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  <span>{user.emailVerified ? "Email verified" : "Verification pending"}</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  Member since {formatAccountDate(user.createdAt)}
                </div>
                <div className="text-sm text-muted-foreground">
                  Billing cycle started {formatAccountDate(billingCycleStart)}
                </div>
                <div className="text-sm text-muted-foreground">
                  Stripe status: {subscriptionStatus}
                </div>
                {hasStripeCustomer ? (
                  <div className="text-sm text-muted-foreground">{subscriptionPeriodLabel}</div>
                ) : null}
              </div>

              <div className="rounded-lg border border-border bg-background/50 p-4 space-y-3">
                <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-muted-foreground">
                  Quick Actions
                </div>
                <div className="grid gap-2">
                  <Link href="/projects">
                    <Button
                      variant="outline"
                      className="w-full justify-start uppercase tracking-wider text-xs font-mono"
                      data-testid="button-open-projects"
                    >
                      <UserRound className="mr-2 h-4 w-4" />
                      Open Projects
                    </Button>
                  </Link>
                  <Link href="/write">
                    <Button
                      variant="outline"
                      className="w-full justify-start uppercase tracking-wider text-xs font-mono"
                      data-testid="button-open-writing"
                    >
                      <PenTool className="mr-2 h-4 w-4" />
                      Writing Studio
                    </Button>
                  </Link>
                  <Link href="/web-clips">
                    <Button
                      variant="outline"
                      className="w-full justify-start uppercase tracking-wider text-xs font-mono"
                      data-testid="button-open-web-clips"
                    >
                      <Link2 className="mr-2 h-4 w-4" />
                      Web Clips
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="eva-clip-panel eva-corner-decor border-border bg-card/80">
            <CardHeader>
              <div className="eva-section-title">Access Matrix</div>
              <CardTitle className="mt-2 text-2xl font-sans uppercase tracking-[0.12em] text-primary">
                Feature Access
              </CardTitle>
              <CardDescription>
                This reflects the current plan and feature gates enforced in the app.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {featureChecks.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between rounded-lg border border-border bg-background/50 px-4 py-3"
                >
                  <span className="text-sm">{item.label}</span>
                  <Badge variant={can(item.feature) ? "default" : "outline"}>
                    {can(item.feature) ? "Enabled" : "Upgrade Needed"}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Card className="eva-clip-panel eva-corner-decor border-border bg-card/80">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <div className="eva-section-title">Usage</div>
              </div>
              <CardTitle className="mt-2 text-2xl font-sans uppercase tracking-[0.12em] text-primary">
                Token Budget
              </CardTitle>
              <CardDescription>
                {tokensUsed.toLocaleString()} of {tokenLimit.toLocaleString()} AI tokens used
                this cycle.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Progress value={tokenPercent} className="h-3" />
              <div className="flex items-center justify-between text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">
                <span>{tokenPercent}% Consumed</span>
                <span>{Math.max(tokenLimit - tokensUsed, 0).toLocaleString()} Remaining</span>
              </div>
            </CardContent>
          </Card>

          <Card className="eva-clip-panel eva-corner-decor border-border bg-card/80">
            <CardHeader>
              <div className="flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-primary" />
                <div className="eva-section-title">Storage</div>
              </div>
              <CardTitle className="mt-2 text-2xl font-sans uppercase tracking-[0.12em] text-primary">
                Document Capacity
              </CardTitle>
              <CardDescription>
                {formatAccountBytes(storageUsed)} of {formatAccountBytes(storageLimit)} currently in
                use.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Progress value={storagePercent} className="h-3" />
              <div className="flex items-center justify-between text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">
                <span>{storagePercent}% Allocated</span>
                <span>{formatAccountBytes(Math.max(storageLimit - storageUsed, 0))} Free</span>
              </div>
            </CardContent>
          </Card>
        </section>

        <Card className="eva-clip-panel eva-corner-decor border-border bg-card/80">
          <CardHeader>
            <div className="eva-section-title">Management</div>
            <CardTitle className="mt-2 text-2xl font-sans uppercase tracking-[0.12em] text-primary">
              Account Controls
            </CardTitle>
            <CardDescription>
              Use the Billing Portal to update payment details, change plans, or cancel Stripe
              subscriptions. Cancellation stops future renewals; paid access continues through the
              current billing period unless a refund is issued.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Link href="/pricing">
                <Button
                  className="uppercase tracking-wider text-xs font-mono"
                  data-testid="button-go-pricing"
                >
                  Manage Pricing
                </Button>
              </Link>
              <Button
                variant="outline"
                className="uppercase tracking-wider text-xs font-mono"
                disabled={!hasStripeCustomer || billingPortalLoading}
                onClick={() => void openBillingPortal()}
                data-testid="button-open-billing-portal"
              >
                {billingPortalLoading ? "Opening Billing" : "Billing Portal"}
              </Button>
              <Link href="/extension-auth">
                <Button
                  variant="outline"
                  className="uppercase tracking-wider text-xs font-mono"
                  data-testid="button-go-extension-auth"
                >
                  Extension Access
                </Button>
              </Link>
              <Link href="/chat">
                <Button
                  variant="outline"
                  className="uppercase tracking-wider text-xs font-mono"
                  data-testid="button-go-chat"
                >
                  <MessageSquare className="mr-2 h-4 w-4" />
                  Open Chat
                </Button>
              </Link>
            </div>
            {!hasStripeCustomer ? (
              <div className="rounded-lg border border-border bg-background/50 p-4 text-sm text-muted-foreground">
                Paid with Venmo or PayPal? Email support@scholarmark.ai to cancel or adjust access.
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="eva-clip-panel eva-corner-decor border-border bg-card/80 overflow-hidden">
          <CardHeader>
            <div className="eva-section-title">Profile Management</div>
            <CardTitle className="mt-2 text-2xl font-sans uppercase tracking-[0.12em] text-primary">
              Identity And Security
            </CardTitle>
            <CardDescription>
              {localDevAuth
                ? "Local dev auth bypass is active for this restored demo session."
                : "Open the Clerk-managed account center to update your email, password, profile details, and security settings."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-border bg-background/50 p-4 text-sm text-muted-foreground">
              {localDevAuth
                ? "The app is using the restored local account directly, so Clerk profile management is intentionally disabled."
                : "This keeps authentication and identity updates inside the existing Clerk flow instead of duplicating sensitive account-management forms in the app."}
            </div>
            {localDevAuth ? (
              <Button
                className="uppercase tracking-wider text-xs font-mono"
                disabled
                data-testid="button-open-account-center-disabled"
              >
                Local Auth Active
              </Button>
            ) : (
              <ClerkAccountCenterButton />
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
