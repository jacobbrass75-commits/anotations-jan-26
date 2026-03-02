import { FileText, Copy, Check } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface DocumentCardProps {
  title: string;
  content: string;
}

export function DocumentCard({ title, content }: DocumentCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const preview = content.slice(0, 300);

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden my-2">
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/50 border-b">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{title}</span>
          <span className="text-xs text-muted-foreground">
            {wordCount} words
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-600" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
      <div className="px-4 py-3 max-h-48 overflow-y-auto">
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
          {preview}
          {content.length > 300 && "..."}
        </p>
      </div>
    </div>
  );
}
