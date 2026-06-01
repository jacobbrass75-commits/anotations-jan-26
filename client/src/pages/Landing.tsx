import { Link } from "wouter";
import {
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  FolderOpen,
  Link2,
  MessageSquare,
  PenLine,
  Quote,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/lib/auth";

const capabilities = [
  {
    icon: FolderOpen,
    title: "Project workspaces",
    body: "Keep sources, notes, web clips, annotations, and drafts tied to the paper they belong to.",
  },
  {
    icon: ClipboardCheck,
    title: "Evidence review",
    body: "Turn readings into useful notes and surface the passages that matter when it is time to write.",
  },
  {
    icon: PenLine,
    title: "Style-aware writing",
    body: "Draft from your research while preserving reusable writing styles and citation preferences.",
  },
] satisfies Array<{ icon: LucideIcon; title: string; body: string }>;

const previewNavItems: Array<[string, LucideIcon]> = [
  ["Project", FolderOpen],
  ["Sources", FileText],
  ["Web Clips", Link2],
  ["Chat", MessageSquare],
];

const workflow = [
  "Collect PDFs, notes, and web clips",
  "Annotate with research intent",
  "Ask questions across your sources",
  "Draft and verify the final paper",
];

export default function Landing() {
  const { isLoaded, isSignedIn } = useAuth();
  const appHref = isLoaded && isSignedIn ? "/dashboard" : "/sign-in?redirect_url=%2Fdashboard";
  const appLabel = isLoaded && isSignedIn ? "Dashboard" : "Log In";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary shrink-0" />
            <span className="font-sans uppercase tracking-[0.12em] sm:tracking-[0.2em] font-bold text-primary text-sm sm:text-base">
              SCHOLARMARK
            </span>
          </Link>
          <nav className="flex items-center gap-2 shrink-0">
            <Link href="/pricing" className="hidden sm:block">
              <Button variant="ghost" size="sm" className="uppercase tracking-wider text-xs font-mono">
                Pricing
              </Button>
            </Link>
            <Link href={appHref} className="hidden sm:block">
              <Button variant="outline" size="sm" className="uppercase tracking-wider text-xs font-mono">
                {appLabel}
              </Button>
            </Link>
            <Link href="/sign-up?redirect_url=%2Fdashboard">
              <Button size="sm" className="uppercase tracking-wider text-xs font-mono">
                <span className="sm:hidden">Start</span>
                <span className="hidden sm:inline">Get Started</span>
              </Button>
            </Link>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main>
        <section className="eva-grid-bg border-b border-border">
          <div className="container mx-auto px-4 py-14 md:py-20 grid lg:grid-cols-[1fr_520px] gap-10 items-center">
            <div className="space-y-6">
              <div className="eva-section-title">Research Workspace</div>
              <div className="space-y-4">
                <h1 className="text-4xl md:text-6xl font-sans uppercase tracking-[0.08em] text-primary leading-tight">
                  ScholarMark
                </h1>
                <p className="text-lg md:text-xl text-muted-foreground max-w-2xl leading-8">
                  A focused workspace for students and researchers to collect sources, annotate evidence,
                  write with AI, and keep citations connected to the work.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link href="/sign-up?redirect_url=%2Fdashboard">
                  <Button className="h-12 px-6 uppercase tracking-wider font-mono">
                    Start Free
                  </Button>
                </Link>
                <Link href="/pricing">
                  <Button variant="outline" className="h-12 px-6 uppercase tracking-wider font-mono">
                    View Pricing
                  </Button>
                </Link>
              </div>
              <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-chart-2" />
                  <span>Free plan available</span>
                </div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-chart-3" />
                  <span>Private research library</span>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card/80 shadow-sm overflow-hidden">
              <div className="border-b border-border px-4 h-12 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-primary" />
                  <span className="text-xs font-mono uppercase tracking-[0.2em] text-primary">
                    Command Center
                  </span>
                </div>
                <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-chart-2">
                  Workspace Ready
                </div>
              </div>
              <div className="grid grid-cols-[150px_1fr] min-h-[340px]">
                <aside className="border-r border-border p-4 space-y-3 bg-background/45">
                  {previewNavItems.map(([label, Icon]) => (
                    <div key={label} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Icon className="h-4 w-4 text-primary" />
                      <span>{label}</span>
                    </div>
                  ))}
                </aside>
                <div className="p-4 space-y-4">
                  <div className="rounded-md border border-border bg-background p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">
                        Research Brief
                      </div>
                      <Quote className="h-4 w-4 text-chart-3" />
                    </div>
                    <div className="space-y-2">
                      <div className="h-2 rounded bg-primary/35 w-3/4" />
                      <div className="h-2 rounded bg-muted-foreground/20 w-full" />
                      <div className="h-2 rounded bg-muted-foreground/20 w-5/6" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-md border border-border bg-background p-3">
                      <Search className="h-4 w-4 text-chart-2 mb-3" />
                      <div className="h-2 rounded bg-muted-foreground/20 w-16 mb-2" />
                      <div className="h-2 rounded bg-muted-foreground/20 w-24" />
                    </div>
                    <div className="rounded-md border border-border bg-background p-3">
                      <PenLine className="h-4 w-4 text-primary mb-3" />
                      <div className="h-2 rounded bg-muted-foreground/20 w-20 mb-2" />
                      <div className="h-2 rounded bg-muted-foreground/20 w-24" />
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-background p-4 space-y-2">
                    {workflow.map((step, index) => (
                      <div key={step} className="flex items-center gap-3 text-xs text-muted-foreground">
                        <div className="h-5 w-5 rounded border border-border flex items-center justify-center font-mono text-[10px] text-primary">
                          {index + 1}
                        </div>
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="container mx-auto px-4 py-12 md:py-16 space-y-8">
          <div className="max-w-3xl space-y-3">
            <div className="eva-section-title">What It Does</div>
            <h2 className="text-2xl md:text-3xl font-sans uppercase tracking-[0.1em] text-primary">
              From source collection to finished draft
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {capabilities.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className="rounded-lg border border-border bg-card/70 p-5 space-y-4">
                  <Icon className="h-5 w-5 text-primary" />
                  <div className="space-y-2">
                    <h3 className="font-semibold">{item.title}</h3>
                    <p className="text-sm leading-6 text-muted-foreground">{item.body}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
