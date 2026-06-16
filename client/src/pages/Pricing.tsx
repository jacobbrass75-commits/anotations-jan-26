import { useCallback, useEffect, useRef, useState } from "react";
import { isLocalDevAuthEnabled, useAuth } from "@/lib/auth";
import { UserButton } from "@clerk/clerk-react";
import { Link, useLocation } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { withRedirectUrl } from "@/lib/redirects";

const VENMO_HANDLE = normalizeVenmoHandle(import.meta.env.VITE_VENMO_HANDLE);
const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || "support@scholarmark.ai";

interface TierFeature {
  label: string;
  free: string;
  pro: string;
  max: string;
}

interface PayPalBillingConfig {
  enabled: boolean;
  clientId: string | null;
  environment: "sandbox" | "live";
  currency: string;
}

interface StripeBillingConfig {
  enabled: boolean;
  currency: string;
}

interface StripeCheckoutResponse {
  url?: string;
  code?: string;
  action?: string;
  message?: string;
}

interface PayPalButtonsInstance {
  render: (element: HTMLElement) => Promise<void>;
  close?: () => void;
  isEligible?: () => boolean;
}

interface PayPalNamespace {
  FUNDING: {
    VENMO: string;
  };
  Buttons: (options: Record<string, unknown>) => PayPalButtonsInstance;
}

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

const features: TierFeature[] = [
  { label: "Sources", free: "5 active", pro: "50 active", max: "No set count limit" },
  { label: "Projects", free: "1", pro: "10", max: "No set count limit" },
  { label: "Storage", free: "50 MB", pro: "500 MB", max: "5 GB" },
  {
    label: "Citations",
    free: "Chicago",
    pro: "Chicago, MLA 9, APA 7",
    max: "Chicago, MLA 9, APA 7",
  },
  { label: "OCR", free: "PaddleOCR", pro: "GPT-4o-mini Vision", max: "GPT-4o Vision" },
  { label: "AI chat", free: "Limited", pro: "Yes", max: "Yes" },
  { label: "AI token budget/mo", free: "50K", pro: "500K", max: "2M" },
  {
    label: "AI Writing",
    free: "Quick Draft limited",
    pro: "Quick Draft",
    max: "Quick Draft + Deep Write",
  },
  {
    label: "Source verification",
    free: "Included",
    pro: "Included",
    max: "Included",
  },
  { label: "Export", free: "---", pro: "DOCX / PDF", max: "DOCX / PDF" },
  { label: "Chrome Extension", free: "---", pro: "Yes", max: "Yes" },
  { label: "Bibliography Gen", free: "---", pro: "Yes", max: "Yes" },
  { label: "En-dash Toggle", free: "---", pro: "Yes", max: "Yes" },
];

let paypalSdkPromise: Promise<void> | null = null;

