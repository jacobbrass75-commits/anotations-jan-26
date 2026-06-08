import { Link } from "wouter";
import {
  ArrowRight,
  BookOpen,
  Brain,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  FileText,
  FolderOpen,
  Highlighter,
  Library,
  Link2,
  MessageSquare,
  NotebookPen,
  PenLine,
  Quote,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";

type IconBlock = {
  icon: LucideIcon;
  title: string;
  body: string;
};

const workflow: IconBlock[] = [
  {
    icon: Library,
    title: "Collect",
    body: "Bring PDFs, web clips, notes, and assignment context into one project.",
  },
  {
    icon: Highlighter,
    title: "Annotate",
    body: "Mark useful evidence while ScholarMark keeps the source trail attached.",
  },
  {
    icon: NotebookPen,
    title: "Draft",
    body: "Use selected evidence, citation format, and your saved writing style.",
  },
  {
    icon: FileCheck2,
    title: "Verify",
    body: "Review claims, citations, and missing support before exporting.",
  },
];

const features: IconBlock[] = [
  {
    icon: FolderOpen,
    title: "Project-based research",
    body: "Every paper gets a focused workspace for sources, notes, clips, annotations, chats, and drafts.",
  },
  {
    icon: ClipboardCheck,
    title: "Evidence-first AI",
    body: "Ask questions across selected sources and keep answers grounded in the documents you uploaded.",
  },
  {
    icon: PenLine,
    title: "Writing style profiles",
    body: "Save examples of your own work so AI drafts follow your tone, structure, and citation habits.",
  },
  {
    icon: Brain,
    title: "Long-context memory",
    body: "Compact chat history while pulling exact quotes from original documents instead of summaries.",
  },
];

const sourceRows = [
  ["Goodall & Sarwikar", "emotional abuse history", "PDF"],
  ["Tsai et al.", "assessment validity", "PDF"],
  ["MacIntyre & Carr", "prevention program outcomes", "Clip"],
];

function MiniBar({ className = "" }: { className?: string }) {
  return <div className={`h-2 rounded-full bg-muted-foreground/20 ${className}`} />;
}

function ResearchWorkspacePreview() {
  return (
    <div className="max-h-[430px] overflow-hidden rounded-lg border border-border bg-card shadow-sm sm:max-h-none">
      <div className="flex h-11 items-center justify-between border-b border-border bg-background/80 px-4">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-primary">ScholarMark workspace</span>
        </div>
        <div className="hidden items-center gap-2 text-xs text-chart-2 sm:flex">
          <CheckCircle2 className="h-4 w-4" />
          Source search ready
        </div>
      </div>

      <div className="grid min-h-[380px] lg:min-h-[430px] lg:grid-cols-[210px_1fr]">
        <aside className="hidden border-r border-border bg-background/55 p-4 lg:block">
          <div className="mb-4 text-xs font-semibold text-muted-foreground">Project</div>
          <div className="space-y-2">
            {[
              ["Sources", FileText],
              ["Annotations", Highlighter],
              ["Writing", PenLine],
              ["Chat", MessageSquare],
            ].map(([label, Icon]) => {
              const RowIcon = Icon as LucideIcon;
              return (
                <div
                  key={label as string}
                  className="flex items-center gap-2 rounded-md border border-transparent px-2 py-2 text-sm text-muted-foreground first:border-primary/20 first:bg-primary/10 first:text-foreground"
                >
                  <RowIcon className="h-4 w-4 text-primary" />
                  <span>{label as string}</span>
                </div>
              );
            })}
          </div>
        </aside>

        <div className="grid gap-3 p-3 sm:p-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-background p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">Selected sources</div>
                  <div className="text-xs text-muted-foreground">3 active for this draft</div>
                </div>
                <Search className="h-4 w-4 text-chart-2" />
              </div>
              <div className="space-y-2">
                {sourceRows.map(([author, topic, type]) => (
                  <div key={author} className="rounded-md border border-border/80 bg-card/80 p-3">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-semibold text-foreground">{author}</span>
                      <span className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {type}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">{topic}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-border bg-background p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-primary" />
                Writing style
              </div>
              <div className="space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>Academic register</span>
                  <span className="text-chart-2">matched</span>
                </div>
                <MiniBar className="w-full bg-primary/30" />
                <MiniBar className="w-2/3" />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-md border border-border bg-background p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Evidence queue</div>
                  <div className="text-xs text-muted-foreground">Quotes stay tied to source pages</div>
                </div>
                <Quote className="h-4 w-4 text-chart-3" />
              </div>
              <div className="rounded-md border-l-2 border-l-primary bg-card/70 p-3 text-sm leading-6">
                Child psychological maltreatment is framed as a rights issue that requires reliable
                definitions, prevention, and evidence-based intervention.
              </div>
            </div>

            <div className="rounded-md border border-border bg-background p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">Draft output</div>
                  <div className="text-xs text-muted-foreground">Chicago citations enabled</div>
                </div>
                <FileCheck2 className="h-4 w-4 text-chart-2" />
              </div>
              <div className="space-y-2">
                <MiniBar className="w-11/12 bg-primary/25" />
                <MiniBar className="w-full" />
                <MiniBar className="w-4/5" />
                <MiniBar className="w-2/3" />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[11px] text-muted-foreground">
                <div className="rounded border border-border bg-card py-2">claims</div>
                <div className="rounded border border-border bg-card py-2">quotes</div>
                <div className="rounded border border-border bg-card py-2">style</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between gap-3 px-4">
          <Link href="/" className="flex items-center gap-2">
            <BookOpen className="h-6 w-6 shrink-0 text-primary" />
            <span className="text-base font-semibold text-primary sm:text-lg">ScholarMark</span>
          </Link>

          <nav className="flex shrink-0 items-center gap-2">
            <Link href="/pricing" className="hidden sm:block">
              <Button variant="ghost" size="sm">
                Pricing
              </Button>
            </Link>
            <Link href="/sign-in?redirect_url=%2Fdashboard" className="hidden sm:block">
              <Button variant="outline" size="sm">
                Log in
              </Button>
            </Link>
            <Link href="/sign-up?redirect_url=%2Fdashboard">
              <Button size="sm">
                <span className="sm:hidden">Start</span>
                <span className="hidden sm:inline">Start free</span>
              </Button>
            </Link>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main>
        <section className="border-b border-border bg-background">
          <div className="container mx-auto grid gap-7 px-4 py-8 md:py-12 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-chart-2" />
                Source-grounded AI writing workspace
              </div>

              <div className="space-y-4">
                <h1 className="max-w-3xl text-3xl font-semibold leading-tight sm:text-4xl md:text-6xl">
                  Research writing, without losing the evidence.
                </h1>
                <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg md:text-xl md:leading-8">
                  ScholarMark helps students and researchers collect sources, pull useful evidence,
                  draft with AI, and keep citations connected from first note to final paper.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Link href="/sign-up?redirect_url=%2Fdashboard">
                  <Button className="h-11 px-6">
                    Start free
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/pricing">
                  <Button variant="outline" className="h-11 px-6">
                    View pricing
                  </Button>
                </Link>
              </div>

              <div className="flex max-w-2xl flex-wrap gap-2">
                {["Free plan", "Private library", "Style profiles"].map((point) => (
                  <div
                    key={point}
                    className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground"
                  >
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-chart-2" />
                    <span>{point}</span>
                  </div>
                ))}
              </div>
            </div>

            <ResearchWorkspacePreview />
          </div>
        </section>

        <section className="border-b border-border bg-card/45">
          <div className="container mx-auto px-4 py-12 md:py-14">
            <div className="grid overflow-hidden rounded-lg border border-border bg-background md:grid-cols-4">
              {workflow.map((step, index) => {
                const Icon = step.icon;
                return (
                  <article
                    key={step.title}
                    className="border-b border-border p-5 last:border-b-0 md:border-b-0 md:border-r md:p-6 md:last:border-r-0"
                  >
                    <div className="mb-5 flex items-center justify-between gap-3">
                      <Icon className="h-5 w-5 text-primary" />
                      <span className="text-xs text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                    </div>
                    <h2 className="mb-2 text-base font-semibold">{step.title}</h2>
                    <p className="text-sm leading-6 text-muted-foreground">{step.body}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="container mx-auto space-y-8 px-4 py-14 md:py-18">
          <div className="max-w-3xl space-y-3">
            <div className="text-sm font-semibold text-primary">Why it matters</div>
            <h2 className="text-3xl font-semibold leading-tight md:text-4xl">
              One place for the sources, notes, prompts, citations, and drafts behind the paper.
            </h2>
            <p className="leading-7 text-muted-foreground">
              ScholarMark is built for writing that has to stay accountable to real sources. The app keeps
              research material close to the draft instead of scattering it across tabs and documents.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {features.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className="rounded-lg border border-border bg-card p-5">
                  <Icon className="mb-4 h-5 w-5 text-primary" />
                  <h3 className="mb-2 font-semibold">{item.title}</h3>
                  <p className="text-sm leading-6 text-muted-foreground">{item.body}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="border-y border-border bg-card/45">
          <div className="container mx-auto grid gap-8 px-4 py-14 md:py-16 lg:grid-cols-[0.8fr_1fr] lg:items-start">
            <div className="space-y-3">
              <div className="text-sm font-semibold text-primary">Built for academic workflows</div>
              <h2 className="text-3xl font-semibold leading-tight md:text-4xl">
                The draft stays connected to the evidence behind it.
              </h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {[
                ["Sources", "Upload PDFs and capture web clips by project."],
                ["Annotations", "Turn readings into reusable evidence."],
                ["Writing", "Draft with selected sources and saved voice."],
              ].map(([title, body]) => (
                <article key={title} className="rounded-lg border border-border bg-background p-5">
                  <div className="mb-2 text-2xl font-semibold text-primary">{title}</div>
                  <p className="text-sm leading-6 text-muted-foreground">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="container mx-auto px-4 py-14 md:py-18">
          <div className="flex flex-col gap-6 rounded-lg border border-border bg-card p-6 md:flex-row md:items-center md:justify-between md:p-8">
            <div className="max-w-2xl space-y-2">
              <h2 className="text-2xl font-semibold md:text-3xl">Try ScholarMark on your next paper.</h2>
              <p className="leading-7 text-muted-foreground">
                Start with one project, add a few sources, and see how the workspace keeps research and writing together.
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
              <Link href="/sign-up?redirect_url=%2Fdashboard">
                <Button className="h-12 px-6">
                  Start free
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/pricing">
                <Button variant="outline" className="h-12 px-6">
                  Pricing
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
