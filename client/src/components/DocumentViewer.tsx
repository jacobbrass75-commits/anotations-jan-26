import { useRef, useEffect, useState } from "react";
import { FileText, AlertCircle, ExternalLink, FileImage } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { HighlightedText } from "./HighlightedText";
import type { Annotation, Document } from "@shared/schema";
import type { DocumentSourceMeta } from "@/hooks/useDocument";

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
  sourceMeta?: DocumentSourceMeta | null;
  selectedAnnotationId: string | null;
  onAnnotationClick: (annotation: AnnotationWithPrompt) => void;
  onTextSelect?: (selection: { text: string; start: number; end: number }) => void;
}

export function DocumentViewer({
  document,
  annotations,
  isLoading,
  sourceMeta,
  selectedAnnotationId,
  onAnnotationClick,
  onTextSelect,
}: DocumentViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<"transcript" | "source">("transcript");
  const sourceAvailable = !!sourceMeta?.available && !!sourceMeta?.sourceUrl;
  const sourceIsImage = (sourceMeta?.mimeType || "").startsWith("image/");
  const sourceIsZip =
    sourceMeta?.mimeType === "application/zip" ||
    (sourceMeta?.filename || "").toLowerCase().endsWith(".zip");

  // Scroll to selected annotation
  useEffect(() => {
    if (selectedAnnotationId && scrollRef.current) {
      const element = scrollRef.current.querySelector(
        `[data-testid="highlight-${selectedAnnotationId}"]`
      );
      if (element) {
        requestAnimationFrame(() => {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    }
  }, [selectedAnnotationId, annotations.length, document?.id]);

  useEffect(() => {
    setViewMode("transcript");
  }, [document?.id]);

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
            Upload a PDF, TXT, or image file to start annotating and analyzing your research materials.
          </p>
        </div>
      </Card>
    );
  }

  if (document.status === "processing") {
    return (
      <Card className="h-full flex flex-col items-center justify-center">
        <div className="text-center p-8 max-w-sm">
          <div className="mx-auto mb-4 eva-hex-spinner" />
          <div className="mb-2 flex items-center justify-center gap-2">
            <div className="eva-status-warning" />
            <h3 className="eva-section-title text-primary">PROCESSING DOCUMENT...</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Extracting text from your source file. This may take a moment...
          </p>
        </div>
      </Card>
    );
  }

  if (document.status === "error") {
    return (
      <Card className="h-full flex flex-col items-center justify-center eva-warning-stripes">
        <div className="text-center p-8 max-w-sm">
          <AlertCircle className="mx-auto h-12 w-12 text-destructive mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">Processing Failed</h3>
          <p className="text-sm text-muted-foreground">
            {document.processingError || "Could not extract text from this file."}
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col overflow-hidden eva-corner-decor">
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4 border-b shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-5 w-5 text-primary shrink-0" />
          <h2 className="eva-section-title text-sm font-semibold truncate">{document.filename}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground mr-2">
            {document.fullText.length.toLocaleString()} characters
          </span>
          <Button
            variant={viewMode === "transcript" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setViewMode("transcript")}
            className="uppercase text-xs tracking-widest"
            data-testid="button-view-transcript"
          >
            Transcript
          </Button>
          <Button
            variant={viewMode === "source" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setViewMode("source")}
            disabled={!sourceAvailable}
            className="uppercase text-xs tracking-widest"
            data-testid="button-view-source"
          >
            Original
          </Button>
          {sourceAvailable && sourceMeta?.sourceUrl && (
            <Button variant="ghost" size="icon" asChild data-testid="button-open-source-new-tab">
              <a href={sourceMeta.sourceUrl} target="_blank" rel="noreferrer" title="Open original source">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 p-0 overflow-hidden">
        {viewMode === "transcript" ? (
          <ScrollArea className="h-full eva-grid-bg">
            <div
              ref={scrollRef}
              className="p-6 max-w-4xl mx-auto border-l-2 border-border eva-materialize"
            >
              <HighlightedText
                text={document.fullText}
                annotations={annotations}
                onAnnotationClick={onAnnotationClick}
                selectedAnnotationId={selectedAnnotationId}
                onTextSelect={onTextSelect}
              />
            </div>
          </ScrollArea>
        ) : sourceAvailable && sourceMeta?.sourceUrl ? (
          sourceIsImage ? (
            <ScrollArea className="h-full">
              <div className="p-4">
                <img
                  src={sourceMeta.sourceUrl}
                  alt={`Original source: ${document.filename}`}
                  className="max-w-full h-auto mx-auto rounded-md border"
                />
              </div>
            </ScrollArea>
          ) : sourceIsZip ? (
            <div className="h-full flex items-center justify-center p-8 text-center">
              <div className="max-w-sm space-y-3">
                <h3 className="text-sm font-semibold">Original Source Is a ZIP Archive</h3>
                <p className="text-sm text-muted-foreground">
                  Combined image sources are stored as ZIP to reduce server storage. Download and open locally when needed.
                </p>
                <Button asChild>
                  <a href={sourceMeta.sourceUrl} download={sourceMeta.filename}>
                    Download ZIP
                  </a>
                </Button>
              </div>
            </div>
          ) : (
            <iframe
              src={sourceMeta.sourceUrl}
              className="h-full w-full border-0"
              title={`Original source for ${document.filename}`}
            />
          )
        ) : (
          <div className="h-full flex items-center justify-center p-8 text-center">
            <div className="max-w-sm">
              <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <FileImage className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-sm font-semibold mb-1">Original Source Unavailable</h3>
              <p className="text-sm text-muted-foreground">
                This document does not have a saved source file yet. The transcript view is still available.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
