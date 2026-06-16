import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Link } from "wouter";
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  FileText,
  Loader2,
  Pause,
  Play,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Square,
  Type,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useToast } from "@/hooks/use-toast";
import { markdownComponents, remarkPlugins } from "@/lib/markdownConfig";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const stageLabels = [
  "Reading brief",
  "Building outline",
  "Drafting sections",
  "Tightening citations",
  "Verifier pass",
];

const sourceNotes = [
  {
    id: "marginalia",
    title: "Marginal annotations",
    meta: "12 highlights",
    detail: "Claims, counterclaims, and professor notes.",
  },
  {
    id: "archive",
    title: "Course archive",
    meta: "4 excerpts",
    detail: "Primary-source context and chronology.",
  },
  {
    id: "style",
    title: "Voice sample",
    meta: "2 pages",
    detail: "Keeps sentence rhythm close to the student's draft.",
  },
];

const STREAM_CHARS_PER_TICK = 18;
const STREAM_TICK_MS = 95;

function isLocalStudioAvailable() {
  if (import.meta.env.DEV) return true;
  if (typeof window === "undefined") return false;
  return LOCAL_HOSTS.has(window.location.hostname);
}

function buildDraft(
  topic: string,
  selectedSourceTitles: string[],
  mode: "brief" | "paper" | "memo",
) {
  const cleanTopic = topic.trim() || "How annotated sources change the way students build a thesis";
  const sourceLine =
    selectedSourceTitles.length > 0
      ? selectedSourceTitles.join(", ")
      : "the active ScholarMark source set";

  if (mode === "memo") {
    return `# ${cleanTopic}

## Working Position

The evidence points toward a paper that treats annotation as a method, not an afterthought. The strongest path is to show how each mark in the source record changes the student's next decision: what to trust, what to question, and what needs a clearer bridge.

## Evidence Map

The current local draft is using ${sourceLine}. The first pass turns those materials into a claim ladder: source context, interpretive move, citation placement, and revision note.

## Revision Notes

The verifier should look for three things before export: unsupported generalizations, citation clusters that need breathing room, and transitions that sound more like summary than argument.`;
  }

  if (mode === "brief") {
    return `# ${cleanTopic}

## Thesis Sketch

A strong draft can argue that source annotation changes the work of writing because it makes reading decisions visible. Instead of treating citations as proof added at the end, the writer uses each note to decide what the paragraph is allowed to claim.

## Section Plan

1. Define annotation as a writing workflow.
2. Show how selected evidence from ${sourceLine} narrows the thesis.
3. Contrast unsupported summary with source-grounded analysis.
4. Close with a verifier pass that checks every claim against a source.

## Clean Next Step

Expand the second and third sections first. Those paragraphs carry the most risk and the most payoff.`;
  }

  return `# ${cleanTopic}

## Introduction

Writing with annotated sources is less about collecting quotations than about preserving the moment when a reader notices something worth testing. A margin note, a highlighted sentence, or a short source role can become a decision record. It tells the writer why a passage matters before the pressure of drafting flattens that reason into a generic citation.

This local preview treats ${sourceLine} as the working source set. The goal is not to produce a final paper in one leap. It is to show the document taking shape as a sequence of visible moves: reading the brief, forming an outline, drafting the body, and checking the claims before export.

## Source-Grounded Drafting

The first advantage of annotation is restraint. When a writer begins with notes attached to specific evidence, each paragraph has a narrower job. The paragraph does not need to summarize the whole source. It needs to explain why a chosen passage changes the paper's claim. That distinction keeps the prose from drifting into broad commentary.

The second advantage is continuity. Students often lose the thread between research and revision because the source file and the draft live in different mental spaces. A side-by-side writing environment shortens that distance. Sources remain visible, the generated document grows in real time, and the verifier can ask whether the draft still matches the evidence that started it.

## Verification Pass

A useful verifier does not merely ask whether citations exist. It asks whether the claims deserve those citations. In this preview, the check is intentionally plain: every body section should have a source anchor, every quoted idea should have a reason for appearing, and every transition should do more than announce the next topic.

That loop makes the writing surface feel calmer. The writer can watch the draft appear, pause it, revise the brief, and generate again without losing the structure of the work. The interface becomes less like a blank page and more like a small studio for turning evidence into argument.

## Closing

The best version of this workflow is quiet. It does not bury the student under controls or force the document into a marketing frame. It gives the paper room, keeps the sources close, and lets the generation process be visible enough to trust.`;
}

function getProgress(text: string, target: string) {
  if (!target) return 0;
  return Math.min(100, Math.round((text.length / target.length) * 100));
}

function getStageIndex(progress: number) {
  if (progress >= 96) return 4;
  if (progress >= 72) return 3;
  if (progress >= 34) return 2;
  if (progress >= 10) return 1;
  return 0;
}

