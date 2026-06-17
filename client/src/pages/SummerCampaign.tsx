import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import {
  BookOpen,
  CalendarCheck,
  Check,
  ClipboardCopy,
  Compass,
  FileText,
  ListChecks,
  MessageSquareQuote,
  PenLine,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { withRedirectUrl } from "@/lib/redirects";

const ATTRIBUTION_STORAGE_KEY = "scholarmark_campaign_attribution";
const ONBOARDING_STORAGE_KEY = "scholarmark_summer_onboarding";
const VISIT_SESSION_KEY = "scholarmark_campaign_visit_sent";
const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || "support@scholarmark.ai";

interface CampaignAttribution {
  campus?: string;
  major?: string;
  channel?: string;
  inviteCode?: string;
  referredBy?: string;
}

const CLASS_YEARS = [
  { value: "rising_senior", label: "Rising senior" },
  { value: "rising_junior", label: "Rising junior" },
  { value: "other", label: "Other" },
] as const;

const PAPER_TYPES = [
  { value: "senior_thesis", label: "Senior thesis" },
  { value: "capstone", label: "Capstone" },
  { value: "honors_paper", label: "Honors paper" },
  { value: "research_seminar", label: "Research seminar paper" },
  { value: "grad_writing_sample", label: "Grad school / law school writing sample" },
  { value: "not_sure", label: "Not sure yet" },
] as const;

const HAS_TOPIC_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "kind_of", label: "Kind of" },
  { value: "no", label: "No" },
] as const;

const PROBLEM_FEATURES = [
  {
    icon: Compass,
    problem: '"I don\'t know how to start my thesis."',
    feature: "Turn a rough topic into a focused research question",
  },
  {
    icon: ListChecks,
    problem: '"My outline is messy."',
    feature: "Build and refine a working outline with feedback",
  },
  {
    icon: Sparkles,
    problem: '"My writing sounds weak."',
    feature: "Get revision suggestions on your own drafts",
  },
  {
    icon: Target,
    problem: '"I don\'t know if my argument makes sense."',
    feature: "Check argument clarity against your sources",
  },
  {
    icon: BookOpen,
    problem: '"I need to organize sources."',
    feature: "Collect, annotate, and cite sources in one workspace",
  },
  {
    icon: MessageSquareQuote,
    problem: '"I procrastinate."',
    feature: "Use weekly milestones to keep the project moving",
  },
] as const;

const HOW_IT_WORKS = [
  "Join with your invite link",
  "Create a summer paper plan",
  "Add your topic, prompt, or draft",
  "Organize sources and outlines",
  "Get feedback while keeping the work yours",
] as const;

const SUMMER_PLAN = [
  { week: 1, goal: "Pick your topic and research question" },
  { week: 2, goal: "Build your source list" },
  { week: 3, goal: "Create your outline" },
  { week: 4, goal: "Draft your intro and thesis statement" },
  { week: 5, goal: "Draft your first section" },
  { week: 6, goal: "Revise your argument and structure" },
  { week: 7, goal: "Clean up citations and transitions" },
  { week: 8, goal: "Prepare for the fall semester" },
] as const;

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
    // Ignore corrupted storage.
  }

  const merged: CampaignAttribution = { ...stored };
  for (const key of ["campus", "major", "channel", "inviteCode", "referredBy"] as const) {
    if (fromUrl[key]) merged[key] = fromUrl[key];
  }
  return merged;
}

