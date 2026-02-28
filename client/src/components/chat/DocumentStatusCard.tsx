import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Loader2 } from "lucide-react";

interface DocumentStatusCardProps {
  title: string;
  content: string;
  isStreaming?: boolean;
  onView?: () => void;
  className?: string;
}

function getWordCount(value: string): number {
  return value.trim().length === 0 ? 0 : value.trim().split(/\s+/).length;
}

export function DocumentStatusCard({
  title,
  content,
  isStreaming = false,
  onView,
  className,
}: DocumentStatusCardProps) {
  const words = getWordCount(content);

  return (
    <div className={`rounded-xl border bg-card px-3 py-2 text-sm ${className || ""}`.trim()}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2">
          {isStreaming ? (
            <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
          ) : (
            <FileText className="h-4 w-4 text-primary shrink-0" />
          )}
          <span className="font-medium truncate">{isStreaming ? `Writing: ${title}` : title}</span>
        </div>
        <Badge variant="outline" className="font-mono text-[10px] uppercase shrink-0">
          {words} words
        </Badge>
      </div>
      {onView && (
        <div className="mt-2">
          <Button variant="ghost" size="sm" className="h-auto p-0 text-xs underline underline-offset-2" onClick={onView}>
            View in panel
          </Button>
        </div>
      )}
    </div>
  );
}
