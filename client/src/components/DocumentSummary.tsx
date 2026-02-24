import { FileText, Lightbulb, Tag } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { Document } from "@shared/schema";

interface DocumentSummaryProps {
  document: Document | null;
  isLoading: boolean;
}

export function DocumentSummary({ document, isLoading }: DocumentSummaryProps) {
  if (isLoading) {
    return (
      <Card className="eva-corner-decor">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="eva-hex-spinner" style={{ width: "1.5rem", height: "1.5rem" }} />
            <span className="text-sm font-medium">Generating summary...</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </CardContent>
      </Card>
    );
  }

  if (!document?.summary) {
    return null;
  }

  return (
    <Card className="eva-corner-decor">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <h3 className="eva-section-title text-sm">DOCUMENT ANALYSIS</h3>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground leading-relaxed">
          {document.summary}
        </p>

        {document.mainArguments && document.mainArguments.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-3.5 w-3.5 text-chart-4" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Main Arguments
              </span>
            </div>
            <ul className="space-y-1.5">
              {document.mainArguments.map((arg, i) => (
                <li key={i} className="text-sm text-foreground flex items-start gap-2">
                  <span className="text-muted-foreground shrink-0">•</span>
                  <span>{arg}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {document.keyConcepts && document.keyConcepts.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Tag className="h-3.5 w-3.5 text-chart-3" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Key Concepts
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {document.keyConcepts.map((concept, i) => (
                <Badge key={i} variant="secondary" className="bg-eva-purple/30 text-eva-cyan border border-eva-cyan/20 font-mono text-xs">
                  {concept}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