export default function SummerCampaign() {
  const [, inviteParams] = useRoute("/invite/:code");
  const { toast } = useToast();

  const [attribution, setAttribution] = useState<CampaignAttribution>({});
  const [form, setForm] = useState({
    name: "",
    email: "",
    school: "",
    major: "",
    classYear: "",
    paperType: "",
    hasTopic: "no",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ referralCode: string; alreadySignedUp: boolean } | null>(
    null,
  );

  const signupHref = useMemo(() => withRedirectUrl("/sign-up", "/summer/onboarding"), []);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Summer Thesis Head Start | ScholarMark";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  useEffect(() => {
    const merged = readAttribution();
    if (inviteParams?.code) {
      merged.referredBy = inviteParams.code;
    }
    setAttribution(merged);
    setForm((prev) => ({
      ...prev,
      school: prev.school || merged.campus || "",
      major: prev.major || merged.major || "",
    }));

    try {
      localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // Storage unavailable; attribution still lives in component state.
    }

    const visitKey = `${VISIT_SESSION_KEY}:${window.location.pathname}:${window.location.search}`;
    if (!sessionStorage.getItem(visitKey)) {
      sessionStorage.setItem(visitKey, "1");
      fetch("/api/campaign/visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...merged, landingPath: window.location.pathname }),
      }).catch(() => {
        // Tracking is best effort; never block the page.
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const referralUrl = useMemo(() => {
    if (!result) return "";
    return `${window.location.origin}/invite/${result.referralCode}`;
  }, [result]);

  const setField = (key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!form.classYear || !form.paperType) {
      setError("Please choose your class year and paper type.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/campaign/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, ...attribution }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body?.message ?? "Signup failed. Please try again.");
        return;
      }

      const referralCode = String(body.referralCode ?? "");
      try {
        localStorage.setItem(
          ONBOARDING_STORAGE_KEY,
          JSON.stringify({
            form,
            attribution,
            referralCode,
            savedAt: new Date().toISOString(),
          }),
        );
      } catch {
        // Onboarding can still ask again if storage is unavailable.
      }
      setResult({ referralCode, alreadySignedUp: Boolean(body.alreadySignedUp) });
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const copyReferralLink = async () => {
    try {
      await navigator.clipboard.writeText(referralUrl);
      toast({ title: "Referral link copied", description: referralUrl });
    } catch {
      toast({
        title: "Copy failed",
        description: "Select and copy the link manually.",
        variant: "destructive",
      });
    }
  };

  const leadForm = (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="campaign-name">Name</Label>
          <Input
            id="campaign-name"
            required
            maxLength={120}
            value={form.name}
            onChange={(event) => setField("name")(event.target.value)}
            placeholder="Maya Chen"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="campaign-email">Email</Label>
          <Input
            id="campaign-email"
            type="email"
            required
            maxLength={254}
            value={form.email}
            onChange={(event) => setField("email")(event.target.value)}
            placeholder="you@school.edu"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="campaign-school">School</Label>
          <Input
            id="campaign-school"
            required
            maxLength={120}
            value={form.school}
            onChange={(event) => setField("school")(event.target.value)}
            placeholder="UCLA"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="campaign-major">Major</Label>
          <Input
            id="campaign-major"
            required
            maxLength={120}
            value={form.major}
            onChange={(event) => setField("major")(event.target.value)}
            placeholder="History"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Year next semester</Label>
          <Select value={form.classYear} onValueChange={setField("classYear")}>
            <SelectTrigger>
              <SelectValue placeholder="Choose your year" />
            </SelectTrigger>
            <SelectContent>
              {CLASS_YEARS.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Project type</Label>
          <Select value={form.paperType} onValueChange={setField("paperType")}>
            <SelectTrigger>
              <SelectValue placeholder="Choose paper type" />
            </SelectTrigger>
            <SelectContent>
              {PAPER_TYPES.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Do you have a topic yet?</Label>
        <RadioGroup
          value={form.hasTopic}
          onValueChange={setField("hasTopic")}
          className="flex flex-wrap gap-4 pt-1"
        >
          {HAS_TOPIC_OPTIONS.map(({ value, label }) => (
            <div key={value} className="flex items-center space-x-2">
              <RadioGroupItem value={value} id={`topic-${value}`} />
              <Label htmlFor={`topic-${value}`} className="font-normal">
                {label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button type="submit" size="lg" className="w-full" disabled={submitting}>
        {submitting ? "Joining..." : "Start my plan"}
      </Button>
      <p className="text-xs leading-5 text-muted-foreground">
        By joining, you agree to receive ScholarMark early access and follow-up emails. You can opt
        out by replying or contacting support@scholarmark.ai. See the{" "}
        <Link href="/privacy" className="text-primary underline-offset-4 hover:underline">
          Privacy Policy
        </Link>
        .
      </p>
    </form>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <Link href="/summer" className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-primary" />
            <span className="font-sans uppercase tracking-[0.2em] font-bold text-primary text-sm">
              ScholarMark
            </span>
            <span className="hidden sm:inline text-xs font-mono uppercase tracking-[0.3em] text-muted-foreground">
              Summer Head Start
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <nav className="hidden items-center gap-4 text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground sm:flex">
              <Link href="/blog" className="hover:text-primary">
                Blog
              </Link>
              <Link href="/faq" className="hover:text-primary">
                FAQ
              </Link>
            </nav>
            <Link href="/sign-in">
              <Button variant="ghost" size="sm">
                Sign in
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 lg:py-12 max-w-7xl space-y-12">
        <section className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] items-start">
          <div className="space-y-6 pt-2">
            <div className="space-y-4">
              <div className="text-xs font-mono uppercase tracking-[0.3em] text-muted-foreground">
                Early student access / Summer Thesis Head Start
              </div>
              <h1 className="text-3xl md:text-5xl font-bold tracking-tight max-w-3xl">
                Get ahead on your thesis, capstone, or big research paper this summer
              </h1>
              <p className="text-muted-foreground max-w-2xl md:text-lg">
                ScholarMark helps rising juniors and seniors plan, outline, revise, and strengthen
                long academic papers before the semester gets busy.
              </p>
            </div>

            <div className="hidden sm:grid gap-3 sm:grid-cols-3">
              {[
                ["Week 1", "Research question"],
                ["Week 3", "Working outline"],
                ["Week 6", "Argument revision"],
              ].map(([label, copy]) => (
                <div key={label} className="rounded-lg border bg-card p-4">
                  <div className="text-xs font-mono uppercase tracking-widest text-primary">
                    {label}
                  </div>
                  <div className="mt-1 text-sm">{copy}</div>
                </div>
              ))}
            </div>

            <div className="hidden sm:flex items-start gap-3 rounded-lg border bg-muted/25 p-4 text-sm">
              <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <p className="text-muted-foreground">
                Feedback, planning, and revision support. ScholarMark does not replace your work or
                write assignments for you.
              </p>
            </div>
          </div>

          <Card id="join" className="scroll-mt-20 shadow-sm">
            {result ? (
              <>
                <CardHeader className="text-center">
                  <div className="mx-auto h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                    <Check className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle>
                    {result.alreadySignedUp ? "You're already on the list" : "You're in"}
                  </CardTitle>
                  <CardDescription>
                    Create your free account and ScholarMark will open your summer writing plan.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <Button size="lg" className="w-full" asChild>
                    <Link href={signupHref}>Create my writing plan</Link>
                  </Button>

                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                      Invite 2 friends
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Send this to students starting a thesis, capstone, honors paper, or research
                      seminar next year.
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input readOnly value={referralUrl} className="font-mono text-xs" />
                      <Button variant="outline" onClick={copyReferralLink}>
                        <ClipboardCopy className="h-4 w-4 mr-2" />
                        Copy
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </>
            ) : (
              <>
                <CardHeader>
                  <CardTitle>Claim early student access</CardTitle>
                  <CardDescription>
                    Join the summer program for rising juniors and seniors starting long papers,
                    theses, capstones, or honors writing. Feedback and revision support, not
                    assignment replacement.
                  </CardDescription>
                </CardHeader>
                <CardContent>{leadForm}</CardContent>
              </>
            )}
          </Card>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <CalendarCheck className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold tracking-tight">The summer writing plan</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {SUMMER_PLAN.map(({ week, goal }) => (
              <div key={week} className="rounded-lg border bg-card p-4 text-sm">
                <div className="font-mono text-xs uppercase tracking-widest text-primary mb-2">
                  Week {week}
                </div>
                <div>{goal}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold tracking-tight">Who it's for</h2>
          <p className="text-muted-foreground max-w-3xl">
            Students starting senior theses, capstones, honors papers, research seminars, or major
            writing-heavy classes next year, especially in majors like history, English, political
            science, psychology, sociology, philosophy, public policy, and communications.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold tracking-tight">What you can do this summer</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {PROBLEM_FEATURES.map(({ icon: Icon, problem, feature }) => (
              <Card key={feature}>
                <CardHeader className="pb-2">
                  <Icon className="h-5 w-5 text-primary mb-1" />
                  <CardTitle className="text-sm font-medium text-muted-foreground italic">
                    {problem}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm">{feature}</CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold tracking-tight">How it works</h2>
          <ol className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {HOW_IT_WORKS.map((step, index) => (
              <li key={step} className="border rounded-lg p-4 bg-card">
                <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">
                  Step {index + 1}
                </div>
                <div className="text-sm">{step}</div>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <Card className="bg-muted/30">
            <CardContent className="flex items-start gap-4 pt-6">
              <ShieldCheck className="h-6 w-6 text-primary shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h2 className="font-semibold">Academic integrity</h2>
                <p className="text-sm text-muted-foreground">
                  ScholarMark helps you improve your own writing, planning, structure, revision,
                  and source-grounded drafts. You remain responsible for checking outputs,
                  citations, quotations, and your school's academic integrity policies.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="flex flex-col items-center gap-3 rounded-lg border bg-card p-6 text-center">
          <PenLine className="h-6 w-6 text-primary" />
          <h2 className="text-xl font-semibold tracking-tight">
            Start before everyone else gets busy.
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            The goal is not to finish the whole paper this week. It is to start with a plan before
            the semester pressure hits.
          </p>
          <Button asChild>
            <a href="#join">Start my plan</a>
          </Button>
        </section>

        <footer className="flex flex-wrap items-center justify-center gap-4 border-t border-border pt-6 text-xs text-muted-foreground">
          <Link href="/terms" className="hover:text-primary">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-primary">
            Privacy
          </Link>
          <Link href="/support" className="hover:text-primary">
            Support
          </Link>
          <Link href="/blog" className="hover:text-primary">
            Blog
          </Link>
          <Link href="/faq" className="hover:text-primary">
            FAQ
          </Link>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-primary">
            {SUPPORT_EMAIL}
          </a>
          <Link href="/summer/visuals" className="hover:text-primary">
            Campaign visuals
          </Link>
        </footer>
      </main>
    </div>
  );
}
