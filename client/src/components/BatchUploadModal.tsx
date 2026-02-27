import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";
import { FileText, CheckCircle, XCircle, AlertCircle, Plus, Upload, X, Library } from "lucide-react";
import { useBatchAddDocuments } from "@/hooks/useProjects";
import { useUploadDocument } from "@/hooks/useDocument";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import type { Document, Folder, BatchAddDocumentsResponse, BatchAddDocumentResult } from "@shared/schema";

type DocumentLibraryItem = Pick<Document, "id" | "filename">;

interface BatchUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  availableDocuments: DocumentLibraryItem[];
  folders: Folder[];
  currentFolderId: string | null;
}

interface UploadedFile {
  id: string;
  filename: string;
  status: "pending" | "uploading" | "success" | "error";
  error?: string;
  documentId?: string;
}

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".heic",
  ".heif",
]);

function getFileExtension(filename: string): string {
  const extStart = filename.lastIndexOf(".");
  if (extStart < 0) return "";
  return filename.slice(extStart).toLowerCase();
}

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || getFileExtension(file.name) === ".pdf";
}

function isImageFile(file: File): boolean {
  const extension = getFileExtension(file.name);
  return file.type.startsWith("image/") || IMAGE_EXTENSIONS.has(extension);
}

function isSupportedUploadFile(file: File): boolean {
  const extension = getFileExtension(file.name);
  const isPdf = isPdfFile(file);
  const isTxt = file.type === "text/plain" || extension === ".txt";
  const isImage = isImageFile(file);
  return isPdf || isTxt || isImage;
}

