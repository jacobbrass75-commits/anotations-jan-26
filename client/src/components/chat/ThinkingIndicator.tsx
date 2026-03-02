import { Loader2, Search, FileText, Brain, PenLine, BookOpen, CheckCircle, Layers } from "lucide-react";

interface ThinkingIndicatorProps {
  tool: string;
  label?: string;
}

const TOOL_ICONS: Record<string, React.ElementType> = {
  search_sources: Search,
  request_annotation_context: FileText,
  deep_source_analysis: Brain,
  propose_outline: Layers,
  write_section: PenLine,
  compile_paper: BookOpen,
  verify_citations: CheckCircle,
};

export function ThinkingIndicator({ tool, label }: ThinkingIndicatorProps) {
  const Icon = TOOL_ICONS[tool] || Loader2;
  const displayLabel = label || `Processing...`;

  return (
    <div className="flex justify-start mb-4">
      <div className="inline-flex items-center gap-2 rounded-full px-4 py-2 bg-primary/10 border border-primary/20 text-sm text-primary">
        <Icon className="h-4 w-4 animate-pulse" />
        <span>{displayLabel}</span>
        <span className="flex gap-0.5">
          <span className="w-1 h-1 bg-primary rounded-full animate-bounce [animation-delay:0ms]" />
          <span className="w-1 h-1 bg-primary rounded-full animate-bounce [animation-delay:150ms]" />
          <span className="w-1 h-1 bg-primary rounded-full animate-bounce [animation-delay:300ms]" />
        </span>
      </div>
    </div>
  );
}
