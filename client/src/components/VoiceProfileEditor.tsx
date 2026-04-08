import { useState } from "react";
import { Pen, Sparkles, Trash2, RotateCcw, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  useVoiceProfile,
  useAnalyzeVoiceProfile,
  useUpdateVoiceProfile,
  useDeleteVoiceProfile,
  type VoiceProfile,
} from "@/hooks/useVoiceProfile";

interface VoiceProfileEditorProps {
  projectId: string;
}

export default function VoiceProfileEditor({ projectId }: VoiceProfileEditorProps) {
  const { toast } = useToast();
  const { data, isLoading } = useVoiceProfile(projectId);
  const analyzeMutation = useAnalyzeVoiceProfile();
  const updateMutation = useUpdateVoiceProfile();
  const deleteMutation = useDeleteVoiceProfile();

  const [samples, setSamples] = useState<string[]>([""]);
  const [isEditing, setIsEditing] = useState(false);
  const [editedProfile, setEditedProfile] = useState<VoiceProfile | null>(null);

  const voiceProfile = data?.voiceProfile ?? null;
  const isAnalyzing = analyzeMutation.isPending;

  const addSample = () => {
    if (samples.length < 10) setSamples([...samples, ""]);
  };

  const removeSample = (index: number) => {
    if (samples.length > 1) setSamples(samples.filter((_, i) => i !== index));
  };

  const updateSample = (index: number, value: string) => {
    const updated = [...samples];
    updated[index] = value;
    setSamples(updated);
  };

  const handleAnalyze = async () => {
    const validSamples = samples.filter((s) => s.trim().length > 0);
    if (validSamples.length < 2) {
      toast({ title: "Need more samples", description: "Provide at least 2 writing samples.", variant: "destructive" });
      return;
    }
    try {
      await analyzeMutation.mutateAsync({ projectId, samples: validSamples });
      toast({ title: "Voice profile created", description: "Your writing style has been analyzed." });
    } catch {
      toast({ title: "Analysis failed", description: "Could not analyze writing samples. Try again.", variant: "destructive" });
    }
  };

  const handleStartEdit = () => {
    if (voiceProfile) {
      setEditedProfile({ ...voiceProfile });
      setIsEditing(true);
    }
  };

  const handleSaveEdit = async () => {
    if (!editedProfile) return;
    try {
      await updateMutation.mutateAsync({ projectId, voiceProfile: editedProfile });
      setIsEditing(false);
      setEditedProfile(null);
      toast({ title: "Profile updated", description: "Voice profile saved." });
    } catch {
      toast({ title: "Save failed", description: "Could not save voice profile.", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(projectId);
      setIsEditing(false);
      setEditedProfile(null);
      toast({ title: "Profile deleted", description: "Voice profile removed." });
    } catch {
      toast({ title: "Delete failed", description: "Could not delete voice profile.", variant: "destructive" });
    }
  };

  const handleReanalyze = async () => {
    const validSamples = samples.filter((s) => s.trim().length > 0);
    if (validSamples.length < 2) {
      toast({ title: "Need more samples", description: "Add at least 2 writing samples to re-analyze.", variant: "destructive" });
      return;
    }
    try {
      await analyzeMutation.mutateAsync({ projectId, samples: validSamples });
      setIsEditing(false);
      setEditedProfile(null);
      toast({ title: "Voice profile updated", description: "Re-analyzed with new samples." });
    } catch {
      toast({ title: "Re-analysis failed", description: "Could not re-analyze. Try again.", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // No voice profile yet — show sample input UI
  if (!voiceProfile && !isAnalyzing) {
    return (
      <div className="space-y-6 max-w-3xl">
        <div>
          <h3 className="text-lg font-semibold">Writing Voice</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Paste 2-5 samples of your own writing. Scholar Mark will analyze your style and use it when generating text for this project.
          </p>
        </div>

        <div className="space-y-4">
          {samples.map((sample, i) => (
            <div key={i} className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor={`sample-${i}`} className="text-sm font-medium">
                  Sample {i + 1}
                </Label>
                {samples.length > 1 && (
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeSample(i)}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                )}
              </div>
              <Textarea
                id={`sample-${i}`}
                value={sample}
                onChange={(e) => updateSample(i, e.target.value)}
                placeholder="Paste a writing sample here (500-1500 words works best)..."
                className="min-h-[120px] font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">{sample.split(/\s+/).filter(Boolean).length} words</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {samples.length < 10 && (
            <Button variant="outline" size="sm" onClick={addSample}>
              + Add Sample
            </Button>
          )}
          <div className="flex-1" />
          <Button onClick={handleAnalyze} disabled={isAnalyzing}>
            {isAnalyzing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Analyze My Style
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  // Analyzing state
  if (isAnalyzing) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Analyzing your writing style...</p>
      </div>
    );
  }

  // Voice profile exists — show it (view or edit mode)
  const profile = isEditing ? editedProfile! : voiceProfile!;

  const updateField = (field: keyof VoiceProfile, value: string | string[]) => {
    if (!editedProfile) return;
    setEditedProfile({ ...editedProfile, [field]: value });
  };

  const updateArrayField = (field: keyof VoiceProfile, value: string) => {
    if (!editedProfile) return;
    setEditedProfile({ ...editedProfile, [field]: value.split(",").map((s) => s.trim()).filter(Boolean) });
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Writing Voice</h3>
          <p className="text-sm text-muted-foreground mt-1">
            This profile is automatically applied when Scholar Mark generates text for this project.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <Button variant="outline" size="sm" onClick={() => { setIsEditing(false); setEditedProfile(null); }}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveEdit} disabled={updateMutation.isPending}>
                <Save className="h-3 w-3 mr-2" />
                Save
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={handleStartEdit}>
                <Pen className="h-3 w-3 mr-2" />
                Edit
              </Button>
              <Button variant="ghost" size="sm" onClick={handleDelete} disabled={deleteMutation.isPending}>
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Summary Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Voice Summary</CardTitle>
        </CardHeader>
        <CardContent>
          {isEditing ? (
            <Textarea
              value={profile.voiceSummary}
              onChange={(e) => updateField("voiceSummary", e.target.value)}
              className="min-h-[80px] text-sm"
            />
          ) : (
            <p className="text-sm text-muted-foreground">{profile.voiceSummary}</p>
          )}
        </CardContent>
      </Card>

      {/* Style Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ProfileField label="Sentence Rhythm" value={profile.avgSentenceLength} field="avgSentenceLength" isEditing={isEditing} onChange={updateField} />
        <ProfileField label="Vocabulary Level" value={profile.vocabularyLevel} field="vocabularyLevel" isEditing={isEditing} onChange={updateField} />
        <ProfileField label="Paragraph Structure" value={profile.paragraphStructure} field="paragraphStructure" isEditing={isEditing} onChange={updateField} />
        <ProfileField label="Evidence Introduction" value={profile.evidenceIntroduction} field="evidenceIntroduction" isEditing={isEditing} onChange={updateField} />
        <ProfileField label="Argument Structure" value={profile.argumentStructure} field="argumentStructure" isEditing={isEditing} onChange={updateField} />
        <ProfileField label="Hedging Style" value={profile.hedgingStyle} field="hedgingStyle" isEditing={isEditing} onChange={updateField} />
        <ProfileField label="Opening Pattern" value={profile.openingPattern} field="openingPattern" isEditing={isEditing} onChange={updateField} />
        <ProfileField label="Closing Pattern" value={profile.closingPattern} field="closingPattern" isEditing={isEditing} onChange={updateField} />
      </div>

      <Separator />

      {/* Array Fields */}
      <ArrayField label="Tone Markers" items={profile.toneMarkers} field="toneMarkers" isEditing={isEditing} onChange={updateArrayField} />
      <ArrayField label="Distinctive Phrases" items={profile.distinctivePhrases} field="distinctivePhrases" isEditing={isEditing} onChange={updateArrayField} />
      <ArrayField label="Common Transitions" items={profile.commonTransitions} field="commonTransitions" isEditing={isEditing} onChange={updateArrayField} />
      <ArrayField label="Patterns to Avoid" items={profile.avoidedPatterns} field="avoidedPatterns" isEditing={isEditing} onChange={updateArrayField} variant="destructive" />

      <Separator />

      {/* Re-analyze section */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium">Re-analyze with new samples</h4>
        <p className="text-xs text-muted-foreground">
          Add new writing samples to regenerate the profile. This replaces the current one.
        </p>
        {samples.map((sample, i) => (
          <div key={i} className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Sample {i + 1}</Label>
              {samples.length > 1 && (
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeSample(i)}>
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              )}
            </div>
            <Textarea
              value={sample}
              onChange={(e) => updateSample(i, e.target.value)}
              placeholder="Paste a writing sample..."
              className="min-h-[80px] font-mono text-xs"
            />
          </div>
        ))}
        <div className="flex items-center gap-3">
          {samples.length < 10 && (
            <Button variant="outline" size="sm" onClick={addSample}>+ Add Sample</Button>
          )}
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={handleReanalyze} disabled={isAnalyzing}>
            <RotateCcw className="h-3 w-3 mr-2" />
            Re-analyze
          </Button>
        </div>
      </div>
    </div>
  );
}

// --- Sub-components ---

function ProfileField({
  label,
  value,
  field,
  isEditing,
  onChange,
}: {
  label: string;
  value: string;
  field: keyof VoiceProfile;
  isEditing: boolean;
  onChange: (field: keyof VoiceProfile, value: string) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs font-medium uppercase tracking-wider">{label}</CardDescription>
      </CardHeader>
      <CardContent>
        {isEditing ? (
          <Input value={value} onChange={(e) => onChange(field, e.target.value)} className="text-sm" />
        ) : (
          <p className="text-sm">{value}</p>
        )}
      </CardContent>
    </Card>
  );
}

function ArrayField({
  label,
  items,
  field,
  isEditing,
  onChange,
  variant = "secondary",
}: {
  label: string;
  items: string[];
  field: keyof VoiceProfile;
  isEditing: boolean;
  onChange: (field: keyof VoiceProfile, value: string) => void;
  variant?: "secondary" | "destructive";
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium uppercase tracking-wider">{label}</Label>
      {isEditing ? (
        <Input
          value={items.join(", ")}
          onChange={(e) => onChange(field, e.target.value)}
          placeholder="Comma-separated values"
          className="text-sm"
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((item, i) => (
            <Badge key={i} variant={variant === "destructive" ? "destructive" : "secondary"} className="text-xs">
              {item}
            </Badge>
          ))}
          {items.length === 0 && <p className="text-sm text-muted-foreground italic">None</p>}
        </div>
      )}
    </div>
  );
}
