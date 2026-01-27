import { useRef, useEffect } from "react";
import { FileText, Loader2, AlertCircle } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { HighlightedText } from "./HighlightedText";
import type { Annotation, Document } from "@shared/schema";

// Extended annotation type with prompt fields
interface AnnotationWithPrompt extends Omit<Annotation, 'promptText' | 'promptIndex' | 'promptColor'> {
  promptText?: string | null;
  promptIndex?: number | null;
  promptColor?: string | null;
}

interface DocumentViewerProps {
  document: Document | null;
  annotations: AnnotationWithPrompt[];
  isLoading: boolean;
  selectedAnnotationId: string | null;
  onAnnotationClick: (annotation: AnnotationWithPrompt) => void;
  onTextSelect?: (selection: { text: string; start: number; end: number }) => void;
}

export function DocumentViewer({
  document,
  annotations,
  isLoading,
  selectedAnnotationId,
  onAnnotationClick,
  onTextSelect,
}: DocumentViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to selected annotation
  useEffect(() => {
    if (selectedAnnotationId && scrollRef.current) {
      const element = scrollRef.current.querySelector(
        `[data-testid="highlight-${selectedAnnotationId}"]`
      );
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [selectedAnnotationId]);

  if (isLoading) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="flex flex-row items-center gap-2 pb-4 border-b">
          <FileText className="h-5 w-5 text-primary" />
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="flex-1 p-6">
          <div className="space-y-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!document) {
    return (
      <Card className="h-full flex flex-col items-center justify-center">
        <div className="text-center p-8 max-w-sm">
          <div className="mx-auto w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <FileText className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">No Document Loaded</h3>
          <p className="text-sm text-muted-foreground">
            Upload a PDF or TXT file to start annotating and analyzing your research materials.
          </p>
        </div>
      </Card>
    );
  }

  if (document.status === "processing") {
    return (
      <Card className="h-full flex flex-col items-center justify-center">
        <div className="text-center p-8 max-w-sm">
          <Loader2 className="mx-auto h-12 w-12 text-primary animate-spin mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">Processing Document</h3>
          <p className="text-sm text-muted-foreground">
            Extracting text from your scanned PDF. This may take a moment...
          </p>
        </div>
      </Card>
    );
  }

  if (document.status === "error") {
    return (
      <Card className="h-full flex flex-col items-center justify-center">
        <div className="text-center p-8 max-w-sm">
          <AlertCircle className="mx-auto h-12 w-12 text-destructive mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">Processing Failed</h3>
          <p className="text-sm text-muted-foreground">
            {document.processingError || "Could not extract text from this PDF."}
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4 border-b shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-5 w-5 text-primary shrink-0" />
          <h2 className="text-lg font-semibold truncate">{document.filename}</h2>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground mr-2">
            {document.fullText.length.toLocaleString()} characters
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex-1 p-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div ref={scrollRef} className="p-6 max-w-4xl mx-auto">
            <HighlightedText
              text={document.fullText}
              annotations={annotations}
              onAnnotationClick={onAnnotationClick}
              selectedAnnotationId={selectedAnnotationId}
              onTextSelect={onTextSelect}
            />
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
