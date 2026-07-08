import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useRoute } from "wouter";
import {
  Check,
  ClipboardCopy,
  FileText,
  FolderOpen,
  ListChecks,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
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

const sourceRows = [
  { title: "archive-interviews.pdf", meta: "12 quotes", tone: "primary" },
  { title: "city-budget-1974.pdf", meta: "8 notes", tone: "secondary" },
  { title: "journal-review.md", meta: "5 claims", tone: "success" },
  { title: "oral-history-transcript", meta: "19 clips", tone: "muted" },
  { title: "bibliography-final.ris", meta: "42 refs", tone: "muted" },
];

const draftSections = [
  "Intro claim",
  "Source context",
  "Counterargument",
  "Quote check",
  "Revision pass",
];

function CampaignWorkspaceVisual() {
  return (
    <div className="relative mx-auto w-full max-w-4xl select-none lg:mx-0" aria-hidden>
      <div className="overflow-hidden rounded-2xl border bg-card shadow-xl">
        <div className="relative h-56 overflow-hidden border-b sm:h-72 lg:h-80">
          <img
            src="/campaign-assets/summer-source-bank-hero.png"
            alt=""
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-background/5 via-background/15 to-background/65" />
          <div className="absolute bottom-4 right-4 max-w-xs rounded-xl border bg-background/90 p-3 shadow-lg backdrop-blur">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <FolderOpen className="h-3.5 w-3.5 text-primary" />
              Pull from your source bank
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Quotes, notes, web clips, and citations stay attached to the draft.
            </p>
          </div>
        </div>

        <div className="grid gap-0 lg:grid-cols-[0.95fr_1.35fr]">
          <div className="border-b bg-background/40 p-4 lg:border-b-0 lg:border-r">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold">Source organizer</div>
                <div className="text-[10px] text-muted-foreground">Group, tag, and pull quotes</div>
              </div>
              <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">
                86 items
              </span>
            </div>
            <div className="space-y-2">
              {sourceRows.map((source, index) => (
                <div
                  key={source.title}
                  className="flex items-center justify-between rounded-lg border bg-card/80 px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        source.tone === "primary"
                          ? "bg-primary"
                          : source.tone === "secondary"
                            ? "bg-secondary"
                            : source.tone === "success"
                              ? "bg-success"
                              : "bg-muted-foreground/35"
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium">{source.title}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {index < 2 ? "Evidence" : index === 2 ? "Background" : "Reference"}
                      </div>
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{source.meta}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4 p-4 md:p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border bg-background/60 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
                  <ListChecks className="h-3.5 w-3.5 text-primary" />
                  Writing plan
                </div>
                <div className="space-y-2">
                  {draftSections.map((section, index) => (
                    <div key={section} className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px]">
                        {index + 1}
                      </span>
                      <div className="h-2 flex-1 rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary/70"
                          style={{ width: `${92 - index * 13}%` }}
                        />
                      </div>
                      <span className="w-24 text-[10px] text-muted-foreground">{section}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border bg-background/60 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
                  <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
                  Draft controls
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between rounded-lg bg-card px-3 py-2 text-xs">
                    <span>Remove em dashes</span>
                    <span className="rounded-full bg-success/15 px-2 py-0.5 font-medium text-success">
                      On
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-card px-3 py-2 text-xs">
                    <span>Citation style</span>
                    <span className="font-medium text-primary">Chicago</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-card px-3 py-2 text-xs">
                    <span>Source-backed only</span>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                      Strict
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative rounded-xl border bg-background/70 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  senior-thesis-draft.docx
                </div>
                <div className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-primary">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Quote verified - p. 214
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-2 rounded bg-muted w-11/12" />
                <div className="h-2 rounded bg-muted w-full" />
                <div className="rounded-lg border border-primary/30 bg-primary/15 px-3 py-2 text-xs leading-relaxed">
                  "the archive reveals a pattern earlier historians overlooked"
                </div>
                <div className="h-2 rounded bg-muted w-10/12" />
                <div className="h-2 rounded bg-muted w-2/3" />
              </div>
              <div className="absolute -bottom-3 left-5 rounded-full border border-destructive/40 bg-background px-3 py-1.5 text-xs font-medium text-destructive shadow-md">
                Fake citation caught
              </div>
            </div>
          </div>
        </div>
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

      <main className="flex-1">
        <div className="container mx-auto flex min-h-[calc(100svh-5.5rem)] max-w-7xl flex-col justify-center px-4 py-10 md:px-6 lg:py-14 xl:max-w-[86rem]">
          <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,0.82fr)_minmax(560px,1.18fr)] xl:gap-16">
            {/* Message + CTA */}
            <div className="space-y-6 text-center lg:text-left">
              <div className="text-xs font-mono uppercase tracking-[0.3em] text-muted-foreground">
                Summer early access
              </div>
              <h1 className="mx-auto max-w-2xl text-4xl font-bold leading-tight tracking-tight md:text-5xl lg:mx-0 lg:text-6xl">
                Start your thesis this summer. Never cite a fake quote.
              </h1>
              <p className="mx-auto max-w-xl text-base text-muted-foreground md:text-lg lg:mx-0">
                ScholarMark helps rising juniors and seniors plan, outline, and revise big
                research papers — and verifies every quote against the real source.
              </p>

              <div className="grid gap-2 text-left sm:grid-cols-3 lg:max-w-xl">
                {["Source library", "Quote verification", "No em-dash mode"].map((item) => (
                  <div
                    key={item}
                    className="rounded-lg border bg-card/70 px-3 py-2 text-xs font-medium"
                  >
                    {item}
                  </div>
                ))}
              </div>

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
                    <Button
                      size="lg"
                      className="w-full px-8 md:w-auto"
                      disabled={claiming}
                      onClick={() => void claimSpot()}
                    >
                      {claiming ? "Claiming..." : "Claim my spot — free trial"}
                    </Button>
                  ) : (
                    <Button size="lg" className="w-full px-8 md:w-auto" asChild>
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
                        Claim my spot — free trial
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
              <div className="mx-auto max-w-sm space-y-2 lg:mx-0">
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
            <CampaignWorkspaceVisual />
          </div>
        </div>

        <section className="border-t bg-card/35">
          <div className="container mx-auto grid max-w-7xl items-center gap-8 px-4 py-10 md:px-6 lg:grid-cols-[0.9fr_1.1fr] xl:max-w-[86rem]">
            <div className="space-y-3">
              <div className="text-xs font-mono uppercase tracking-[0.3em] text-muted-foreground">
                How ScholarMark thinks
              </div>
              <h2 className="max-w-xl text-2xl font-bold tracking-tight md:text-3xl">
                Pull evidence from the source bank. Keep the draft honest.
              </h2>
              <p className="max-w-2xl text-sm text-muted-foreground md:text-base">
                Sources, quotes, and citation context stay connected while you organize the paper
                and tune the writing style.
              </p>
            </div>
            <div className="overflow-hidden rounded-2xl border bg-background shadow-lg">
              <img
                src="/campaign-assets/summer-source-flow-symbolic.png"
                alt="Symbolic source bank flowing into a verified draft"
                className="h-full max-h-[360px] w-full object-cover"
              />
            </div>
          </div>
        </section>
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
