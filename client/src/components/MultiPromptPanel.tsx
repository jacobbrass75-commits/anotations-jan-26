import { useState, useCallback } from "react";
import { Plus, X, Sparkles, Save, FolderOpen, Loader2 } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { PromptTemplate } from "@shared/schema";

type ThoroughnessLevel = "quick" | "standard" | "thorough" | "exhaustive";

// Color palette for prompts
const PROMPT_COLORS = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#22c55e", // green
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
];

function getPromptColor(index: number): string {
  return PROMPT_COLORS[index % PROMPT_COLORS.length];
}

export interface Prompt {
  id: string;
  text: string;
  color: string;
}

interface MultiPromptPanelProps {
  documentId: string | null;
  projectId?: string;
  onAnalyze: (
    prompts: Prompt[],
    thoroughness: ThoroughnessLevel
  ) => Promise<void>;
  isAnalyzing: boolean;
  hasAnalyzed: boolean;
  annotationCount: number;
  promptStats?: Map<number, number>;
  templates?: PromptTemplate[];
  onSaveTemplate?: (name: string, prompts: Prompt[]) => Promise<void>;
  onLoadTemplate?: (template: PromptTemplate) => void;
  isSavingTemplate?: boolean;
}

export function MultiPromptPanel({
  documentId,
  projectId,
  onAnalyze,
  isAnalyzing,
  hasAnalyzed,
  annotationCount,
  promptStats,
  templates = [],
  onSaveTemplate,
  onLoadTemplate,
  isSavingTemplate = false,
}: MultiPromptPanelProps) {
  const [prompts, setPrompts] = useState<Prompt[]>([
    { id: Math.random().toString(36).slice(2), text: "", color: getPromptColor(0) },
  ]);
  const [thoroughness, setThoroughness] =
    useState<ThoroughnessLevel>("standard");
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");

  const addPrompt = useCallback(() => {
    const newIndex = prompts.length;
    setPrompts((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).slice(2),
        text: "",
        color: getPromptColor(newIndex),
      },
    ]);
  }, [prompts.length]);

  const removePrompt = useCallback((id: string) => {
    setPrompts((prev) => {
      const filtered = prev.filter((p) => p.id !== id);
      // Reassign colors to maintain order
      return filtered.map((p, i) => ({
        ...p,
        color: getPromptColor(i),
      }));
    });
  }, []);

  const updatePromptText = useCallback((id: string, text: string) => {
    setPrompts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, text } : p))
    );
  }, []);

  const handleAnalyze = useCallback(async () => {
    const validPrompts = prompts.filter((p) => p.text.trim());
    if (validPrompts.length === 0) return;
    await onAnalyze(validPrompts, thoroughness);
  }, [prompts, thoroughness, onAnalyze]);

  const handleSaveTemplate = useCallback(async () => {
    if (!onSaveTemplate || !templateName.trim()) return;
    const validPrompts = prompts.filter((p) => p.text.trim());
    if (validPrompts.length === 0) return;
    await onSaveTemplate(templateName.trim(), validPrompts);
    setTemplateName("");
    setSaveDialogOpen(false);
  }, [prompts, templateName, onSaveTemplate]);

  const handleLoadTemplate = useCallback(
    (template: PromptTemplate) => {
      const loadedPrompts = template.prompts.map((p, i) => ({
        id: Math.random().toString(36).slice(2),
        text: p.text,
        color: p.color || getPromptColor(i),
      }));
      setPrompts(loadedPrompts);
      onLoadTemplate?.(template);
    },
    [onLoadTemplate]
  );

  const validPromptCount = prompts.filter((p) => p.text.trim()).length;
  const canAnalyze = documentId && validPromptCount > 0 && !isAnalyzing;

  return (
    <>
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-3 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Research Prompts</h2>
            </div>
            {hasAnalyzed && (
              <Badge variant="secondary">{annotationCount} annotations</Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="flex-1 flex flex-col gap-4 p-4 overflow-hidden">
          {/* Prompts List */}
          <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
            {prompts.map((prompt, index) => (
              <div key={prompt.id} className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: prompt.color }}
                />
                <Input
                  value={prompt.text}
                  onChange={(e) => updatePromptText(prompt.id, e.target.value)}
                  placeholder={`Prompt ${index + 1}: e.g., "Find evidence about..."`}
                  className="flex-1"
                  disabled={isAnalyzing}
                />
                {prompts.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => removePrompt(prompt.id)}
                    disabled={isAnalyzing}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
                {promptStats?.has(index) && (
                  <Badge variant="outline" className="shrink-0">
                    {promptStats.get(index)}
                  </Badge>
                )}
              </div>
            ))}
          </div>

          {/* Add Prompt Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={addPrompt}
            disabled={isAnalyzing || prompts.length >= 8}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Prompt
          </Button>

          {/* Thoroughness Selector */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Thoroughness</Label>
            <Select
              value={thoroughness}
              onValueChange={(v) => setThoroughness(v as ThoroughnessLevel)}
              disabled={isAnalyzing}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="quick">Quick (fastest)</SelectItem>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="thorough">Thorough</SelectItem>
                <SelectItem value="exhaustive">Exhaustive (slowest)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            {projectId && onSaveTemplate && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={isAnalyzing}>
                    <FolderOpen className="h-4 w-4 mr-1" />
                    Templates
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem
                    onClick={() => setSaveDialogOpen(true)}
                    disabled={validPromptCount === 0}
                  >
                    <Save className="h-4 w-4 mr-2" />
                    Save Current as Template
                  </DropdownMenuItem>
                  {templates.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      {templates.map((t) => (
                        <DropdownMenuItem
                          key={t.id}
                          onClick={() => handleLoadTemplate(t)}
                        >
                          {t.name} ({t.prompts.length} prompts)
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <Button
              onClick={handleAnalyze}
              disabled={!canAnalyze}
              className="flex-1"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Analyze ({validPromptCount} prompt{validPromptCount !== 1 ? "s" : ""})
                </>
              )}
            </Button>
          </div>

          {/* Help Text */}
          <p className="text-xs text-muted-foreground">
            Each prompt runs a full analysis in parallel. Add multiple focused
            prompts for comprehensive annotation coverage.
          </p>
        </CardContent>
      </Card>

      {/* Save Template Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as Template</DialogTitle>
            <DialogDescription>
              Save your current prompts as a reusable template for this project.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="template-name">Template Name</Label>
            <Input
              id="template-name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="e.g., Historical Analysis"
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveTemplate}
              disabled={!templateName.trim() || isSavingTemplate}
            >
              {isSavingTemplate ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