function normalizeVenmoHandle(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\/(?:www\.)?venmo\.com\/(?:u\/)?/i, "")
    .split(/[/?#]/)[0]
    .trim();
}

function buildVenmoUrl(amount: string, label: string, accountRef: string): string {
  const params = new URLSearchParams({
    txn: "pay",
    amount,
    note: `ScholarMark ${label} - ${accountRef}`,
  });
  return `https://venmo.com/u/${VENMO_HANDLE}?${params.toString()}`;
}

function VenmoButton({
  amount,
  label,
  accountRef,
  isSignedIn,
  onSignIn,
}: {
  amount: string;
  label: string;
  accountRef: string | null;
  isSignedIn: boolean;
  onSignIn: () => void;
}) {
  if (!isSignedIn) {
    return (
      <Button className="w-full" onClick={onSignIn}>
        Create account to upgrade
      </Button>
    );
  }

  if (!VENMO_HANDLE) {
    return (
      <Button asChild className="w-full" variant="outline">
        <a href={`mailto:${SUPPORT_EMAIL}?subject=ScholarMark%20${label}%20Upgrade`}>
          Contact support to upgrade
        </a>
      </Button>
    );
  }

  const venmoUrl = buildVenmoUrl(amount, label, accountRef || "account email missing");
  return (
    <Button asChild className="w-full">
      <a href={venmoUrl} target="_blank" rel="noopener noreferrer">
        Pay ${amount} with Venmo
      </a>
    </Button>
  );
}

function loadPayPalSdk(config: PayPalBillingConfig): Promise<void> {
  if (window.paypal) {
    return Promise.resolve();
  }
  if (paypalSdkPromise) {
    return paypalSdkPromise;
  }

  paypalSdkPromise = new Promise((resolve, reject) => {
    if (!config.clientId) {
      reject(new Error("PayPal client ID is missing"));
      return;
    }

    const params = new URLSearchParams({
      "client-id": config.clientId,
      currency: config.currency || "USD",
      intent: "capture",
      components: "buttons",
      "enable-funding": "venmo",
    });
    if (config.environment === "sandbox") {
      params.set("buyer-country", "US");
    }

    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?${params.toString()}`;
    script.async = true;
    script.dataset.scholarPayPalSdk = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load PayPal checkout"));
    document.head.appendChild(script);
  });

  return paypalSdkPromise;
}

function AutomatedVenmoButton({
  tier,
  config,
  isSignedIn,
  onSignIn,
  onComplete,
}: {
  tier: "pro" | "max";
  config: PayPalBillingConfig;
  isSignedIn: boolean;
  onSignIn: () => void;
  onComplete: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "processing" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!isSignedIn || !config.enabled || !container) {
      return;
    }

    let cancelled = false;
    let buttons: PayPalButtonsInstance | null = null;
    setStatus("loading");
    setError(null);

    loadPayPalSdk(config)
      .then(() => {
        if (cancelled || !window.paypal) return;

        buttons = window.paypal.Buttons({
          fundingSource: window.paypal.FUNDING.VENMO,
          style: {
            layout: "vertical",
            height: 45,
            shape: "rect",
          },
          createOrder: async () => {
            const response = await apiRequest("POST", "/api/billing/paypal/orders", { tier });
            const body = (await response.json()) as { orderId?: string };
            if (!body.orderId) {
              throw new Error("PayPal order was not created");
            }
            return body.orderId;
          },
          onApprove: async (data: { orderID?: string }) => {
            if (!data.orderID) {
              throw new Error("PayPal approval did not include an order ID");
            }
            setStatus("processing");
            const response = await apiRequest(
              "POST",
              `/api/billing/paypal/orders/${encodeURIComponent(data.orderID)}/capture`,
            );
            const body = (await response.json()) as { completed?: boolean; status?: string };
            if (!body.completed) {
              throw new Error(`Payment was not completed (${body.status ?? "unknown"})`);
            }
            await queryClient.invalidateQueries();
            onComplete();
          },
          onError: (err: unknown) => {
            console.error("[billing] PayPal checkout error", err);
            setError("Venmo checkout failed. Try again or use manual Venmo.");
            setStatus("error");
          },
        });

        if (buttons.isEligible && !buttons.isEligible()) {
          setError(
            "Venmo checkout is not available on this device/browser. Use manual Venmo instead.",
          );
          setStatus("error");
          return;
        }

        container.innerHTML = "";
        buttons
          .render(container)
          .then(() => {
            if (!cancelled) setStatus("ready");
          })
          .catch((err) => {
            console.error("[billing] PayPal button render error", err);
            if (!cancelled) {
              setError("Could not show Venmo checkout. Use manual Venmo instead.");
              setStatus("error");
            }
          });
      })
      .catch((err) => {
        console.error("[billing] PayPal SDK load error", err);
        if (!cancelled) {
          setError("Could not load Venmo checkout. Use manual Venmo instead.");
          setStatus("error");
        }
      });

    return () => {
      cancelled = true;
      buttons?.close?.();
      container.innerHTML = "";
    };
  }, [config, isSignedIn, onComplete, tier]);

  if (!isSignedIn) {
    return (
      <Button className="w-full" onClick={onSignIn}>
        Create account to upgrade
      </Button>
    );
  }

  return (
    <div className="w-full space-y-2">
      <div ref={containerRef} className="min-h-[45px] w-full" />
      {status === "loading" && (
        <Button className="w-full" disabled>
          Loading Venmo checkout...
        </Button>
      )}
      {status === "processing" && (
        <Button className="w-full" disabled>
          Upgrading account...
        </Button>
      )}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

async function openStripeBillingPortal(): Promise<void> {
  const response = await apiRequest("POST", "/api/billing/stripe/portal");
  const body = (await response.json()) as { url?: string };
  if (!body.url) {
    throw new Error("Stripe billing portal did not return a URL");
  }
  window.location.assign(body.url);
}

function StripeCheckoutButton({
  tier,
  amount,
  label,
  isSignedIn,
  hasActiveStripeSubscription,
  onSignIn,
}: {
  tier: "pro" | "max";
  amount: string;
  label: string;
  isSignedIn: boolean;
  hasActiveStripeSubscription: boolean;
  onSignIn: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "portal" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  if (!isSignedIn) {
    return (
      <Button className="w-full" onClick={onSignIn}>
        Create account to start {label}
      </Button>
    );
  }

  const loading = status === "loading" || status === "portal";
  const buttonText = hasActiveStripeSubscription
    ? status === "portal"
      ? "Opening Billing Portal..."
      : `Change to ${label} in Billing Portal`
    : status === "loading"
      ? "Opening checkout..."
      : `Subscribe to ${label} for $${amount}/mo`;

  return (
    <div className="w-full space-y-2">
      <Button
        className="w-full"
        disabled={loading}
        onClick={async () => {
          try {
            setError(null);
            if (hasActiveStripeSubscription) {
              setStatus("portal");
              await openStripeBillingPortal();
              return;
            }

            setStatus("loading");
            const response = await fetch("/api/billing/stripe/checkout", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ tier }),
            });
            const body = (await response.json().catch(() => ({}))) as StripeCheckoutResponse;
            if (
              response.status === 409 &&
              body.code === "active_subscription_exists" &&
              body.action === "billing_portal"
            ) {
              setStatus("portal");
              await openStripeBillingPortal();
              return;
            }
            if (!response.ok) {
              throw new Error(body.message || "Stripe checkout could not open");
            }
            if (!body.url) {
              throw new Error("Stripe checkout did not return a URL");
            }
            window.location.assign(body.url);
          } catch (err) {
            console.error("[billing] Stripe checkout error", err);
            setError(`Checkout could not open. Try again or email ${SUPPORT_EMAIL}.`);
            setStatus("error");
          }
        }}
      >
        {buttonText}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function PlanCheckoutButton({
  tier,
  amount,
  label,
  accountRef,
  isSignedIn,
  hasActiveStripeSubscription,
  stripeConfig,
  paypalConfig,
  onSignIn,
  onComplete,
}: {
  tier: "pro" | "max";
  amount: string;
  label: string;
  accountRef: string | null;
  isSignedIn: boolean;
  hasActiveStripeSubscription: boolean;
  stripeConfig: StripeBillingConfig | null;
  paypalConfig: PayPalBillingConfig | null;
  onSignIn: (tier: "pro" | "max") => void;
  onComplete: () => void;
}) {
  if (stripeConfig === null || paypalConfig === null) {
    return (
      <Button className="w-full" disabled>
        Loading checkout...
      </Button>
    );
  }

  if (stripeConfig.enabled) {
    return (
      <StripeCheckoutButton
        tier={tier}
        amount={amount}
        label={label}
        isSignedIn={isSignedIn}
        hasActiveStripeSubscription={hasActiveStripeSubscription}
        onSignIn={() => onSignIn(tier)}
      />
    );
  }

  if (paypalConfig.enabled) {
    return (
      <AutomatedVenmoButton
        tier={tier}
        config={paypalConfig}
        isSignedIn={isSignedIn}
        onSignIn={() => onSignIn(tier)}
        onComplete={onComplete}
      />
    );
  }

  return (
    <VenmoButton
      amount={amount}
      label={label}
      accountRef={accountRef}
      isSignedIn={isSignedIn}
      onSignIn={() => onSignIn(tier)}
    />
  );
}

export default function Pricing() {
  const localDevAuth = isLocalDevAuthEnabled();
  const { user, isSignedIn } = useAuth();
  const [, setLocation] = useLocation();
  const currentTier = user?.tier ?? "free";
  const hasActiveStripeSubscription = Boolean(
    user?.stripeCustomerId &&
    user?.stripeSubscriptionId &&
    ["active", "trialing", "past_due"].includes(user.subscriptionStatus || ""),
  );
  const accountRef = user?.email || user?.id || null;
  const checkoutStatus =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("checkout")
      : null;
  const [stripeConfig, setStripeConfig] = useState<StripeBillingConfig | null>(null);
  const [paypalConfig, setPayPalConfig] = useState<PayPalBillingConfig | null>(null);
  const handleSignIn = useCallback(
    (tier: "pro" | "max" = "pro") => {
      const redirectUrl = `/pricing?tier=${tier}&source=upgrade`;
      setLocation(withRedirectUrl("/sign-in", redirectUrl));
    },
    [setLocation],
  );
  const handleCheckoutComplete = useCallback(() => setLocation("/account"), [setLocation]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/billing/stripe/config", { credentials: "include" })
        .then((response) => response.json())
        .catch((error) => {
          console.error("[billing] failed to load Stripe config", error);
          return {
            enabled: false,
            currency: "USD",
          } satisfies StripeBillingConfig;
        }),
      fetch("/api/billing/paypal/config", { credentials: "include" })
        .then((response) => response.json())
        .catch((error) => {
          console.error("[billing] failed to load PayPal config", error);
          return {
            enabled: false,
            clientId: null,
            environment: "live",
            currency: "USD",
          } satisfies PayPalBillingConfig;
        }),
    ]).then(([stripe, paypal]: [StripeBillingConfig, PayPalBillingConfig]) => {
      if (!cancelled) {
        setStripeConfig(stripe);
        setPayPalConfig(paypal);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">ScholarMark Pricing</h1>
            <p className="text-muted-foreground mt-1">
              Choose the plan that fits your research needs
            </p>
          </div>
          <div className="flex items-center gap-3">
            {isSignedIn ? (
              <>
                <Button
                  variant="ghost"
                  onClick={() => setLocation("/account")}
                  data-testid="button-open-account"
                >
                  Account
                </Button>
                <Button variant="ghost" onClick={() => setLocation("/")}>
                  Dashboard
                </Button>
                {!localDevAuth ? <UserButton /> : null}
              </>
            ) : (
              <Button onClick={() => setLocation(withRedirectUrl("/sign-in", "/pricing"))}>
                Sign In
              </Button>
            )}
          </div>
        </div>

        {checkoutStatus === "cancelled" ? (
          <div className="mb-6 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            Checkout was cancelled. No plan change was made. You can retry below or email{" "}
            <a
              className="text-primary underline-offset-4 hover:underline"
              href={`mailto:${SUPPORT_EMAIL}`}
            >
              {SUPPORT_EMAIL}
            </a>
            .
          </div>
        ) : null}

        {/* Tier Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {/* Free */}
          <Card className={currentTier === "free" ? "border-primary" : ""}>
            <CardHeader>
              <CardTitle>Free</CardTitle>
              <CardDescription>Get started with the basics</CardDescription>
              <div className="text-3xl font-bold mt-2">
                $0<span className="text-sm font-normal text-muted-foreground">/mo</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>5 active sources</p>
              <p>1 project</p>
              <p>50 MB storage</p>
              <p>Chicago citation formatting</p>
              <p>PaddleOCR</p>
              <p>50K AI token budget/mo</p>
              <p>Limited Haiku chat and Sonnet Quick Draft</p>
              <p>Source verification included</p>
            </CardContent>
            <CardFooter>
              {currentTier === "free" ? (
                <Button className="w-full" variant="outline" disabled>
                  Current Plan
                </Button>
              ) : (
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => setLocation("/sign-up")}
                >
                  Sign Up Free
                </Button>
              )}
            </CardFooter>
          </Card>

          {/* Pro */}
          <Card
            className={`border-2 ${currentTier === "pro" ? "border-primary" : "border-primary/50"}`}
          >
            <CardHeader>
              <div className="text-xs font-semibold uppercase text-primary mb-1">Most Popular</div>
              <CardTitle>Pro</CardTitle>
              <CardDescription>For serious researchers</CardDescription>
              <div className="text-3xl font-bold mt-2">
                $14<span className="text-sm font-normal text-muted-foreground">/mo</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>50 active sources</p>
              <p>10 projects</p>
              <p>500 MB storage</p>
              <p>Chicago, MLA 9, and APA 7 citation formatting</p>
              <p>GPT-4o-mini Vision OCR</p>
              <p>500K AI token budget/mo</p>
              <p>AI writing: Quick Draft</p>
              <p>Source verification included</p>
              <p>DOCX/PDF export</p>
              <p>Chrome extension</p>
              <p>Bibliography generation</p>
            </CardContent>
            <CardFooter>
              {currentTier === "pro" ? (
                <Button className="w-full" disabled>
                  Current Plan
                </Button>
              ) : (
                <PlanCheckoutButton
                  tier="pro"
                  amount="14"
                  label="Pro"
                  accountRef={accountRef}
                  isSignedIn={isSignedIn}
                  hasActiveStripeSubscription={hasActiveStripeSubscription}
                  stripeConfig={stripeConfig}
                  paypalConfig={paypalConfig}
                  onSignIn={handleSignIn}
                  onComplete={handleCheckoutComplete}
                />
              )}
            </CardFooter>
          </Card>

          {/* Max */}
          <Card className={currentTier === "max" ? "border-primary" : ""}>
            <CardHeader>
              <CardTitle>Max</CardTitle>
              <CardDescription>Higher limits for your thesis</CardDescription>
              <div className="text-3xl font-bold mt-2">
                $50<span className="text-sm font-normal text-muted-foreground">/mo</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>No set source/project count limit</p>
              <p>5 GB storage</p>
              <p>Chicago, MLA 9, and APA 7 citation formatting</p>
              <p>GPT-4o Vision OCR</p>
              <p>2M AI token budget/mo</p>
              <p>Quick Draft + Deep Write</p>
              <p>Higher limits for source-grounded drafting</p>
              <p>DOCX/PDF export</p>
              <p>Everything in Pro</p>
            </CardContent>
            <CardFooter>
              {currentTier === "max" ? (
                <Button className="w-full" disabled>
                  Current Plan
                </Button>
              ) : (
                <PlanCheckoutButton
                  tier="max"
                  amount="50"
                  label="Max"
                  accountRef={accountRef}
                  isSignedIn={isSignedIn}
                  hasActiveStripeSubscription={hasActiveStripeSubscription}
                  stripeConfig={stripeConfig}
                  paypalConfig={paypalConfig}
                  onSignIn={handleSignIn}
                  onComplete={handleCheckoutComplete}
                />
              )}
            </CardFooter>
          </Card>
        </div>

        {/* Feature Comparison Table */}
        <h2 className="text-xl font-semibold mb-4">Full Feature Comparison</h2>
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left p-3 font-medium">Feature</th>
                <th className="text-center p-3 font-medium">Free</th>
                <th className="text-center p-3 font-medium">Pro ($14/mo)</th>
                <th className="text-center p-3 font-medium">Max ($50/mo)</th>
              </tr>
            </thead>
            <tbody>
              {features.map((f, i) => (
                <tr key={f.label} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                  <td className="p-3 font-medium">{f.label}</td>
                  <td className="p-3 text-center text-muted-foreground">{f.free}</td>
                  <td className="p-3 text-center">{f.pro}</td>
                  <td className="p-3 text-center">{f.max}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 rounded-lg border border-border bg-muted/30 px-4 py-4 text-xs leading-6 text-muted-foreground">
          Prices are in USD. Stripe checkout starts a monthly subscription that renews until
          canceled. Venmo or PayPal payments, when offered, provide one month of access unless
          ScholarMark confirms otherwise. By subscribing, you agree to the{" "}
          <Link href="/terms" className="text-primary underline-offset-4 hover:underline">
            Terms
          </Link>{" "}
          and acknowledge the{" "}
          <Link href="/privacy" className="text-primary underline-offset-4 hover:underline">
            Privacy Policy
          </Link>
          .
        </div>
      </div>
    </div>
  );
}
