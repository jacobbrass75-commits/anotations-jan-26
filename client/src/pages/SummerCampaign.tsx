import { useEffect, useMemo } from "react";
import { Link, useRoute } from "wouter";
import {
  ArrowRight,
  BookOpen,
  CalendarCheck,
  CheckCircle2,
  Compass,
  FileText,
  ListChecks,
  MessageSquareQuote,
  Mail,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { withRedirectUrl } from "@/lib/redirects";
import { trackSiteEvent } from "@/lib/siteAnalytics";

const ATTRIBUTION_STORAGE_KEY = "scholarmark_campaign_attribution";
const VISIT_SESSION_KEY = "scholarmark_campaign_visit_sent";
const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || "support@scholarmark.ai";
const founderEmailHref = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("ScholarMark Founder Help - Landing Page")}`;
const founderBookingHref = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("ScholarMark 15-Minute Setup - Landing Page")}`;

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

const STARTER_PROOF = [
  "Create up to 3 research projects",
  "Add 10 sources per project",
  "Draft, cite, verify, and export",
] as const;

export default function SummerCampaign() {
  const [, inviteParams] = useRoute("/invite/:code");
  const signupHref = useMemo(() => withRedirectUrl("/sign-up", "/dashboard"), []);

  useEffect(() => {
    const attribution = readAttribution(inviteParams?.code);
    try {
      localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution));
    } catch {
      /* best effort */
    }
    const visitKey = `${VISIT_SESSION_KEY}:${window.location.pathname}:${window.location.search}`;
    let shouldRecordVisit = true;
    try {
      shouldRecordVisit = !sessionStorage.getItem(visitKey);
      if (shouldRecordVisit) sessionStorage.setItem(visitKey, "1");
    } catch {
      // Storage can be unavailable in embedded/private browsers. Analytics is
      // best effort and must never prevent the public page from rendering.
    }
    if (shouldRecordVisit) {
      fetch("/api/campaign/visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...attribution, landingPath: window.location.pathname }),
      }).catch(() => undefined);
    }
  }, [inviteParams?.code]);

  return (
    <div className="min-h-screen bg-background pb-24 md:pb-0">
      <header className="border-b bg-background/95 sticky top-0 z-40">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/summer" className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-primary" />
            <span className="uppercase tracking-[0.2em] font-bold text-primary text-sm">
              ScholarMark
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/blog" className="hidden text-sm text-muted-foreground sm:inline">
              Blog
            </Link>
            <Link href="/faq" className="hidden text-sm text-muted-foreground sm:inline">
              FAQ
            </Link>
            <Button variant="ghost" size="sm" asChild>
              <a
                href={withRedirectUrl("/sign-in", "/dashboard")}
                target="_top"
                data-testid="summer-sign-in"
              >
                Sign in
              </a>
            </Button>
          </div>
        </div>
      </header>
      <main className="container mx-auto max-w-7xl space-y-16 px-4 py-6 max-[340px]:py-4 md:space-y-20 md:py-12">
        <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.78fr)] lg:gap-12">
          <div className="min-w-0 space-y-6 max-[340px]:space-y-3">
            <div className="text-xs font-mono uppercase tracking-[0.3em] text-muted-foreground">
              For thesis, capstone &amp; long research papers
            </div>
            <h1 className="max-w-2xl text-4xl font-bold leading-[1.04] tracking-tight max-[340px]:text-[2rem] max-[340px]:leading-[1.08] sm:text-5xl xl:text-[3.6rem]">
              Build your thesis without losing track of the sources
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl">
              Upload your research once. ScholarMark helps you find evidence, keep quote context
              attached, and move from question to draft in one workspace.
            </p>
            <div className="space-y-2">
              <Button
                size="lg"
                className="h-12 w-full px-6 text-sm uppercase tracking-[0.08em] sm:w-auto"
                asChild
              >
                <a
                  href={signupHref}
                  target="_top"
                  data-testid="summer-start-now-above-fold"
                  onClick={() =>
                    trackSiteEvent("primary_cta_click", {
                      ctaOrFeature: "hero_above_fold_create_free_account",
                    })
                  }
                >
                  Create your free account
                  <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
              <p className="text-xs font-medium text-muted-foreground">
                Free Starter plan. No credit card required.
              </p>
            </div>
            <div className="flex items-start gap-3 text-sm text-muted-foreground">
              <ShieldCheck className="h-5 w-5 text-primary shrink-0" />
              ScholarMark supports your planning and revision. You remain the author.
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {STARTER_PROOF.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-2 rounded-lg border border-border/70 bg-card/60 px-3 py-2 text-xs text-muted-foreground"
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
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
          </div>

          <figure className="mx-auto w-full min-w-0 max-w-md">
            <div className="rounded-[1.75rem] border border-border/80 bg-card/80 p-3 shadow-[0_26px_80px_-54px_rgba(45,42,38,0.65)] sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-3 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                <span>Real ScholarMark workspace</span>
                <span className="rounded-full bg-primary/10 px-2 py-1 text-primary">
                  Source context
                </span>
              </div>
              <div className="mx-auto overflow-hidden rounded-[1.25rem] border border-border bg-background">
                <img
                  src="/campaign-assets/scholarmark-source-context-demo.webp"
                  alt="ScholarMark source reader showing highlighted evidence, source search, and annotations"
                  width={720}
                  height={720}
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                  className="block h-auto w-full"
                />
              </div>
            </div>
            <figcaption className="mt-3 text-center text-xs leading-relaxed text-muted-foreground">
              Find evidence → open the source → verify the context.
            </figcaption>
          </figure>
        </section>
        <section className="rounded-2xl border border-primary/20 bg-card/70 p-6 md:p-8">
          <div className="max-w-3xl space-y-4">
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              <h2 className="text-2xl font-semibold">
                Get personal help from ScholarMark’s founder
              </h2>
            </div>
            <p className="text-muted-foreground">
              Get personal help setting up ScholarMark for your research workflow. I’ll help you
              organize sources, find supporting evidence, verify citations, and get the most from
              the app—whether you’re a student, researcher, or research assistant.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <a
                  href={founderEmailHref}
                  onClick={() =>
                    trackSiteEvent("primary_cta_click", { ctaOrFeature: "founder_email_landing" })
                  }
                >
                  Email Jacob
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a
                  href={founderBookingHref}
                  onClick={() =>
                    trackSiteEvent("primary_cta_click", { ctaOrFeature: "founder_setup_landing" })
                  }
                >
                  Book a 15-minute setup
                </a>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Free while ScholarMark is new. No sales pitch—just practical setup help and a chance
              to influence what I build next.
            </p>
          </div>
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
      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-12px_32px_-24px_rgba(0,0,0,0.5)] backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Start free</div>
            <div className="truncate text-[11px] text-muted-foreground">
              No credit card required
            </div>
          </div>
          <Button className="h-12 shrink-0" asChild>
            <a
              href={signupHref}
              target="_top"
              data-testid="summer-start-now-sticky"
              onClick={() =>
                trackSiteEvent("primary_cta_click", {
                  ctaOrFeature: "sticky_mobile_create_free_account",
                })
              }
            >
              Create account
              <ArrowRight className="ml-2 h-4 w-4" />
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
