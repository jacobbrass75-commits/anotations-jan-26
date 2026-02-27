import { useState } from "react";
import { Sparkles, Target, CheckCircle2 } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ThoroughnessLevel = 'quick' | 'standard' | 'thorough' | 'exhaustive';

interface IntentPanelProps {
  documentId: string | null;
  onAnalyze: (research: string, goals: string, thoroughness: ThoroughnessLevel) => Promise<void>;
  isAnalyzing: boolean;
  hasAnalyzed: boolean;
  annotationCount: number;
  defaultResearch?: string;
  defaultGoals?: string;
}

const thoroughnessDescriptions: Record<ThoroughnessLevel, string> = {
  quick: "Fast scan (~10 sections)",
  standard: "Balanced (~30 sections)",
  thorough: "Deep analysis (~100 sections)",
  exhaustive: "Full document scan",
};

export function IntentPanel({
  documentId,
  onAnalyze,
  isAnalyzing,
  hasAnalyzed,
  annotationCount,
  defaultResearch = "",
  defaultGoals = "",
}: IntentPanelProps) {
  const [research, setResearch] = useState(defaultResearch);
  const [goals, setGoals] = useState(defaultGoals);
  const [thoroughness, setThoroughness] = useState<ThoroughnessLevel>("standard");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (research.trim() && goals.trim()) {
      await onAnalyze(research, goals, thoroughness);
    }
  };

  const isDisabled = !documentId || isAnalyzing;
  const canSubmit = research.trim() && goals.trim() && !isDisabled;

  return (
    <Card className="h-full flex flex-col eva-corner-decor">
      <CardHeader className="flex flex-row items-center gap-2 pb-4">
        <Target className="h-5 w-5 text-primary" />
        <h2 className="eva-section-title text-sm">RESEARCH INTENT</h2>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="research" className="text-sm font-medium">
              What are you researching?
            </Label>
            <Textarea
              id="research"
              placeholder="DESCRIBE YOUR RESEARCH TOPIC, THESIS, OR AREA OF STUDY..."
              value={research}
              onChange={(e) => setResearch(e.target.value)}
              className="h-28 resize-none eva-focus-glow font-mono text-sm"
              disabled={isDisabled}
              data-testid="textarea-research"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="goals" className="text-sm font-medium">
              What do you want to find?
            </Label>
            <Textarea
              id="goals"
              placeholder="KEY QUOTES, EVIDENCE, ARGUMENTS, METHODOLOGY REFERENCES..."
              value={goals}
              onChange={(e) => setGoals(e.target.value)}
              className="h-24 resize-none eva-focus-glow font-mono text-sm"
              disabled={isDisabled}
              data-testid="textarea-goals"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="thoroughness" className="text-xs uppercase tracking-wider font-medium">
              Analysis Depth
            </Label>
            <Select
              value={thoroughness}
              onValueChange={(v) => setThoroughness(v as ThoroughnessLevel)}
              disabled={isDisabled}
            >
              <SelectTrigger id="thoroughness" data-testid="select-thoroughness">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="quick">QUICK - {thoroughnessDescriptions.quick.toUpperCase()}</SelectItem>
                <SelectItem value="standard">STANDARD - {thoroughnessDescriptions.standard.toUpperCase()}</SelectItem>
                <SelectItem value="thorough">THOROUGH - {thoroughnessDescriptions.thorough.toUpperCase()}</SelectItem>
                <SelectItem value="exhaustive">EXHAUSTIVE - {thoroughnessDescriptions.exhaustive.toUpperCase()}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="mt-auto pt-4">
            <Button
              type="submit"
              className="w-full uppercase tracking-widest font-semibold"
              disabled={!canSubmit}
              data-testid="button-analyze"
            >
              {isAnalyzing ? (
                <span className="flex items-center gap-2">
                  <div className="eva-status-warning" />
                  ANALYZING...
                </span>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Analyze Document
                </>
              )}
            </Button>
          </div>

          {hasAnalyzed && (
            <div className="flex items-center gap-2 p-3 bg-chart-2/10 rounded-lg border border-chart-2/30">
              <CheckCircle2 className="h-4 w-4 text-chart-2" />
              <span className="text-sm text-foreground">Analysis complete</span>
              <Badge variant="secondary" className="ml-auto">
                {annotationCount} highlights
              </Badge>
            </div>
          )}

          {!documentId && (
            <p className="text-xs text-muted-foreground text-center">
              Upload a document to begin analysis
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