export function BatchUploadModal({
  open,
  onOpenChange,
  projectId,
  availableDocuments,
  folders,
  currentFolderId,
}: BatchUploadModalProps) {
  const { toast } = useToast();
  const batchAdd = useBatchAddDocuments();
  const uploadMutation = useUploadDocument();
  
  const [activeTab, setActiveTab] = useState<"library" | "upload">("library");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null);
  const [response, setResponse] = useState<BatchAddDocumentsResponse | null>(null);
  
  const [filesToUpload, setFilesToUpload] = useState<File[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [batchOcrMode, setBatchOcrMode] = useState<string>("standard");
  const [batchOcrModel, setBatchOcrModel] = useState<string>("gpt-4o");

  const hasPdfFiles = filesToUpload.some((file) => isPdfFile(file));
  const hasImageFiles = filesToUpload.some((file) => isImageFile(file));
  const shouldShowOcrModelSelector =
    hasImageFiles || (hasPdfFiles && (batchOcrMode === "vision" || batchOcrMode === "vision_batch"));

  useEffect(() => {
    if (open) {
      setTargetFolderId(currentFolderId);
    }
  }, [open, currentFolderId]);

  useEffect(() => {
    if (!open) {
      setSelectedIds(new Set());
      setResponse(null);
      setTargetFolderId(null);
      setActiveTab("library");
      setFilesToUpload([]);
      setUploadedFiles([]);
      setIsUploading(false);
      setUploadProgress(0);
      setBatchOcrMode("standard");
      setBatchOcrModel("gpt-4o");
    }
  }, [open]);

  const handleSelectAll = () => {
    setSelectedIds(new Set(availableDocuments.map(d => d.id)));
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

  const handleAdd = async () => {
    if (selectedIds.size === 0) return;

    try {
      const result = await batchAdd.mutateAsync({
        projectId,
        documentIds: Array.from(selectedIds),
        folderId: targetFolderId,
      });
      
      setResponse(result);
      toast({
        title: "Documents Added",
        description: `Added ${result.added} documents to project`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to add documents",
        variant: "destructive",
      });
    }
  };

  const isValidFile = (file: File) => {
    return isSupportedUploadFile(file);
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files) {
      const validFiles = Array.from(e.dataTransfer.files).filter(isValidFile);
      setFilesToUpload(prev => [...prev, ...validFiles]);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const validFiles = Array.from(e.target.files).filter(isValidFile);
      setFilesToUpload(prev => [...prev, ...validFiles]);
    }
    e.target.value = "";
  };

  const removeFile = (index: number) => {
    setFilesToUpload(prev => prev.filter((_, i) => i !== index));
  };

  const handleUploadAndAdd = async () => {
    if (filesToUpload.length === 0) return;

    setIsUploading(true);
    const uploadResults: UploadedFile[] = filesToUpload.map((f, i) => ({
      id: `file-${i}`,
      filename: f.name,
      status: "pending" as const,
    }));
    setUploadedFiles(uploadResults);

    const uploadedDocIds: string[] = [];
    
    for (let i = 0; i < filesToUpload.length; i++) {
      const file = filesToUpload[i];
      setUploadedFiles(prev => prev.map((f, idx) => 
        idx === i ? { ...f, status: "uploading" } : f
      ));
      setUploadProgress(Math.round((i / filesToUpload.length) * 100));

      try {
        const doc = await uploadMutation.mutateAsync({
          file,
          ocrMode: batchOcrMode,
          ocrModel: batchOcrModel,
        });
        uploadedDocIds.push(doc.id);
        setUploadedFiles(prev => prev.map((f, idx) => 
          idx === i ? { ...f, status: "success", documentId: doc.id } : f
        ));
      } catch (error) {
        setUploadedFiles(prev => prev.map((f, idx) => 
          idx === i ? { 
            ...f, 
            status: "error", 
            error: error instanceof Error ? error.message : "Upload failed" 
          } : f
        ));
      }
    }

    setUploadProgress(100);
    setIsUploading(false);

    if (uploadedDocIds.length > 0) {
      try {
        const result = await batchAdd.mutateAsync({
          projectId,
          documentIds: uploadedDocIds,
          folderId: targetFolderId,
        });
        
        queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
        queryClient.invalidateQueries({ queryKey: ["/api/documents/meta"] });
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "documents"] });
        
        setResponse(result);
        setFilesToUpload([]);
        
        toast({
          title: "Upload Complete",
          description: `Uploaded ${uploadedDocIds.length} files and added ${result.added} to project`,
        });
      } catch (error) {
        toast({
          title: "Partial Success",
          description: `Files uploaded but failed to add to project. Try adding from Library tab.`,
          variant: "destructive",
        });
        setFilesToUpload([]);
      }
    } else {
      toast({
        title: "Upload Failed",
        description: "No files were successfully uploaded",
        variant: "destructive",
      });
    }
  };

  const getStatusIcon = (status: BatchAddDocumentResult["status"]) => {
    switch (status) {
      case "added":
        return <CheckCircle className="h-4 w-4 text-chart-2" />;
      case "already_exists":
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-destructive" />;
    }
  };

  const getStatusLabel = (status: BatchAddDocumentResult["status"]) => {
    switch (status) {
      case "added":
        return "Added";
      case "already_exists":
        return "Already in project";
      case "failed":
        return "Failed";
    }
  };

  const getUploadStatusIcon = (status: UploadedFile["status"]) => {
    switch (status) {
      case "success":
        return <CheckCircle className="h-4 w-4 text-chart-2" />;
      case "error":
        return <XCircle className="h-4 w-4 text-destructive" />;
      case "uploading":
        return <div className="eva-hex-spinner" style={{ width: "1rem", height: "1rem" }} />;
      default:
        return <FileText className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const isComplete = response !== null;
  const isAdding = batchAdd.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            <span className="eva-section-title text-sm">BATCH DOCUMENT INSERTION</span>
          </DialogTitle>
          <DialogDescription>
            Select from your library or upload new files
          </DialogDescription>
        </DialogHeader>

        {!isComplete ? (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "library" | "upload")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="library" className="uppercase tracking-wider" data-testid="tab-library">
                <Library className="h-4 w-4 mr-2" />
                From Library
              </TabsTrigger>
              <TabsTrigger value="upload" className="uppercase tracking-wider" data-testid="tab-upload">
                <Upload className="h-4 w-4 mr-2" />
                Upload New
              </TabsTrigger>
            </TabsList>

            <TabsContent value="library" className="space-y-4 mt-4">
              {availableDocuments.length === 0 ? (
                <Alert>
                  <AlertTitle>No Documents Available</AlertTitle>
                  <AlertDescription>
                    All documents have been added, or you haven't uploaded any yet. Use the "Upload New" tab to add files.
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Select Documents ({selectedIds.size}/{availableDocuments.length})</Label>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={handleSelectAll} data-testid="button-select-all-upload">
                          Select All
                        </Button>
                        <Button variant="ghost" size="sm" onClick={handleDeselectAll} data-testid="button-deselect-all-upload">
                          Deselect All
                        </Button>
                      </div>
                    </div>
                    <ScrollArea className="h-48 border rounded-md p-2">
                      <div className="space-y-2">
                        {availableDocuments.map((doc) => (
                          <label
                            key={doc.id}
                            className="flex items-center gap-3 p-2 hover-elevate rounded-md cursor-pointer font-mono text-sm"
                            data-testid={`row-doc-${doc.id}`}
                          >
                            <Checkbox
                              checked={selectedIds.has(doc.id)}
                              onCheckedChange={() => toggleDocument(doc.id)}
                              data-testid={`checkbox-upload-doc-${doc.id}`}
                            />
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm flex-1 truncate">{doc.filename}</span>
                          </label>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>

                  <div className="space-y-2">
                    <Label>Target Folder (optional)</Label>
                    <Select 
                      value={targetFolderId || "__root__"} 
                      onValueChange={(v) => setTargetFolderId(v === "__root__" ? null : v)}
                    >
                      <SelectTrigger data-testid="select-target-folder">
                        <SelectValue placeholder="Select folder" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__root__">Root (No folder)</SelectItem>
                        {folders.map((folder) => (
                          <SelectItem key={folder.id} value={folder.id}>
                            {folder.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="upload" className="space-y-4 mt-4">
              {isUploading ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label>Uploading {filesToUpload.length} files...</Label>
                    <span className="text-sm text-muted-foreground">{uploadProgress}%</span>
                  </div>
                  <Progress value={uploadProgress} />
                  <ScrollArea className="h-48 border rounded-md p-2">
                    <div className="space-y-2">
                          {uploadedFiles.map((file) => (
                            <div
                              key={file.id}
                              className="flex items-center gap-3 p-2 rounded-md font-mono text-sm"
                              data-testid={`upload-status-${file.id}`}
                            >
                          {getUploadStatusIcon(file.status)}
                          <span className="text-sm flex-1 truncate">{file.filename}</span>
                          {file.status === "success" && (
                            <Badge variant="secondary">Uploaded</Badge>
                          )}
                          {file.error && (
                            <span className="text-xs text-destructive">{file.error}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              ) : (
                <>
                  <Card
                    className={`p-6 border-2 border-dashed eva-clip-panel transition-colors ${
                      dragActive ? "border-primary bg-primary/5" : "border-primary/30 hover:border-primary/60"
                    }`}
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                  >
                    <label className="cursor-pointer">
                      <input
                        type="file"
                        className="hidden"
                        accept=".pdf,.txt,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,.heic,.heif,application/pdf,text/plain,image/*"
                        multiple
                        onChange={handleFileSelect}
                        data-testid="input-file-upload-batch"
                      />
                      <div className="flex flex-col items-center gap-3">
                        <div className="p-3 bg-muted rounded-full">
                          <Upload className="h-6 w-6 text-primary" />
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-medium">Drop files here or click to browse</p>
                          <p className="text-xs text-muted-foreground mt-1">PDF, TXT, and image files, max 50MB each</p>
                        </div>
                        <div className="flex gap-2">
                          <Badge variant="secondary">PDF</Badge>
                          <Badge variant="secondary">TXT</Badge>
                          <Badge variant="secondary">HEIC</Badge>
                          <Badge variant="secondary">Images</Badge>
                        </div>
                      </div>
                    </label>
                  </Card>

                  {filesToUpload.length > 0 && (
                    <div className="space-y-2">
                      <Label>Files to upload ({filesToUpload.length})</Label>
                      <ScrollArea className="h-32 border rounded-md p-2">
                        <div className="space-y-2">
                          {filesToUpload.map((file, index) => (
                            <div
                              key={`${file.name}-${index}`}
                              className="flex items-center gap-3 p-2 rounded-md bg-muted/50 font-mono text-sm"
                              data-testid={`file-pending-${index}`}
                            >
                              <FileText className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm flex-1 truncate">{file.name}</span>
                              <span className="text-xs text-muted-foreground">
                                {(file.size / 1024).toFixed(1)} KB
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => removeFile(index)}
                                data-testid={`button-remove-file-${index}`}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  )}

                  {hasPdfFiles && (
                    <div className="space-y-2">
                      <Label>Text Extraction Mode (for PDFs)</Label>
                      <Select value={batchOcrMode} onValueChange={setBatchOcrMode}>
                        <SelectTrigger data-testid="select-batch-ocr-mode">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="standard">Standard (digital PDFs, fast)</SelectItem>
                          <SelectItem value="advanced">Advanced OCR (scanned PDFs, PaddleOCR)</SelectItem>
                          <SelectItem value="vision">Vision OCR (scanned PDFs, GPT-4o)</SelectItem>
                          <SelectItem value="vision_batch">Vision OCR Batch (long scanned PDFs, faster)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {batchOcrMode === "standard" && "Best for PDFs with selectable text. Fastest option."}
                        {batchOcrMode === "advanced" && "Uses PaddleOCR at 200 DPI. Good for scanned documents."}
                        {batchOcrMode === "vision" && "Uses GPT-4o Vision per page. Best quality for complex layouts."}
                        {batchOcrMode === "vision_batch" && "Processes multiple pages per AI request. Recommended for long scanned PDFs."}
                      </p>
                    </div>
                  )}
                  {shouldShowOcrModelSelector && (
                    <div className="space-y-2">
                      <Label>AI OCR Model</Label>
                      <Select value={batchOcrModel} onValueChange={setBatchOcrModel}>
                        <SelectTrigger data-testid="select-batch-ocr-model">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="gpt-4o">GPT-4o (best OCR quality)</SelectItem>
                          <SelectItem value="gpt-4o-mini">GPT-4o mini (faster, lower cost)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Used for HEIC/image uploads and Vision OCR PDF modes.
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Target Folder (optional)</Label>
                    <Select 
                      value={targetFolderId || "__root__"} 
                      onValueChange={(v) => setTargetFolderId(v === "__root__" ? null : v)}
                    >
                      <SelectTrigger data-testid="select-upload-folder">
                        <SelectValue placeholder="Select folder" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__root__">Root (No folder)</SelectItem>
                        {folders.map((folder) => (
                          <SelectItem key={folder.id} value={folder.id}>
                            {folder.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        ) : (
          <div className="space-y-4">
            <Alert variant={response.failed > 0 ? "destructive" : "default"}>
              <AlertTitle>
                {response.failed === 0 ? "All Documents Added" : "Some Documents Failed"}
              </AlertTitle>
              <AlertDescription>
                Added {response.added} documents
                {response.alreadyExists > 0 && `, ${response.alreadyExists} already existed`}
                {response.failed > 0 && `, ${response.failed} failed`}
              </AlertDescription>
            </Alert>

            <ScrollArea className="h-48 border rounded-md p-2">
              <div className="space-y-2">
                {response.results.map((result) => (
                  <div
                    key={result.documentId}
                    className="flex items-center gap-3 p-2 rounded-md"
                    data-testid={`result-upload-${result.documentId}`}
                  >
                    {getStatusIcon(result.status)}
                    <span className="text-sm flex-1 truncate">{result.filename}</span>
                    <Badge variant="secondary">{getStatusLabel(result.status)}</Badge>
                    {result.error && (
                      <span className="text-xs text-destructive truncate max-w-[150px]">{result.error}</span>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-upload">
            {isComplete ? "Close" : "Cancel"}
          </Button>
          {!isComplete && activeTab === "library" && availableDocuments.length > 0 && (
            <Button
              onClick={handleAdd}
              disabled={selectedIds.size === 0 || isAdding}
              data-testid="button-add-from-library"
            >
              {isAdding ? (
                <span className="flex items-center gap-2">
                  <div className="eva-hex-spinner" style={{ width: "1rem", height: "1rem" }} />
                  ADDING...
                </span>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Add {selectedIds.size} Documents
                </>
              )}
            </Button>
          )}
          {!isComplete && activeTab === "upload" && !isUploading && (
            <Button
              onClick={handleUploadAndAdd}
              disabled={filesToUpload.length === 0}
              data-testid="button-upload-and-add"
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload & Add {filesToUpload.length} Files
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
