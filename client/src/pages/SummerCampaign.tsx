import { useEffect, useMemo } from "react";
import { Link, useRoute } from "wouter";
import {
  BookOpen,
  CalendarCheck,
  Compass,
  FileText,
  ListChecks,
  MessageSquareQuote,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { withRedirectUrl } from "@/lib/redirects";

const ATTRIBUTION_STORAGE_KEY = "scholarmark_campaign_attribution";
const VISIT_SESSION_KEY = "scholarmark_campaign_visit_sent";
const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || "support@scholarmark.ai";

interface CampaignAttribution {
  campus?: string;
  major?: string;
  channel?: string;
  inviteCode?: string;
  referredBy?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
}

function readAttribution(inviteCode?: string): CampaignAttribution {
  const params = new URLSearchParams(window.location.search);
  let stored: CampaignAttribution = {};
  try {
    stored = JSON.parse(localStorage.getItem(ATTRIBUTION_STORAGE_KEY) ?? "{}");
  } catch {
    /* ignore */
  }
  const values: CampaignAttribution = {
    campus: params.get("campus") ?? undefined,
    major: params.get("major") ?? undefined,
    channel: params.get("channel") ?? undefined,
    inviteCode: params.get("code") ?? undefined,
    referredBy: inviteCode ?? params.get("ref") ?? undefined,
    utmSource: params.get("utm_source") ?? undefined,
    utmMedium: params.get("utm_medium") ?? undefined,
    utmCampaign: params.get("utm_campaign") ?? undefined,
    utmTerm: params.get("utm_term") ?? undefined,
    utmContent: params.get("utm_content") ?? undefined,
  };
  return Object.fromEntries(
    Object.entries({ ...stored, ...values }).filter(([, value]) => value),
  ) as CampaignAttribution;
}

const FEATURES = [
  [Compass, "Turn a rough topic into a focused research question"],
  [ListChecks, "Build and refine a working outline with feedback"],
  [Sparkles, "Get revision suggestions on your own drafts"],
  [Target, "Check argument clarity against your sources"],
  [BookOpen, "Collect, annotate, and cite sources in one workspace"],
  [MessageSquareQuote, "Use milestones to keep the project moving"],
] as const;

export default function SummerCampaign() {
  const [, inviteParams] = useRoute("/invite/:code");
  const signupHref = useMemo(
    () => withRedirectUrl("/sign-up", "/pricing?onboarding=1&source=summer"),
    [],
  );

  useEffect(() => {
    const attribution = readAttribution(inviteParams?.code);
    try {
      localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution));
    } catch {
      /* best effort */
    }
    const visitKey = `${VISIT_SESSION_KEY}:${window.location.pathname}:${window.location.search}`;
    if (!sessionStorage.getItem(visitKey)) {
      sessionStorage.setItem(visitKey, "1");
      fetch("/api/campaign/visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...attribution, landingPath: window.location.pathname }),
      }).catch(() => undefined);
    }
  }, [inviteParams?.code]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background/95 sticky top-0 z-40">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/summer" className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-primary" />
            <span className="uppercase tracking-[0.2em] font-bold text-primary text-sm">
              ScholarMark
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/blog" className="text-sm text-muted-foreground">
              Blog
            </Link>
            <Link href="/faq" className="text-sm text-muted-foreground">
              FAQ
            </Link>
            <Link href={withRedirectUrl("/sign-in", "/dashboard")}>
              <Button variant="ghost" size="sm">
                Sign in
              </Button>
            </Link>
          </div>
        </div>
      </header>
      <main className="container mx-auto max-w-7xl space-y-20 px-4 py-8 md:py-12">
        <section className="grid items-center gap-10 xl:grid-cols-[minmax(0,0.82fr)_minmax(560px,1.18fr)] xl:gap-12">
          <div className="space-y-6">
            <div className="text-xs font-mono uppercase tracking-[0.3em] text-muted-foreground">
              Summer thesis head start
            </div>
            <h1 className="max-w-2xl text-4xl font-bold leading-[1.04] tracking-tight sm:text-5xl xl:text-[3.6rem]">
              Get ahead on your thesis, capstone, or big research paper
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl">
              Plan, outline, revise, and strengthen long academic papers with source-grounded
              writing support.
            </p>
            <div className="flex items-start gap-3 text-sm text-muted-foreground">
              <ShieldCheck className="h-5 w-5 text-primary shrink-0" />
              ScholarMark supports your planning and revision. You remain the author.
            </div>

            <Card id="start" className="max-w-xl border-primary/20 bg-card/80 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-xl">Build your paper with a clear plan</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Create an account to open your writing dashboard and start working.
                </p>
                <Button size="lg" className="h-12 w-full uppercase tracking-[0.08em]" asChild>
                  <Link href={signupHref}>Start now</Link>
                </Button>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  By continuing, you agree to our{" "}
                  <Link href="/terms" className="underline underline-offset-2">
                    Terms
                  </Link>{" "}
                  and acknowledge our{" "}
                  <Link href="/privacy" className="underline underline-offset-2">
                    Privacy Policy
                  </Link>
                  .
                </p>
              </CardContent>
            </Card>
          </div>

          <figure className="min-w-0">
            <div className="overflow-hidden rounded-[1.75rem] border border-border/80 bg-[#fdf8f1] shadow-[0_26px_80px_-54px_rgba(45,42,38,0.65)]">
              <img
                src="/campaign-assets/scholarmark-knowledge-to-outline.webp"
                alt="Books, source notes, and research flowing through a phone into an organized academic outline"
                width={1536}
                height={1024}
                loading="eager"
                fetchPriority="high"
                decoding="async"
                className="block h-auto w-full"
              />
            </div>
            <figcaption className="mt-3 flex items-center justify-center gap-3 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground sm:justify-end">
              <span>Sources</span>
              <span aria-hidden="true" className="h-px w-5 bg-primary/50" />
              <span>Structure</span>
              <span aria-hidden="true" className="h-px w-5 bg-primary/50" />
              <span>Draft</span>
            </figcaption>
          </figure>
        </section>
        <section className="space-y-5">
          <div className="flex items-center gap-2">
            <CalendarCheck className="h-5 w-5 text-primary" />
            <h2 className="text-2xl font-semibold">From question to polished draft</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map(([Icon, copy]) => (
              <Card key={copy}>
                <CardContent className="pt-6 flex gap-3">
                  <Icon className="h-5 w-5 text-primary shrink-0" />
                  <span>{copy}</span>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
        <footer className="flex flex-wrap justify-center gap-4 border-t pt-6 text-xs text-muted-foreground">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/support">Support</Link>
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </footer>
      </main>
    </div>
  );
}
