import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { markdownComponents, remarkPlugins } from "@/lib/markdownConfig";
import { Copy, Download, EyeOff, Loader2 } from "lucide-react";

interface DocumentPanelProps {
  title: string;
  content: string;
  isStreaming?: boolean;
  isPreparingDocx?: boolean;
  isPreparingPdf?: boolean;
  onCopy?: () => void;
  onDownloadDocx?: () => void;
  onDownloadPdf?: () => void;
  onClose?: () => void;
}

export function DocumentPanel({
  title,
  content,
  isStreaming = false,
  isPreparingDocx = false,
  isPreparingPdf = false,
  onCopy,
  onDownloadDocx,
  onDownloadPdf,
  onClose,
}: DocumentPanelProps) {
  return (
    <Card className="border-border bg-background/90 h-full min-h-0 flex flex-col">
      <CardHeader className="pb-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base truncate">{title || "Draft"}</CardTitle>
          <div className="flex items-center gap-1">
            {onCopy && (
              <Button variant="ghost" size="sm" onClick={onCopy}>
                <Copy className="h-4 w-4" />
              </Button>
            )}
            {onDownloadDocx && (
              <Button variant="ghost" size="sm" onClick={onDownloadDocx} disabled={isPreparingDocx}>
                {isPreparingDocx ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              </Button>
            )}
            {onDownloadPdf && (
              <Button variant="ghost" size="sm" onClick={onDownloadPdf} disabled={isPreparingPdf}>
                {isPreparingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              </Button>
            )}
            {onClose && (
              <Button variant="ghost" size="sm" onClick={onClose}>
                <EyeOff className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1">
        <ScrollArea className="h-full pr-1">
          <article className="prose prose-sm dark:prose-invert max-w-none font-serif leading-relaxed">
            <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
              {content}
            </ReactMarkdown>
            {isStreaming && <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />}
          </article>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
