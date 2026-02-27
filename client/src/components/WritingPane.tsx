import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { useWritingPipeline, type WritingRequest } from "@/hooks/useWriting";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  PenTool,
  Copy,
  RotateCcw,
  StopCircle,
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

interface WritingPaneProps {
  projectId?: string;
  availableAnnotations?: Array<{
    id: string;
    highlightedText: string;
    note: string | null;
    category: string;
    documentFilename?: string;
  }>;
}

export default function WritingPane({
  projectId,
  availableAnnotations = [],
}: WritingPaneProps) {
  const { toast } = useToast();
  const outputRef = useRef<HTMLDivElement>(null);

  // Form state
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState<"academic" | "casual" | "ap_style">("academic");
  const [targetLength, setTargetLength] = useState<"short" | "medium" | "long">("medium");
  const [citationStyle] = useState<"mla" | "apa" | "chicago">("chicago");
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<string[]>([]);
  const [noEnDashes, setNoEnDashes] = useState(false);
  const [deepWrite, setDeepWrite] = useState(false);

  // Pipeline hook
  const {
    generate,
    cancel,
    reset,
    status,
    phase,
    plan,
    sections,
    fullText,
    isGenerating,
    error,
  } = useWritingPipeline();

  // Auto-scroll output area when new content arrives
  useEffect(() => {
    if (outputRef.current && (sections.length > 0 || fullText)) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [sections, fullText]);

  const handleGenerate = () => {
    if (!topic.trim()) {
      toast({
        title: "Error",
        description: "Please enter a topic or prompt",
        variant: "destructive",
      });
      return;
    }

    const request: WritingRequest = {
      topic: topic.trim(),
      annotationIds: selectedAnnotationIds,
      projectId,
      citationStyle,
      tone,
      targetLength,
      noEnDashes,
      deepWrite,
    };

    generate(request);
  };

  const handleCopy = async () => {
    const textToCopy = fullText || sections.map((s) => s.content).join("\n\n");
    if (!textToCopy) {
      toast({ title: "Nothing to copy", variant: "destructive" });
      return;
    }
    try {
      await navigator.clipboard.writeText(textToCopy);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  const handleReset = () => {
    reset();
    setTopic("");
    setSelectedAnnotationIds([]);
  };

  const toggleAnnotation = (id: string) => {
    setSelectedAnnotationIds((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  };

  const selectAllAnnotations = () => {
    if (selectedAnnotationIds.length === availableAnnotations.length) {
      setSelectedAnnotationIds([]);
    } else {
      setSelectedAnnotationIds(availableAnnotations.map((a) => a.id));
    }
  };

  // Compute progress percentage
  const progressPercent = plan
    ? phase === "complete"
      ? 100
      : phase === "stitching"
        ? 90
        : Math.round(((sections.length) / plan.sections.length) * 80) + 10
    : phase === "planning"
      ? 5
      : 0;

  // Get display text for the output area
  const displayContent = fullText || sections.map((s) => s.content).join("\n\n");

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <Card className="border-b rounded-b-none">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <PenTool className="h-5 w-5" />
            Writing Controls
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Topic */}
          <div className="space-y-2">
            <Label htmlFor="writing-topic">Topic / Prompt</Label>
            <Textarea
              id="writing-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Enter your paper topic, thesis, or a detailed prompt for what you want written..."
              className="resize-none min-h-[80px]"
              disabled={isGenerating}
            />
          </div>

          {/* Controls row */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Tone</Label>
              <Select
                value={tone}
                onValueChange={(v) => setTone(v as typeof tone)}
                disabled={isGenerating}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="academic">Academic</SelectItem>
                  <SelectItem value="casual">Casual</SelectItem>
                  <SelectItem value="ap_style">AP Style</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Length</Label>
              <Select
                value={targetLength}
                onValueChange={(v) => setTargetLength(v as typeof targetLength)}
                disabled={isGenerating}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="short">Short (~3 pages)</SelectItem>
                  <SelectItem value="medium">Medium (~5 pages)</SelectItem>
                  <SelectItem value="long">Long (~8 pages)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Citation Style</Label>
              <Select value={citationStyle} disabled>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chicago">Chicago</SelectItem>
                  <SelectItem value="mla">MLA (coming soon)</SelectItem>
                  <SelectItem value="apa">APA (coming soon)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Source annotations selector */}
          {availableAnnotations.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Sources ({selectedAnnotationIds.length} selected)</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={selectAllAnnotations}
                  disabled={isGenerating}
                  className="text-xs h-7"
                >
                  {selectedAnnotationIds.length === availableAnnotations.length
                    ? "Deselect all"
                    : "Select all"}
                </Button>
              </div>
              <ScrollArea className="max-h-[120px] border rounded-md p-2">
                <div className="space-y-1.5">
                  {availableAnnotations.map((ann) => (
                    <label
                      key={ann.id}
                      className="flex items-start gap-2 cursor-pointer hover:bg-muted/50 rounded p-1 text-sm"
                    >
                      <Checkbox
                        checked={selectedAnnotationIds.includes(ann.id)}
                        onCheckedChange={() => toggleAnnotation(ann.id)}
                        disabled={isGenerating}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="line-clamp-1 text-foreground">
                          {ann.highlightedText.slice(0, 80)}
                          {ann.highlightedText.length > 80 ? "..." : ""}
                        </span>
                        {ann.documentFilename && (
                          <span className="text-xs text-muted-foreground block">
                            {ann.documentFilename}
                          </span>
                        )}
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {ann.category}
                      </Badge>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Toggles */}
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox
                checked={noEnDashes}
                onCheckedChange={(checked) => setNoEnDashes(!!checked)}
                disabled={isGenerating}
              />
              No en-dashes
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox
                checked={deepWrite}
                onCheckedChange={(checked) => setDeepWrite(!!checked)}
                disabled={isGenerating}
              />
              Deep Write (Sonnet)
            </label>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {!isGenerating ? (
              <Button onClick={handleGenerate} disabled={!topic.trim()}>
                <FileText className="h-4 w-4 mr-2" />
                Generate Paper
              </Button>
            ) : (
              <Button variant="destructive" onClick={cancel}>
                <StopCircle className="h-4 w-4 mr-2" />
                Stop
              </Button>
            )}
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={isGenerating}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset
            </Button>
            {displayContent && (
              <Button variant="outline" onClick={handleCopy}>
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Output area */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Status bar */}
        {(isGenerating || phase) && (
          <div className="px-4 py-2 border-b bg-muted/30">
            <div className="flex items-center gap-2 text-sm">
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : error ? (
                <AlertCircle className="h-4 w-4 text-destructive" />
              ) : phase === "complete" ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : null}
              <span className="text-muted-foreground">{status}</span>
            </div>
            {isGenerating && (
              <Progress value={progressPercent} className="mt-1.5 h-1.5" />
            )}
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="px-4 py-3 border-b bg-destructive/10 text-destructive text-sm">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Plan display */}
        {plan && !fullText && (
          <div className="px-4 py-2 border-b bg-muted/20">
            <p className="text-sm font-medium mb-1">
              Outline: {plan.thesis}
            </p>
            <div className="flex flex-wrap gap-1">
              {plan.sections.map((s, i) => (
                <Badge
                  key={i}
                  variant={
                    i < sections.length
                      ? "default"
                      : i === sections.length && isGenerating
                        ? "secondary"
                        : "outline"
                  }
                  className="text-xs"
                >
                  {i + 1}. {s.title}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Markdown output */}
        <div className="flex-1 min-h-0 overflow-auto" ref={outputRef}>
          {displayContent ? (
            <div className="p-6 prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown>{displayContent}</ReactMarkdown>
              {isGenerating && (
                <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-0.5" />
              )}
            </div>
          ) : !isGenerating && !error ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center space-y-2">
                <PenTool className="h-12 w-12 mx-auto opacity-20" />
                <p className="text-sm">
                  Enter a topic and click Generate to start writing
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
