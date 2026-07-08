import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useRoute } from "wouter";
import { Check, ClipboardCopy, FileText, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { withRedirectUrl } from "@/lib/redirects";
import { useToast } from "@/hooks/use-toast";

const ATTRIBUTION_STORAGE_KEY = "scholarmark_campaign_attribution";
const VISIT_SESSION_KEY = "scholarmark_campaign_visit_sent";
const CLAIM_INTENT_KEY = "scholarmark_campaign_claim_intent";

interface CampaignAttribution {
  campus?: string;
  major?: string;
  channel?: string;
  inviteCode?: string;
  referredBy?: string;
}

interface SpotInfo {
  total: number;
  taken: number;
}

interface ClaimResult {
  alreadyClaimed: boolean;
  referralCode: string;
  taken: number;
  total: number;
}

function readAttribution(): CampaignAttribution {
  const params = new URLSearchParams(window.location.search);
  const fromUrl: CampaignAttribution = {
    campus: params.get("campus") ?? undefined,
    major: params.get("major") ?? undefined,
    channel: params.get("channel") ?? undefined,
    inviteCode: params.get("code") ?? undefined,
    referredBy: params.get("ref") ?? undefined,
  };

  let stored: CampaignAttribution = {};
  try {
    stored = JSON.parse(localStorage.getItem(ATTRIBUTION_STORAGE_KEY) ?? "{}");
  } catch {
    // Ignore corrupted storage
  }

  // Fresh URL params win over previously stored attribution
  const merged: CampaignAttribution = { ...stored };
  for (const key of ["campus", "major", "channel", "inviteCode", "referredBy"] as const) {
    if (fromUrl[key]) merged[key] = fromUrl[key];
  }
  return merged;
}

/** Mock annotated-paper visual: a quote being checked against its source. */
function VerifiedQuoteVisual() {
  return (
    <div className="relative mx-auto w-full max-w-sm select-none" aria-hidden>
      <div className="rounded-xl border bg-card shadow-lg p-5 space-y-3">
        <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-muted-foreground">
          senior-thesis-draft.docx
        </div>
        <div className="space-y-2">
          <div className="h-2 rounded bg-muted w-11/12" />
          <div className="h-2 rounded bg-muted w-full" />
          <div className="rounded-md bg-primary/15 border border-primary/30 px-3 py-2 text-xs leading-relaxed">
            &ldquo;the archive reveals a pattern earlier historians overlooked&rdquo;
          </div>
          <div className="h-2 rounded bg-muted w-10/12" />
          <div className="h-2 rounded bg-muted w-2/3" />
        </div>
      </div>
      <div className="absolute -right-2 -top-3 rounded-full border bg-background shadow-md px-3 py-1.5 flex items-center gap-1.5 text-xs font-medium text-primary">
        <ShieldCheck className="h-3.5 w-3.5" />
        Quote verified · p. 214
      </div>
      <div className="absolute -left-2 -bottom-3 rounded-full border border-destructive/40 bg-background shadow-md px-3 py-1.5 text-xs font-medium text-destructive">
        ✗ Fake citation caught
      </div>
    </div>
  );
}

export default function SummerCampaign() {
  const [, inviteParams] = useRoute("/invite/:code");
  const { isSignedIn, isLoaded } = useAuth();
  const { toast } = useToast();

  const attributionRef = useRef<CampaignAttribution>({});
  const [spots, setSpots] = useState<SpotInfo | null>(null);
  const [claim, setClaim] = useState<ClaimResult | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const claimSpot = useCallback(async () => {
    setClaiming(true);
    setError(null);
    try {
      const response = await fetch("/api/campaign/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(attributionRef.current),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body?.message ?? "Could not claim a spot. Please try again.");
        return;
      }
      setClaim(body as ClaimResult);
      setSpots({ total: body.total, taken: body.taken });
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setClaiming(false);
    }
  }, []);

  useEffect(() => {
    const merged = readAttribution();
    // A path-based code like /invite/maya counts as a referral
    if (inviteParams?.code) {
      merged.referredBy = inviteParams.code;
    }
    attributionRef.current = merged;
    try {
      localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // Storage unavailable — attribution still lives in the ref
    }

    // Record the link click once per browser session
    if (!sessionStorage.getItem(VISIT_SESSION_KEY)) {
      sessionStorage.setItem(VISIT_SESSION_KEY, "1");
      fetch("/api/campaign/visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...merged, landingPath: window.location.pathname }),
      }).catch(() => {
        // Tracking is best-effort; never block the page
      });
    }

    fetch("/api/campaign/spots")
      .then((response) => response.json())
      .then((body: SpotInfo) => setSpots(body))
      .catch(() => {
        // Counter is decorative; the page works without it
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Returning from sign-up with claim intent → finish the claim automatically
  useEffect(() => {
    if (isLoaded && isSignedIn && !claim && localStorage.getItem(CLAIM_INTENT_KEY)) {
      localStorage.removeItem(CLAIM_INTENT_KEY);
      void claimSpot();
    }
  }, [isLoaded, isSignedIn, claim, claimSpot]);

  const referralUrl = useMemo(() => {
    if (!claim) return "";
    return `${window.location.origin}/invite/${claim.referralCode}`;
  }, [claim]);

  const copyReferralLink = async () => {
    try {
      await navigator.clipboard.writeText(referralUrl);
      toast({ title: "Invite link copied", description: referralUrl });
    } catch {
      toast({
        title: "Copy failed",
        description: "Select and copy the link manually.",
        variant: "destructive",
      });
    }
  };

  const spotsLeft = spots ? Math.max(0, spots.total - spots.taken) : null;
  // Show the live count once it's meaningful; before that, just the cap.
  const showCount = spots !== null && spots.taken >= 10;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-primary" />
            <span className="font-sans uppercase tracking-[0.2em] font-bold text-primary text-sm">
              ScholarMark
            </span>
          </div>
          <Link href={withRedirectUrl("/sign-in", "/summer")}>
            <Button variant="ghost" size="sm">
              Sign in
            </Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center">
        <div className="container mx-auto px-4 py-12 max-w-5xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-14 items-center">
            {/* Message + CTA */}
            <div className="space-y-6 text-center md:text-left">
              <div className="text-xs font-mono uppercase tracking-[0.3em] text-muted-foreground">
                Summer early access
              </div>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight">
                Start your thesis this summer. Never cite a fake quote.
              </h1>
              <p className="text-muted-foreground">
                ScholarMark helps rising juniors and seniors plan, outline, and revise big
                research papers — and verifies every quote against the real source.
              </p>

              {claim ? (
                <div className="rounded-xl border border-primary/50 bg-card p-5 space-y-4 text-left">
                  <div className="flex items-center gap-2 font-semibold">
                    <span className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center">
                      <Check className="h-4 w-4 text-primary" />
                    </span>
                    {claim.alreadyClaimed ? "Your spot is already claimed" : "You're in"}
                  </div>
                  <Button asChild className="w-full" size="lg">
                    <Link href="/">Open ScholarMark</Link>
                  </Button>
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">
                      Know someone with a thesis next year? Your invite link:
                    </p>
                    <div className="flex gap-2">
                      <Input readOnly value={referralUrl} className="font-mono text-xs" />
                      <Button variant="outline" size="icon" onClick={copyReferralLink}>
                        <ClipboardCopy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {isSignedIn ? (
                    <Button size="lg" className="w-full md:w-auto" disabled={claiming} onClick={() => void claimSpot()}>
                      {claiming ? "Claiming..." : "Claim my spot — free"}
                    </Button>
                  ) : (
                    <Button size="lg" className="w-full md:w-auto" asChild>
                      <Link
                        href={withRedirectUrl("/sign-up", "/summer")}
                        onClick={() => {
                          try {
                            localStorage.setItem(CLAIM_INTENT_KEY, "1");
                          } catch {
                            // Best-effort; claim can still happen manually
                          }
                        }}
                      >
                        Claim my spot — free
                      </Link>
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">
                    One-tap sign up with Google. No forms.
                  </p>
                  {error ? <p className="text-sm text-destructive">{error}</p> : null}
                </div>
              )}

              {/* Live spot counter — real numbers only */}
              <div className="space-y-2 max-w-xs mx-auto md:mx-0">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Limited to {spots?.total ?? 100} spots</span>
                  {showCount && spots ? (
                    <span className="font-medium text-foreground">
                      {Math.min(spots.taken, spots.total)} claimed
                      {spotsLeft !== null && spotsLeft > 0 ? ` · ${spotsLeft} left` : ""}
                    </span>
                  ) : null}
                </div>
                <div className="h-1.5 rounded-full bg-border overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{
                      width: spots
                        ? `${Math.min(100, Math.round((spots.taken / spots.total) * 100))}%`
                        : "0%",
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Visual */}
            <VerifiedQuoteVisual />
          </div>
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="container mx-auto px-4 py-4 text-center text-xs text-muted-foreground">
          ScholarMark improves your own planning, writing, and revision — it doesn&apos;t write
          assignments for you.
        </div>
      </footer>
    </div>
  );
}
