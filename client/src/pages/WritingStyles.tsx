import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  PenLine,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  useCreateWritingStyle,
  useDeleteWritingStyle,
  useUpdateWritingStyle,
  useWritingStyles,
  type WritingStyle,
} from "@/hooks/useWritingStyles";
import type { VoiceProfile } from "@shared/schema";

interface DraftState {
  name: string;
  description: string;
  samples: string[];
}

const MAX_WRITING_STYLE_SAMPLES = 20;

const emptyDraft: DraftState = {
  name: "",
  description: "",
  samples: ["", ""],
};

function sampleWordCount(sample: string): number {
  return sample.split(/\s+/).filter(Boolean).length;
}

function getMutationMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const jsonMatch = error.message.match(/\{.*\}$/);
  if (!jsonMatch) return error.message || fallback;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.message || parsed.error || fallback;
  } catch {
    return fallback;
  }
}

function profileArray(items: string[] | undefined): string {
  return items && items.length > 0 ? items.join(", ") : "None";
}

export default function WritingStyles() {
  const { toast } = useToast();
  const { data: styles = [], isLoading } = useWritingStyles();
  const createStyle = useCreateWritingStyle();
  const updateStyle = useUpdateWritingStyle();
  const deleteStyle = useDeleteWritingStyle();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<DraftState>(emptyDraft);

  const selectedStyle = useMemo(
    () => styles.find((style) => style.id === selectedId) || null,
    [selectedId, styles],
  );

  useEffect(() => {
    if (isLoading) return;
    if (styles.length === 0 && !selectedId) {
      setIsCreating(true);
      return;
    }
    if (!selectedId && styles.length > 0 && !isCreating) {
      setSelectedId(styles[0].id);
    }
  }, [isCreating, isLoading, selectedId, styles]);

  useEffect(() => {
    if (!selectedStyle || isCreating) return;
    setDraft({
      name: selectedStyle.name,
      description: selectedStyle.description || "",
      samples: selectedStyle.samples.length > 0 ? selectedStyle.samples : ["", ""],
    });
  }, [isCreating, selectedStyle]);

  const updateSample = (index: number, value: string) => {
    setDraft((current) => ({
      ...current,
      samples: current.samples.map((sample, sampleIndex) => sampleIndex === index ? value : sample),
    }));
  };

  const addSample = () => {
    setDraft((current) => {
      if (current.samples.length >= MAX_WRITING_STYLE_SAMPLES) return current;
      return { ...current, samples: [...current.samples, ""] };
    });
  };

  const removeSample = (index: number) => {
    setDraft((current) => {
      if (current.samples.length <= 2) return current;
      return { ...current, samples: current.samples.filter((_, sampleIndex) => sampleIndex !== index) };
    });
  };

  const startCreate = () => {
    setIsCreating(true);
    setSelectedId(null);
    setDraft(emptyDraft);
  };

  const saveNewStyle = async () => {
    try {
      const created = await createStyle.mutateAsync({
        name: draft.name,
        description: draft.description,
        samples: draft.samples,
      });
      setIsCreating(false);
      setSelectedId(created.id);
      toast({ title: "Writing style created", description: created.name });
    } catch (error) {
      toast({
        title: "Could not create style",
        description: getMutationMessage(error, "Check the name and samples."),
        variant: "destructive",
      });
    }
  };

  const saveDetails = async () => {
    if (!selectedStyle) return;
    try {
      await updateStyle.mutateAsync({
        id: selectedStyle.id,
        data: {
          name: draft.name,
          description: draft.description,
        },
      });
      toast({ title: "Writing style saved" });
    } catch (error) {
      toast({
        title: "Could not save style",
        description: getMutationMessage(error, "Check the name."),
        variant: "destructive",
      });
    }
  };

  const reanalyzeStyle = async () => {
    if (!selectedStyle) return;
    try {
      await updateStyle.mutateAsync({
        id: selectedStyle.id,
        data: {
          name: draft.name,
          description: draft.description,
          samples: draft.samples,
          reanalyze: true,
        },
      });
      toast({ title: "Writing style refreshed" });
    } catch (error) {
      toast({
        title: "Could not refresh style",
        description: getMutationMessage(error, "Check the samples."),
        variant: "destructive",
      });
    }
  };

  const removeStyle = async () => {
    if (!selectedStyle) return;
    if (!window.confirm(`Delete "${selectedStyle.name}"?`)) return;
    try {
      await deleteStyle.mutateAsync(selectedStyle.id);
      const nextStyle = styles.find((style) => style.id !== selectedStyle.id) || null;
      setSelectedId(nextStyle?.id || null);
      setIsCreating(false);
      toast({ title: "Writing style deleted" });
    } catch {
      toast({ title: "Could not delete style", variant: "destructive" });
    }
  };

  const activeProfile = isCreating ? null : selectedStyle?.voiceProfile || null;
  const totalWords = draft.samples.reduce((sum, sample) => sum + sampleWordCount(sample), 0);
  const isBusy = createStyle.isPending || updateStyle.isPending || deleteStyle.isPending;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <PenLine className="h-5 w-5 text-primary" />
            <h1 className="eva-section-title">WRITING STYLES</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard">
              <Button variant="outline" size="sm" className="uppercase tracking-wider text-xs font-mono">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Home
              </Button>
            </Link>
            <Link href="/write">
              <Button variant="outline" size="sm" className="uppercase tracking-wider text-xs font-mono">
                Write
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 eva-grid-bg">
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 min-h-[calc(100vh-112px)]">
          <aside className="rounded-xl border border-border bg-card/80 overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider">Library</h2>
                <p className="text-xs text-muted-foreground">{styles.length} saved</p>
              </div>
              <Button size="sm" onClick={startCreate}>
                <Plus className="h-4 w-4 mr-2" />
                New
              </Button>
            </div>
            <ScrollArea className="h-[calc(100vh-184px)]">
              <div className="p-3 space-y-2">
                {isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground p-3">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading styles
                  </div>
                ) : styles.length === 0 && !isCreating ? (
                  <button
                    type="button"
                    onClick={startCreate}
                    className="w-full rounded-lg border border-dashed border-border p-4 text-left text-sm text-muted-foreground hover:bg-muted/50"
                  >
                    Add your first writing style
                  </button>
                ) : (
                  styles.map((style) => (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => {
                        setIsCreating(false);
                        setSelectedId(style.id);
                      }}
                      className={`w-full rounded-lg border p-3 text-left transition ${
                        selectedId === style.id && !isCreating
                          ? "border-primary bg-primary/10"
                          : "border-border bg-background hover:bg-muted/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{style.name}</span>
                        {style.voiceProfile && <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {style.description || style.voiceProfile?.voiceSummary || "No description"}
                      </div>
                      <div className="mt-2">
                        <Badge variant="outline" className="text-[10px] font-mono uppercase">
                          {style.samples.length} samples
                        </Badge>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </aside>

          <section className="rounded-xl border border-border bg-card/80 overflow-hidden">
            <div className="p-5 border-b border-border flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">
                  {isCreating ? "New Writing Style" : selectedStyle?.name || "Select a Writing Style"}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {totalWords} words across {draft.samples.length} samples
                </p>
              </div>
              {!isCreating && selectedStyle && (
                <Button variant="ghost" size="sm" onClick={removeStyle} disabled={isBusy}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>

            <ScrollArea className="h-[calc(100vh-184px)]">
              <div className="p-5 space-y-5 max-w-5xl">
                {!isCreating && !selectedStyle && styles.length > 0 ? (
                  <p className="text-sm text-muted-foreground">Select a writing style.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4">
                      <Card className="border-border bg-background/80">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm">Details</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="space-y-1">
                            <Label htmlFor="style-name" className="text-xs uppercase tracking-wider">Name</Label>
                            <Input
                              id="style-name"
                              value={draft.name}
                              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                              placeholder="Academic essays"
                              maxLength={80}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="style-description" className="text-xs uppercase tracking-wider">Description</Label>
                            <Textarea
                              id="style-description"
                              value={draft.description}
                              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                              placeholder="Short label for when this style should be used"
                              className="min-h-[88px]"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            {isCreating ? (
                              <Button onClick={saveNewStyle} disabled={isBusy}>
                                {createStyle.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                                Analyze and Save
                              </Button>
                            ) : (
                              <>
                                <Button onClick={saveDetails} disabled={!selectedStyle || isBusy}>
                                  {updateStyle.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                                  Save Details
                                </Button>
                                <Button variant="outline" onClick={reanalyzeStyle} disabled={!selectedStyle || isBusy}>
                                  <RotateCcw className="h-4 w-4 mr-2" />
                                  Re-analyze Samples
                                </Button>
                              </>
                            )}
                          </div>
                        </CardContent>
                      </Card>

                      <ProfileSummary profile={activeProfile} />
                    </div>

                    <Separator />

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold uppercase tracking-wider">Samples</h3>
                        <Button variant="outline" size="sm" onClick={addSample} disabled={draft.samples.length >= MAX_WRITING_STYLE_SAMPLES || isBusy}>
                          <Plus className="h-4 w-4 mr-2" />
                          Sample
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                        {draft.samples.map((sample, index) => (
                          <div key={index} className="rounded-lg border border-border bg-background/80 p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs uppercase tracking-wider">Sample {index + 1}</Label>
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] text-muted-foreground">{sampleWordCount(sample)} words</span>
                                {draft.samples.length > 2 && (
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeSample(index)}>
                                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                  </Button>
                                )}
                              </div>
                            </div>
                            <Textarea
                              value={sample}
                              onChange={(event) => updateSample(index, event.target.value)}
                              placeholder="Paste your writing here"
                              className="min-h-[160px] text-sm"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </ScrollArea>
          </section>
        </div>
      </main>
    </div>
  );
}

function ProfileSummary({ profile }: { profile: VoiceProfile | null }) {
  if (!profile) {
    return (
      <Card className="border-border bg-background/80">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No profile generated yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border bg-background/80">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{profile.voiceSummary}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ProfileLine label="Rhythm" value={profile.avgSentenceLength} />
          <ProfileLine label="Vocabulary" value={profile.vocabularyLevel} />
          <ProfileLine label="Paragraphs" value={profile.paragraphStructure} />
          <ProfileLine label="Evidence" value={profile.evidenceIntroduction} />
          <ProfileLine label="Argument" value={profile.argumentStructure} />
          <ProfileLine label="Hedging" value={profile.hedgingStyle} />
        </div>
        <div className="space-y-2">
          <ProfileLine label="Tone" value={profileArray(profile.toneMarkers)} />
          <ProfileLine label="Transitions" value={profileArray(profile.commonTransitions)} />
          <ProfileLine label="Distinctive" value={profileArray(profile.distinctivePhrases)} />
          <ProfileLine label="Avoid" value={profileArray(profile.avoidedPatterns)} />
        </div>
      </CardContent>
    </Card>
  );
}

function ProfileLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xs leading-relaxed">{value || "None"}</div>
    </div>
  );
}
