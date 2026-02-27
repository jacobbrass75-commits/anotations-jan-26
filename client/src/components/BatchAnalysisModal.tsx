import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Sparkles, ChevronDown, FileText, CheckCircle, XCircle, Clock } from "lucide-react";
import { useBatchAnalyze } from "@/hooks/useProjects";
import { useToast } from "@/hooks/use-toast";
import type { ProjectDocument, BatchAnalysisResponse, BatchDocumentResult, AnnotationCategory } from "@shared/schema";

interface BatchAnalysisModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  documents: (ProjectDocument & { document: { id: string; filename: string; summary: string | null } })[];
  projectThesis?: string | null;
}

const ANNOTATION_CATEGORIES: { value: AnnotationCategory; label: string }[] = [
  { value: "key_quote", label: "Key Quotes" },
  { value: "evidence", label: "Evidence" },
  { value: "argument", label: "Arguments" },
  { value: "methodology", label: "Methodology" },
];

export function BatchAnalysisModal({
  open,
  onOpenChange,
  projectId,
  documents,
  projectThesis,
}: BatchAnalysisModalProps) {
  const { toast } = useToast();
  const batchAnalyze = useBatchAnalyze();
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [intent, setIntent] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<Set<AnnotationCategory>>(new Set());
  const [maxAnnotations, setMaxAnnotations] = useState(30);
  const [minConfidence, setMinConfidence] = useState(0.7);
  const [response, setResponse] = useState<BatchAnalysisResponse | null>(null);

  useEffect(() => {
    if (open && projectThesis && !intent) {
      setIntent(projectThesis);
    }
  }, [open, projectThesis]);

  useEffect(() => {
    if (!open) {
      setSelectedIds(new Set());
      setResponse(null);
      setIntent("");
      setSelectedCategories(new Set());
      setMaxAnnotations(30);
      setMinConfidence(0.7);
      setAdvancedOpen(false);
    }
  }, [open]);

  const handleSelectAll = () => {
    setSelectedIds(new Set(documents.map(d => d.id)));
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  const toggleDocument = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const toggleCategory = (category: AnnotationCategory) => {
    const newSet = new Set(selectedCategories);
    if (newSet.has(category)) {
      newSet.delete(category);
    } else {
      newSet.add(category);
    }
    setSelectedCategories(newSet);
  };

  const handleAnalyze = async () => {
    if (selectedIds.size === 0 || !intent.trim()) return;

    try {
      const constraints: {
        categories?: AnnotationCategory[];
        maxAnnotationsPerDoc?: number;
        minConfidence?: number;
      } = {};
      
      if (selectedCategories.size > 0) {
        constraints.categories = Array.from(selectedCategories);
      }
      if (maxAnnotations !== 30) {
        constraints.maxAnnotationsPerDoc = maxAnnotations;
      }
      if (minConfidence !== 0.7) {
        constraints.minConfidence = minConfidence;
      }

      const result = await batchAnalyze.mutateAsync({
        projectId,
        projectDocumentIds: Array.from(selectedIds),
        intent,
        constraints: Object.keys(constraints).length > 0 ? constraints : undefined,
      });
      
      setResponse(result);
      toast({
        title: "Batch Analysis Complete",
        description: `Created ${result.totalAnnotationsCreated} annotations across ${result.successfulDocuments} documents`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to complete batch analysis",
        variant: "destructive",
      });
    }
  };

  const getStatusIcon = (status: BatchDocumentResult["status"]) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="h-4 w-4 text-chart-2" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-destructive" />;
      case "processing":
        return <div className="eva-hex-spinner" style={{ width: "1rem", height: "1rem" }} />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const isComplete = response !== null;
  const isAnalyzing = batchAnalyze.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto eva-grid-bg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            <span className="eva-section-title text-sm">BATCH ANALYSIS // MAGI PROTOCOL</span>
          </DialogTitle>
          <DialogDescription>
            Analyze multiple documents with the same research focus
          </DialogDescription>
        </DialogHeader>

        {!isComplete ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Select Documents ({selectedIds.size}/{documents.length})</Label>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={handleSelectAll} data-testid="button-select-all">
                    Select All
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleDeselectAll} data-testid="button-deselect-all">
                    Deselect All
                  </Button>
                </div>
              </div>
              <ScrollArea className="h-48 border rounded-md p-2">
                <div className="space-y-2">
                  {documents.map((doc) => (
                    <label
                      key={doc.id}
                      className="flex items-center gap-3 p-2 hover-elevate rounded-md cursor-pointer font-mono text-sm"
                      data-testid={`row-doc-${doc.id}`}
                    >
                      <Checkbox
                        checked={selectedIds.has(doc.id)}
                        onCheckedChange={() => toggleDocument(doc.id)}
                        data-testid={`checkbox-doc-${doc.id}`}
                      />
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm flex-1 truncate">{doc.document.filename}</span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </div>

            <div className="space-y-2">
              <Label>Research Intent</Label>
              <Textarea
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder="What are you looking for across these documents?"
                rows={3}
                className="resize-none"
                data-testid="input-batch-intent"
              />
            </div>

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full justify-between uppercase tracking-wider text-xs" data-testid="button-advanced-options">
                  Advanced Options
                  <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Filter by Category (optional)</Label>
                  <div className="flex flex-wrap gap-2">
                    {ANNOTATION_CATEGORIES.map((cat) => (
                      <Badge
                        key={cat.value}
                        variant={selectedCategories.has(cat.value) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => toggleCategory(cat.value)}
                        data-testid={`badge-category-${cat.value}`}
                      >
                        {cat.label}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Leave empty to include all categories
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Max Annotations per Document: {maxAnnotations}</Label>
                  <Slider
                    value={[maxAnnotations]}
                    onValueChange={([v]) => setMaxAnnotations(v)}
                    min={1}
                    max={50}
                    step={1}
                    data-testid="slider-max-annotations"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Min Confidence Score: {minConfidence.toFixed(2)}</Label>
                  <Slider
                    value={[minConfidence]}
                    onValueChange={([v]) => setMinConfidence(v)}
                    min={0.5}
                    max={1}
                    step={0.05}
                    data-testid="slider-min-confidence"
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        ) : (
          <div className="space-y-4">
            <Alert variant={response.status === "failed" ? "destructive" : "default"}>
              <AlertTitle>
                {response.status === "completed" ? "Analysis Complete" : 
                 response.status === "partial" ? "Partial Success" : "Analysis Failed"}
              </AlertTitle>
              <AlertDescription>
                Processed {response.successfulDocuments} of {response.totalDocuments} documents, 
                created {response.totalAnnotationsCreated} annotations in {(response.totalTimeMs / 1000).toFixed(1)}s
              </AlertDescription>
            </Alert>

            <ScrollArea className="h-48 border rounded-md p-2">
              <div className="space-y-2">
                {response.results.map((result) => (
                  <div
                    key={result.projectDocumentId}
                    className="flex items-center gap-3 p-2 rounded-md eva-clip-sm"
                    data-testid={`result-${result.projectDocumentId}`}
                  >
                    {getStatusIcon(result.status)}
                    <span className="text-sm flex-1 truncate">{result.filename || "Document"}</span>
                    {result.status === "completed" && (
                      <Badge variant="secondary">{result.annotationsCreated} annotations</Badge>
                    )}
                    {result.error && (
                      <span className="text-xs text-destructive truncate max-w-[200px]">{result.error}</span>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {isAnalyzing && (
          <div className="space-y-2">
            <Progress value={50} className="animate-pulse" />
            <p className="text-sm text-center text-muted-foreground font-mono">
              Analyzing documents... This may take a few minutes.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-batch">
            {isComplete ? "Close" : "Cancel"}
          </Button>
          {!isComplete && (
            <Button
              onClick={handleAnalyze}
              disabled={selectedIds.size === 0 || !intent.trim() || isAnalyzing}
              data-testid="button-start-batch"
            >
              {isAnalyzing ? (
                <span className="flex items-center gap-2">
                  <div className="eva-hex-spinner" style={{ width: "1rem", height: "1rem" }} />
                  ANALYZING...
                </span>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Analyze {selectedIds.size} Documents
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
