import { useState, useCallback } from "react";
import { Upload, FileText, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface FileUploadProps {
  onUpload: (file: File, ocrMode: string, ocrModel?: string) => Promise<void>;
  isUploading: boolean;
  uploadProgress: number;
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

function isSupportedUploadFile(file: File): boolean {
  const extension = getFileExtension(file.name);
  const isPdf = file.type === "application/pdf" || extension === ".pdf";
  const isTxt = file.type === "text/plain" || extension === ".txt";
  const isImage = isImageFile(file);
  return isPdf || isTxt || isImage;
}

function isImageFile(file: File): boolean {
  const extension = getFileExtension(file.name);
  return file.type.startsWith("image/") || IMAGE_EXTENSIONS.has(extension);
}

export function FileUpload({ onUpload, isUploading, uploadProgress }: FileUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [ocrMode, setOcrMode] = useState<string>("standard");
  const [ocrModel, setOcrModel] = useState<string>("gpt-4o");

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

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (isValidFile(file)) {
        setSelectedFile(file);
      }
    }
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (isValidFile(file)) {
        setSelectedFile(file);
      }
    }
  }, []);

  const isValidFile = (file: File) => {
    return isSupportedUploadFile(file);
  };

  const handleUpload = async () => {
    if (selectedFile) {
      await onUpload(selectedFile, ocrMode, ocrModel);
      setSelectedFile(null);
      setOcrMode("standard");
      setOcrModel("gpt-4o");
    }
  };

  const clearSelection = () => {
    setSelectedFile(null);
  };

  if (isUploading) {
    return (
      <Card className="p-8">
        <div className="flex flex-col items-center gap-4">
          <div className="eva-hex-spinner" />
          <div className="text-center">
            <p className="text-sm font-medium text-foreground eva-section-title">DOCUMENT INSERTION</p>
            <p className="text-xs text-muted-foreground mt-1">Extracting text and preparing for analysis</p>
          </div>
          <div className="w-full max-w-xs">
            <Progress value={uploadProgress} className="h-2" />
            <p className="text-xs text-muted-foreground text-center mt-2 font-mono">{uploadProgress}% complete</p>
          </div>
        </div>
      </Card>
    );
  }

  const isPdf = selectedFile
    ? selectedFile.type === "application/pdf" || getFileExtension(selectedFile.name) === ".pdf"
    : false;
  const isImage = selectedFile ? isImageFile(selectedFile) : false;
  const shouldShowOcrModel =
    isImage || (isPdf && (ocrMode === "vision" || ocrMode === "vision_batch"));

  if (selectedFile) {
    return (
      <Card className="p-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-primary/10 rounded-lg">
              <FileText className="h-8 w-8 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{selectedFile.name}</p>
              <p className="text-xs text-muted-foreground">
                {(selectedFile.size / 1024).toFixed(1)} KB
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={clearSelection}
              data-testid="button-clear-file"
              aria-label="Remove file"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {isPdf && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">
                Text Extraction Mode
              </label>
              <Select value={ocrMode} onValueChange={setOcrMode}>
                <SelectTrigger className="w-full eva-focus-glow" data-testid="select-ocr-mode">
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
                {ocrMode === "standard" && "Best for PDFs with selectable text. Fastest option."}
                {ocrMode === "advanced" && "Uses PaddleOCR at 200 DPI. Good for scanned documents."}
                {ocrMode === "vision" && "Uses GPT-4o Vision per page. Best quality for complex layouts."}
                {ocrMode === "vision_batch" && "Processes multiple pages per AI request. Recommended for long scanned PDFs."}
              </p>
            </div>
          )}
          {shouldShowOcrModel && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">
                AI OCR Model
              </label>
              <Select value={ocrModel} onValueChange={setOcrModel}>
                <SelectTrigger className="w-full eva-focus-glow" data-testid="select-ocr-model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-4o">GPT-4o (best OCR quality)</SelectItem>
                  <SelectItem value="gpt-4o-mini">GPT-4o mini (faster, lower cost)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Used for image/HEIC transcription and Vision OCR PDF modes.
              </p>
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={handleUpload} data-testid="button-upload-file">
              Upload
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card
      className={`p-8 border-2 border-dashed eva-clip-panel transition-colors duration-200 ${
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
          onChange={handleChange}
          data-testid="input-file-upload"
        />
        <div className="flex flex-col items-center gap-4">
          <div className="p-4 bg-muted rounded-full">
            <Upload className="h-8 w-8 text-primary" />
          </div>
          <div className="text-center">
            <p className="eva-section-title text-sm font-medium text-foreground">DOCUMENT INSERTION</p>
            <p className="text-xs text-muted-foreground mt-1">
              Drag and drop or select file for analysis
            </p>
          </div>
          <div className="flex gap-2 font-mono text-xs text-muted-foreground">
            <Badge variant="secondary">PDF</Badge>
            <Badge variant="secondary">TXT</Badge>
            <Badge variant="secondary">HEIC</Badge>
            <Badge variant="secondary">Images</Badge>
          </div>
        </div>
      </label>
    </Card>
  );
}
