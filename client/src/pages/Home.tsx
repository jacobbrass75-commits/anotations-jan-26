import { useState, useCallback, useEffect, useRef } from "react";
import { Link } from "wouter";
import { BookOpen, Upload, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/ThemeToggle";
import { FileUpload } from "@/components/FileUpload";
import { IntentPanel } from "@/components/IntentPanel";
import { DocumentViewer } from "@/components/DocumentViewer";
import { AnnotationSidebar } from "@/components/AnnotationSidebar";
import { SearchPanel } from "@/components/SearchPanel";
import { DocumentSummary } from "@/components/DocumentSummary";
import { ManualAnnotationDialog } from "@/components/ManualAnnotationDialog";
import {
  useDocument,
  useDocumentStatus,
  useDocumentSourceMeta,
  useAnnotations,
  useUploadDocument,
  useSetIntent,
  useAddAnnotation,
  useUpdateAnnotation,
  useDeleteAnnotation,
  useSearchDocument,
} from "@/hooks/useDocument";
import { useQueryClient } from "@tanstack/react-query";
import type { Annotation, AnnotationCategory, SearchResult } from "@shared/schema";

export default function Home() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentDocumentId, setCurrentDocumentId] = useState<string | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [showUpload, setShowUpload] = useState(true);
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<{
    text: string;
    start: number;
    end: number;
  } | null>(null);

  const { data: document, isLoading: isDocumentLoading } = useDocument(currentDocumentId);
  const { data: documentStatus } = useDocumentStatus(currentDocumentId);
  const { data: sourceMeta } = useDocumentSourceMeta(currentDocumentId);
  const { data: annotations = [], isLoading: isAnnotationsLoading } = useAnnotations(currentDocumentId);

  const uploadMutation = useUploadDocument();
  const intentMutation = useSetIntent();
  const addAnnotationMutation = useAddAnnotation();
  const updateAnnotationMutation = useUpdateAnnotation();
  const deleteAnnotationMutation = useDeleteAnnotation();
  const searchMutation = useSearchDocument();

  // Track previous status to detect transitions
  const prevStatusRef = useRef<string | undefined>();
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    const currentStatus = documentStatus?.status;
    prevStatusRef.current = currentStatus;

    if (prevStatus === "processing" && currentStatus === "ready") {
      queryClient.invalidateQueries({ queryKey: ["/api/documents", currentDocumentId] });
      toast({
        title: "Processing complete",
        description: `${documentStatus?.filename} is ready for analysis.`,
      });
    }
    if (prevStatus === "processing" && currentStatus === "error") {
      queryClient.invalidateQueries({ queryKey: ["/api/documents", currentDocumentId] });
      toast({
        title: "Processing failed",
        description: documentStatus?.processingError || "Could not process the PDF.",
        variant: "destructive",
      });
    }
  }, [documentStatus?.status, currentDocumentId, queryClient, toast, documentStatus?.filename, documentStatus?.processingError]);

  const handleUpload = useCallback(async (file: File, ocrMode: string, ocrModel?: string) => {
    setUploadProgress(10);
    try {
      const interval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 10, 90));
      }, 300);

      const result = await uploadMutation.mutateAsync({ file, ocrMode, ocrModel });
      clearInterval(interval);
      setUploadProgress(100);

      setCurrentDocumentId(result.id);
      setShowUpload(false);
      setHasAnalyzed(false);

      if (result.status === "processing") {
        toast({
          title: "Document uploaded",
          description: `Processing ${result.filename}. This may take a moment...`,
        });
      } else {
        toast({
          title: "Document uploaded",
          description: `${result.filename} is ready for analysis.`,
        });
      }
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Could not upload the document.",
        variant: "destructive",
      });
    } finally {
      setUploadProgress(0);
    }
  }, [uploadMutation, toast]);

  const handleAnalyze = useCallback(async (
    research: string,
    goals: string,
    thoroughness: 'quick' | 'standard' | 'thorough' | 'exhaustive' = 'standard'
  ) => {
    if (!currentDocumentId) return;

    const intent = `Research topic: ${research}\n\nGoals: ${goals}`;

    try {
      await intentMutation.mutateAsync({ documentId: currentDocumentId, intent, thoroughness });
      setHasAnalyzed(true);

      toast({
        title: "Analysis complete",
        description: "AI has highlighted relevant passages in your document.",
      });
    } catch (error) {
      toast({
        title: "Analysis failed",
        description: error instanceof Error ? error.message : "Could not analyze the document.",
        variant: "destructive",
      });
    }
  }, [currentDocumentId, intentMutation, toast]);

  const handleAnnotationClick = useCallback((annotation: { id: string }) => {
    setSelectedAnnotationId(annotation.id);
  }, []);

  const handleTextSelect = useCallback((selection: { text: string; start: number; end: number }) => {
    setPendingSelection(selection);
    setManualDialogOpen(true);
  }, []);

  const handleAddManualAnnotation = useCallback(() => {
    setPendingSelection(null);
    setManualDialogOpen(true);
  }, []);

  const handleSaveManualAnnotation = useCallback(async (note: string, category: AnnotationCategory) => {
    if (!currentDocumentId || !pendingSelection) return;

    try {
      await addAnnotationMutation.mutateAsync({
        documentId: currentDocumentId,
        startPosition: pendingSelection.start,
        endPosition: pendingSelection.end,
        highlightedText: pendingSelection.text,
        category,
        note,
        isAiGenerated: false,
      });

      toast({
        title: "Annotation added",
        description: "Your note has been saved.",
      });

      setPendingSelection(null);
    } catch (error) {
      toast({
        title: "Failed to add annotation",
        description: error instanceof Error ? error.message : "Could not save the annotation.",
        variant: "destructive",
      });
    }
  }, [currentDocumentId, pendingSelection, addAnnotationMutation, toast]);

  const handleUpdateAnnotation = useCallback(async (annotationId: string, note: string, category: AnnotationCategory) => {
    if (!currentDocumentId) return;

    try {
      await updateAnnotationMutation.mutateAsync({
        annotationId,
        documentId: currentDocumentId,
        note,
        category,
      });

      toast({
        title: "Annotation updated",
        description: "Your changes have been saved.",
      });
    } catch (error) {
      toast({
        title: "Update failed",
        description: error instanceof Error ? error.message : "Could not update the annotation.",
        variant: "destructive",
      });
    }
  }, [currentDocumentId, updateAnnotationMutation, toast]);

  const handleDeleteAnnotation = useCallback(async (annotationId: string) => {
    if (!currentDocumentId) return;

    try {
      await deleteAnnotationMutation.mutateAsync({
        annotationId,
        documentId: currentDocumentId,
      });

      if (selectedAnnotationId === annotationId) {
        setSelectedAnnotationId(null);
      }

      toast({
        title: "Annotation deleted",
        description: "The annotation has been removed.",
      });
    } catch (error) {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Could not delete the annotation.",
        variant: "destructive",
      });
    }
  }, [currentDocumentId, selectedAnnotationId, deleteAnnotationMutation, toast]);

  const handleSearch = useCallback(async (query: string): Promise<SearchResult[]> => {
    if (!currentDocumentId) return [];

    try {
      const results = await searchMutation.mutateAsync({
        documentId: currentDocumentId,
        query,
      });
      return results;
    } catch (error) {
      toast({
        title: "Search failed",
        description: error instanceof Error ? error.message : "Could not search the document.",
        variant: "destructive",
      });
      return [];
    }
  }, [currentDocumentId, searchMutation, toast]);

  const handleJumpToPosition = useCallback((start: number, end: number) => {
    // Find annotation at this position, or create a temporary highlight
    const matchingAnnotation = annotations.find(
      (a) => a.startPosition === start && a.endPosition === end
    );
    if (matchingAnnotation) {
      setSelectedAnnotationId(matchingAnnotation.id);
    }
  }, [annotations]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-40">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-semibold">ScholarMark</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/projects">
              <Button variant="outline" size="sm" data-testid="button-projects">
                <FolderOpen className="h-4 w-4 mr-2" />
                Projects
              </Button>
            </Link>
            {!showUpload && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowUpload(true)}
                data-testid="button-upload-new"
              >
                <Upload className="h-4 w-4 mr-2" />
                Upload New
              </Button>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-6">
        {showUpload ? (
          <div className="max-w-xl mx-auto space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-semibold mb-2">Upload Your Document</h2>
              <p className="text-muted-foreground">
                Upload an academic PDF or text file to start annotating and analyzing.
              </p>
            </div>
            <FileUpload
              onUpload={handleUpload}
              isUploading={uploadMutation.isPending}
              uploadProgress={uploadProgress}
            />
          </div>
        ) : (
          <div className="grid lg:grid-cols-4 gap-6 h-[calc(100vh-8rem)]">
            {/* Left Sidebar: Intent + Summary */}
            <div className="lg:col-span-1 flex flex-col gap-4 overflow-hidden">
              <div className="flex-1 min-h-0">
                <IntentPanel
                  documentId={currentDocumentId}
                  onAnalyze={handleAnalyze}
                  isAnalyzing={intentMutation.isPending}
                  hasAnalyzed={hasAnalyzed}
                  annotationCount={annotations.length}
                />
              </div>
              {document?.summary && (
                <DocumentSummary document={document} isLoading={isDocumentLoading} />
              )}
            </div>

            {/* Center: Document Viewer + Search */}
            <div className="lg:col-span-2 flex flex-col gap-4 overflow-hidden">
              <div className="flex-1 min-h-0">
                <DocumentViewer
                  document={document ?? null}
                  annotations={annotations}
                  isLoading={isDocumentLoading}
                  sourceMeta={sourceMeta}
                  selectedAnnotationId={selectedAnnotationId}
                  onAnnotationClick={handleAnnotationClick}
                  onTextSelect={handleTextSelect}
                />
              </div>
              <SearchPanel
                documentId={currentDocumentId}
                onSearch={handleSearch}
                onJumpToPosition={handleJumpToPosition}
              />
            </div>

            {/* Right Sidebar: Annotations */}
            <div className="lg:col-span-1 overflow-hidden">
              <AnnotationSidebar
                annotations={annotations}
                isLoading={isAnnotationsLoading}
                selectedAnnotationId={selectedAnnotationId}
                onSelect={handleAnnotationClick}
                onDelete={handleDeleteAnnotation}
                onUpdate={handleUpdateAnnotation}
                onAddManual={handleAddManualAnnotation}
                canAddManual={!!currentDocumentId}
              />
            </div>
          </div>
        )}
      </main>

      {/* Manual Annotation Dialog */}
      <ManualAnnotationDialog
        open={manualDialogOpen}
        onOpenChange={setManualDialogOpen}
        selectedText={pendingSelection}
        onSave={handleSaveManualAnnotation}
      />
    </div>
  );
}
