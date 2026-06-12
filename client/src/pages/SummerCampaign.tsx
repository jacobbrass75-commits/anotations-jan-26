import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import {
  BookOpen,
  Check,
  ClipboardCopy,
  Compass,
  FileText,
  ListChecks,
  MessageSquareQuote,
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

const ATTRIBUTION_STORAGE_KEY = "scholarmark_campaign_attribution";
const VISIT_SESSION_KEY = "scholarmark_campaign_visit_sent";

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
    feature: "Follow weekly writing milestones all summer",
  },
] as const;

const HOW_IT_WORKS = [
  "Join with your invite link",
  "Choose your paper type",
  "Add your topic, prompt, or draft",
  "Get a plan and feedback",
  "Follow weekly writing goals",
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
    // Ignore corrupted storage
  }

  // Fresh URL params win over previously stored attribution
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

  useEffect(() => {
    const merged = readAttribution();
    // A path-based code like /invite/maya counts as a referral
    if (inviteParams?.code) {
      merged.referredBy = inviteParams.code;
    }
    setAttribution(merged);
    try {
      localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // Storage unavailable — attribution still lives in component state
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const referralUrl = useMemo(() => {
    if (!result) return "";
    return `${window.location.origin}/invite/${result.referralCode}`;
  }, [result]);

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
      setResult({ referralCode: body.referralCode, alreadySignedUp: body.alreadySignedUp });
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

  const setField = (key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-primary" />
            <span className="font-sans uppercase tracking-[0.2em] font-bold text-primary text-sm">
              ScholarMark
            </span>
            <span className="hidden sm:inline text-xs font-mono uppercase tracking-[0.3em] text-muted-foreground">
              Summer Head Start
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/sign-in">
              <Button variant="ghost" size="sm">
                Sign in
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-10 max-w-5xl space-y-14">
        {/* Hero */}
        <section className="text-center space-y-4 pt-6">
          <div className="text-xs font-mono uppercase tracking-[0.3em] text-muted-foreground">
            Early student access &middot; Summer Thesis Head Start
          </div>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight max-w-3xl mx-auto">
            Get ahead on your thesis, capstone, or big research paper this summer
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto md:text-lg">
            ScholarMark helps rising juniors and seniors plan, outline, revise, and strengthen long
            academic papers before the semester gets busy.
          </p>
          <div className="flex justify-center gap-3 pt-2">
            <Button size="lg" asChild>
              <a href="#join">Start your Summer Thesis Head Start</a>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            In one week, get your research question, outline, source plan, and first draft feedback
            started before the semester begins.
          </p>
        </section>

        {/* Who it's for */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold tracking-tight">Who it&apos;s for</h2>
          <p className="text-muted-foreground max-w-3xl">
            Students starting senior theses, capstones, honors papers, research seminars, or major
            writing-heavy classes next year &mdash; especially in majors like history, English,
            political science, psychology, sociology, philosophy, and public policy.
          </p>
        </section>

        {/* What you can do this summer */}
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

        {/* How it works */}
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

        {/* Signup form / success state */}
        <section id="join" className="scroll-mt-20">
          {result ? (
            <Card className="border-primary/50">
              <CardHeader className="text-center">
                <div className="mx-auto h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                  <Check className="h-5 w-5 text-primary" />
                </div>
                <CardTitle>
                  {result.alreadySignedUp ? "You're already on the list" : "You're in"}
                </CardTitle>
                <CardDescription>
                  Create your free account to start your paper plan, then follow the weekly goals
                  below.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-8">
                <div className="flex flex-col sm:flex-row justify-center gap-3">
                  <Button size="lg" asChild>
                    <Link href="/sign-up">Start my paper plan</Link>
                  </Button>
                </div>

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                    Your 8-week summer writing plan
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {SUMMER_PLAN.map(({ week, goal }) => (
                      <div
                        key={week}
                        className="flex items-start gap-3 border rounded-md p-3 text-sm"
                      >
                        <span className="font-mono text-xs uppercase tracking-widest text-primary whitespace-nowrap pt-0.5">
                          Week {week}
                        </span>
                        <span>{goal}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                    Know someone with a big paper next year?
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Send your invite link to 2 friends starting a thesis, capstone, or honors paper
                    next year.
                  </p>
                  <div className="flex gap-2">
                    <Input readOnly value={referralUrl} className="font-mono text-xs" />
                    <Button variant="outline" onClick={copyReferralLink}>
                      <ClipboardCopy className="h-4 w-4 mr-2" />
                      Copy
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Claim early student access</CardTitle>
                <CardDescription>
                  Early access is for students who will be juniors or seniors next year and want to
                  get ahead on long papers, theses, capstones, or honors writing.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="campaign-name">Name</Label>
                      <Input
                        id="campaign-name"
                        required
                        maxLength={120}
                        value={form.name}
                        onChange={(e) => setField("name")(e.target.value)}
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
                        onChange={(e) => setField("email")(e.target.value)}
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
                        onChange={(e) => setField("school")(e.target.value)}
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
                        onChange={(e) => setField("major")(e.target.value)}
                        placeholder="History"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>What year will you be next year?</Label>
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
                      <Label>What are you working on?</Label>
                      <Select value={form.paperType} onValueChange={setField("paperType")}>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose your paper type" />
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
                      className="flex gap-6 pt-1"
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
                    {submitting ? "Joining..." : "Start your Summer Thesis Head Start"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </section>

        {/* Academic integrity note */}
        <section>
          <Card className="bg-muted/30">
            <CardContent className="flex items-start gap-4 pt-6">
              <ShieldCheck className="h-6 w-6 text-primary shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h2 className="font-semibold">Academic integrity</h2>
                <p className="text-sm text-muted-foreground">
                  ScholarMark helps you improve your own writing, planning, structure, and
                  revision. It does not replace your work or write assignments for you. Always
                  follow your school&apos;s academic integrity policies.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