function countWords(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export default function LocalWritingStudio() {
  const { toast } = useToast();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [topic, setTopic] = useState(
    "How annotated sources change the way students build a thesis",
  );
  const [mode, setMode] = useState<"brief" | "paper" | "memo">("paper");
  const [selectedSourceIds, setSelectedSourceIds] = useState(
    sourceNotes.map((source) => source.id),
  );
  const [lockedDraft, setLockedDraft] = useState("");
  const [generatedText, setGeneratedText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const selectedSourceTitles = useMemo(
    () =>
      sourceNotes
        .filter((source) => selectedSourceIds.includes(source.id))
        .map((source) => source.title.toLowerCase()),
    [selectedSourceIds],
  );
  const previewDraft = useMemo(
    () => buildDraft(topic, selectedSourceTitles, mode),
    [mode, selectedSourceTitles, topic],
  );
  const activeTarget = lockedDraft || previewDraft;
  const progress = getProgress(generatedText, activeTarget);
  const stageIndex = getStageIndex(progress);
  const wordCount = countWords(generatedText);
  const isComplete = Boolean(activeTarget && generatedText.length >= activeTarget.length);

  useEffect(() => {
    if (!isGenerating || isPaused || !lockedDraft) return;

    const intervalId = window.setInterval(() => {
      setGeneratedText((current) => {
        const nextLength = Math.min(lockedDraft.length, current.length + STREAM_CHARS_PER_TICK);
        return lockedDraft.slice(0, nextLength);
      });
    }, STREAM_TICK_MS);

    return () => window.clearInterval(intervalId);
  }, [isGenerating, isPaused, lockedDraft]);

  useEffect(() => {
    if (!isGenerating || !lockedDraft || generatedText.length < lockedDraft.length) return;
    setIsGenerating(false);
    setIsPaused(false);
  }, [generatedText.length, isGenerating, lockedDraft]);

  useEffect(() => {
    if (!scrollerRef.current || !isGenerating) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [generatedText, isGenerating]);

  const startGeneration = () => {
    const nextDraft = buildDraft(topic, selectedSourceTitles, mode);
    setLockedDraft(nextDraft);
    setGeneratedText("");
    setIsPaused(false);
    setIsGenerating(true);
  };

  const resumeGeneration = () => {
    if (!lockedDraft) {
      startGeneration();
      return;
    }
    setIsPaused(false);
    setIsGenerating(true);
  };

  const toggleSource = (sourceId: string) => {
    setSelectedSourceIds((current) =>
      current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId],
    );
  };

  const resetStudio = () => {
    setGeneratedText("");
    setLockedDraft("");
    setIsGenerating(false);
    setIsPaused(false);
  };

  const copyDraft = async () => {
    if (!generatedText.trim()) return;
    try {
      await navigator.clipboard.writeText(generatedText);
      toast({ title: "Draft copied" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  if (!isLocalStudioAvailable()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
        <div className="max-w-sm space-y-3 rounded-lg border bg-card p-6">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Local studio unavailable</h1>
          <p className="text-sm text-muted-foreground">
            This preview only renders in development or on localhost.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-3 text-foreground sm:p-4">
      <div
        className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-[1500px] flex-col overflow-hidden rounded-lg border border-border bg-card"
        style={{ boxShadow: "0 24px 70px hsl(var(--foreground) / 0.08)" }}
      >
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background/85 px-3 backdrop-blur-md sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex shrink-0 items-center gap-1.5" aria-hidden="true">
              <span className="h-3 w-3 rounded-full bg-[#FF5F57]" />
              <span className="h-3 w-3 rounded-full bg-[#FFBD2E]" />
              <span className="h-3 w-3 rounded-full bg-[#28C840]" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">ScholarMark Local Writing Studio</div>
              <div className="truncate text-xs text-muted-foreground">localhost preview</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge
              variant="outline"
              className="hidden font-normal normal-case tracking-normal sm:flex"
            >
              {isComplete ? "verified" : stageLabels[stageIndex]}
            </Badge>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="normal-case tracking-normal"
                  onClick={copyDraft}
                  disabled={!generatedText.trim()}
                  aria-label="Copy draft"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy draft</TooltipContent>
            </Tooltip>
            <ThemeToggle />
            <Link href="/write">
              <Button variant="outline" size="sm" className="normal-case tracking-normal">
                <ArrowLeft className="h-4 w-4" />
                Write
              </Button>
            </Link>
          </div>
        </header>

        <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
          <aside className="min-h-0 border-b border-border bg-sidebar/70 lg:border-b-0 lg:border-r">
            <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Type className="h-4 w-4 text-primary" />
                  Brief
                </div>
                <Textarea
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  className="min-h-28 resize-none bg-background/80 text-sm"
                  disabled={isGenerating && !isPaused}
                  aria-label="Writing brief"
                />
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Mode</div>
                <div className="grid grid-cols-3 rounded-md border bg-background/70 p-1">
                  {(["brief", "paper", "memo"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setMode(option)}
                      className={`rounded-sm px-2 py-1.5 text-xs transition ${
                        mode === option ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Sources</div>
                <div className="space-y-2">
                  {sourceNotes.map((source) => (
                    <label
                      key={source.id}
                      className="flex gap-2 rounded-md border border-border bg-background/70 p-2 text-sm"
                    >
                      <Checkbox
                        checked={selectedSourceIds.includes(source.id)}
                        onCheckedChange={() => toggleSource(source.id)}
                        className="mt-0.5"
                        disabled={isGenerating && !isPaused}
                      />
                      <span className="min-w-0">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium">{source.title}</span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {source.meta}
                          </span>
                        </span>
                        <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {source.detail}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="mt-auto grid grid-cols-[1fr_auto] gap-2">
                {isGenerating && !isPaused ? (
                  <Button
                    onClick={() => setIsPaused(true)}
                    className="normal-case tracking-normal"
                    variant="outline"
                  >
                    <Pause className="h-4 w-4" />
                    Pause
                  </Button>
                ) : (
                  <Button
                    onClick={generatedText && !isComplete ? resumeGeneration : startGeneration}
                    className="normal-case tracking-normal"
                  >
                    <Play className="h-4 w-4" />
                    {generatedText && !isComplete ? "Resume" : "Generate"}
                  </Button>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="normal-case tracking-normal"
                      onClick={resetStudio}
                      aria-label="Reset studio"
                    >
                      <RefreshCcw className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Reset studio</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </aside>

          <section className="flex min-h-[640px] flex-col bg-[#FAF7F1] dark:bg-background lg:min-h-0">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background/75 px-4 backdrop-blur">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate text-sm font-medium">
                  {topic.trim() || "Untitled local draft"}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {isGenerating && !isPaused && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{wordCount} words</span>
              </div>
            </div>

            <div ref={scrollerRef} className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
              <article
                className="mx-auto min-h-[720px] max-w-[760px] rounded-md border border-border bg-background px-6 py-8 sm:px-10 sm:py-12"
                style={{ boxShadow: "0 18px 45px hsl(var(--foreground) / 0.07)" }}
              >
                {generatedText ? (
                  <div className="prose prose-sm max-w-none font-serif leading-relaxed dark:prose-invert">
                    <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
                      {generatedText}
                    </ReactMarkdown>
                    {!isComplete && (
                      <span className="ml-1 inline-block h-4 w-2 translate-y-0.5 animate-pulse rounded-sm bg-primary" />
                    )}
                  </div>
                ) : (
                  <div className="flex min-h-[560px] items-center justify-center">
                    <div className="max-w-xs text-center">
                      <Sparkles className="mx-auto h-8 w-8 text-primary/70" />
                      <p className="mt-3 text-sm text-muted-foreground">Ready for a local draft.</p>
                    </div>
                  </div>
                )}
              </article>
            </div>
          </section>

          <aside className="min-h-0 border-t border-border bg-sidebar/70 lg:border-l lg:border-t-0">
            <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-4">
              <div className="rounded-md border border-border bg-background/75 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Square className="h-3.5 w-3.5 fill-primary text-primary" />
                    Generator
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">{progress}%</span>
                </div>
                <Progress value={progress} className="h-1.5" />
                <div className="mt-3 space-y-2">
                  {stageLabels.map((stage, index) => {
                    const complete = index < stageIndex || isComplete;
                    const active = index === stageIndex && !isComplete;
                    return (
                      <div
                        key={stage}
                        className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
                          active ? "bg-primary/10 text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {complete ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                        ) : active ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        ) : (
                          <span className="h-3.5 w-3.5 rounded-full border border-border" />
                        )}
                        <span className="truncate">{stage}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-md border border-border bg-background/75 p-3">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Verifier
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-muted/60 p-2">
                    <div className="text-muted-foreground">Evidence</div>
                    <div className="mt-1 font-medium">
                      {selectedSourceIds.length ? `${selectedSourceIds.length} active` : "none"}
                    </div>
                  </div>
                  <div className="rounded-md bg-muted/60 p-2">
                    <div className="text-muted-foreground">Layout</div>
                    <div className="mt-1 font-medium">{isComplete ? "stable" : "drafting"}</div>
                  </div>
                </div>
                <div className="mt-3 rounded-md border border-border bg-card p-2 text-xs text-muted-foreground">
                  {isComplete
                    ? "No local overflow warnings. Ready for handoff."
                    : "Waiting for the generated document to finish."}
                </div>
              </div>

              <div className="rounded-md border border-border bg-background/75 p-3">
                <div className="mb-2 text-sm font-semibold">Document Stats</div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Mode</span>
                    <span className="font-medium">{mode}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Characters</span>
                    <span className="font-medium tabular-nums">{generatedText.length}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Target</span>
                    <span className="font-medium tabular-nums">{activeTarget.length}</span>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}
