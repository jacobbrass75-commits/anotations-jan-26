import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowLeft,
  BookOpen,
  CalendarCheck,
  CheckCircle2,
  FileText,
  LoaderCircle,
  PenLine,
  Sparkles,
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useCreateProject, useProjects } from "@/hooks/useProjects";

const ONBOARDING_STORAGE_KEY = "scholarmark_summer_onboarding";

const PAPER_TYPES = [
  { value: "senior_thesis", label: "Senior thesis" },
  { value: "capstone", label: "Capstone" },
  { value: "honors_paper", label: "Honors paper" },
  { value: "research_seminar", label: "Research seminar paper" },
  { value: "grad_writing_sample", label: "Grad school / law school writing sample" },
  { value: "not_sure", label: "Not sure yet" },
] as const;

const SUMMER_PLAN = [
  "Pick topic and research question",
  "Build source list",
  "Create outline",
  "Draft intro and thesis statement",
  "Draft first section",
  "Revise argument and structure",
  "Clean up citations and transitions",
  "Prepare for the fall semester",
] as const;

interface StoredLead {
  form?: {
    school?: string;
    major?: string;
    paperType?: string;
    hasTopic?: string;
  };
}

function readStoredLead(): StoredLead {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function paperTypeLabel(value: string): string {
  return PAPER_TYPES.find((type) => type.value === value)?.label ?? "Research paper";
}

function buildScope({
  paperType,
  topic,
  prompt,
  targetDate,
}: {
  paperType: string;
  topic: string;
  prompt: string;
  targetDate: string;
}): string {
  const lines = [
    "Summer Thesis Head Start plan",
    `Project type: ${paperTypeLabel(paperType)}`,
    topic ? `Working topic: ${topic}` : null,
    prompt ? `Assignment or advisor prompt: ${prompt}` : null,
    targetDate ? `Target date: ${targetDate}` : null,
    "",
    "8-week milestone plan:",
    ...SUMMER_PLAN.map((goal, index) => `Week ${index + 1}: ${goal}`),
  ].filter(Boolean);
  return lines.join("\n");
}

export default function SummerOnboarding() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createProject = useCreateProject();
  const { data: projects = [] } = useProjects();
  const storedLead = useMemo(readStoredLead, []);

  const [form, setForm] = useState({
    paperType: storedLead.form?.paperType ?? "senior_thesis",
    topic: "",
    workingQuestion: "",
    prompt: "",
    targetDate: "",
  });
  const [error, setError] = useState<string | null>(null);

  const leadContext = [storedLead.form?.school, storedLead.form?.major].filter(Boolean).join(" / ");

  const setField = (key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleCreateProject = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const projectTopic = form.topic.trim();
    const projectQuestion = form.workingQuestion.trim();
    if (!projectTopic && !projectQuestion) {
      setError("Add a working topic or research question to start the plan.");
      return;
    }

    const label = paperTypeLabel(form.paperType);
    const name = `${label} Head Start`;
    const project = await createProject.mutateAsync({
      name,
      description: `Summer Thesis Head Start${leadContext ? ` for ${leadContext}` : ""}.`,
      thesis: projectQuestion || projectTopic,
      scope: buildScope({
        paperType: form.paperType,
        topic: projectTopic,
        prompt: form.prompt.trim(),
        targetDate: form.targetDate.trim(),
      }),
    });

    toast({
      title: "Summer project created",
      description: "Your writing workspace is ready.",
    });
    setLocation(`/write?projectId=${project.id}&summer=1`);
  };

  const submitDisabled = createProject.isPending;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <Link href="/summer">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            <span className="font-sans uppercase tracking-[0.2em] font-bold text-primary text-sm">
              Summer Head Start
            </span>
          </div>
          <Link href="/projects">
            <Button variant="outline" size="sm">
              Projects
            </Button>
          </Link>
        </div>
      </header>

      <main className="container mx-auto max-w-6xl px-4 py-8 lg:py-12">
        <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr] items-start">
          <section className="space-y-5">
            <div className="space-y-3">
              <div className="text-xs font-mono uppercase tracking-[0.3em] text-muted-foreground">
                Build your first writing plan
              </div>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                Turn the summer invite into a real project.
              </h1>
              <p className="text-muted-foreground">
                Add the paper you are starting, then ScholarMark will open a dedicated writing
                workspace with your milestone plan attached.
              </p>
            </div>

            <Card className="hidden sm:block bg-muted/25">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CalendarCheck className="h-4 w-4 text-primary" />
                  Your 8-week plan
                </CardTitle>
                <CardDescription>
                  This gets saved into the project scope so your workspace starts with direction.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2">
                {SUMMER_PLAN.map((goal, index) => (
                  <div key={goal} className="flex items-start gap-2 rounded-md border p-3 text-sm">
                    <span className="font-mono text-xs uppercase tracking-widest text-primary pt-0.5">
                      Week {index + 1}
                    </span>
                    <span>{goal}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="hidden sm:grid gap-3 sm:grid-cols-3">
              {[
                ["Plan", "Research question and source list"],
                ["Draft", "Intro, thesis, and first section"],
                ["Revise", "Argument, structure, and citations"],
              ].map(([label, copy]) => (
                <div key={label} className="rounded-lg border bg-card p-3">
                  <div className="text-xs font-mono uppercase tracking-widest text-primary">
                    {label}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">{copy}</div>
                </div>
              ))}
            </div>
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Start my summer project</CardTitle>
              <CardDescription>
                Free accounts can keep one active project. If you already made one, use it for this
                campaign instead of creating a duplicate.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateProject} className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>What are you working on?</Label>
                    <Select value={form.paperType} onValueChange={setField("paperType")}>
                      <SelectTrigger>
                        <SelectValue />
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
                  <div className="space-y-1.5">
                    <Label htmlFor="summer-target-date">Target date</Label>
                    <Input
                      id="summer-target-date"
                      value={form.targetDate}
                      onChange={(event) => setField("targetDate")(event.target.value)}
                      placeholder="Before fall semester"
                      maxLength={80}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="summer-topic">Working topic</Label>
                  <Input
                    id="summer-topic"
                    value={form.topic}
                    onChange={(event) => setField("topic")(event.target.value)}
                    placeholder="Example: labor organizing in 1970s Los Angeles"
                    maxLength={180}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="summer-question">Research question or thesis</Label>
                  <Textarea
                    id="summer-question"
                    value={form.workingQuestion}
                    onChange={(event) => setField("workingQuestion")(event.target.value)}
                    placeholder="If you have one, paste it here. If not, write the rough question you want to explore."
                    className="min-h-24 resize-none"
                    maxLength={1000}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="summer-prompt">Prompt, advisor note, or constraints</Label>
                  <Textarea
                    id="summer-prompt"
                    value={form.prompt}
                    onChange={(event) => setField("prompt")(event.target.value)}
                    placeholder="Optional: paste the assignment prompt, seminar theme, or any source requirements."
                    className="min-h-24 resize-none"
                    maxLength={1600}
                  />
                </div>

                {error ? <p className="text-sm text-destructive">{error}</p> : null}
                {createProject.error ? (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    Could not create the project. If you are on the free plan and already have a
                    project, open that project and use it for the summer plan.
                  </div>
                ) : null}

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button type="submit" disabled={submitDisabled} className="sm:flex-1">
                    {submitDisabled ? (
                      <>
                        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" />
                        Create my plan
                      </>
                    )}
                  </Button>
                  <Button type="button" variant="outline" asChild>
                    <Link href={projects.length > 0 ? `/projects/${projects[0].id}` : "/projects"}>
                      <BookOpen className="mr-2 h-4 w-4" />
                      Use existing
                    </Link>
                  </Button>
                </div>

                <div className="flex items-start gap-2 rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <p>
                    ScholarMark helps with planning, feedback, and revision. You remain responsible
                    for checking outputs, citations, quotations, and your school policies.
                  </p>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8 flex justify-center">
          <Link href="/write">
            <Button variant="ghost">
              <PenLine className="mr-2 h-4 w-4" />
              Open writing workspace without setup
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
