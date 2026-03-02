import { useEffect, useMemo, useState } from "react";
import type { ToolStep } from "@/hooks/useWritingChat";
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, Wrench } from "lucide-react";

interface ToolStepsIndicatorProps {
  steps: ToolStep[];
  isToolPhaseActive: boolean;
}

const TOOL_LABELS: Record<string, { verb: string }> = {
  get_source_summary: { verb: "Reading summary" },
  get_source_annotations: { verb: "Loading annotations" },
  get_source_chunks: { verb: "Getting context" },
  get_web_clips: { verb: "Checking web clips" },
};

function getStepLabel(step: ToolStep): string {
  const verb = TOOL_LABELS[step.toolName]?.verb || "Using tool";
  if (!step.sourceTitle) {
    return verb;
  }
  return `${verb} - "${step.sourceTitle}"`;
}

export function ToolStepsIndicator({ steps, isToolPhaseActive }: ToolStepsIndicatorProps) {
  const [expanded, setExpanded] = useState(false);

  const sortedSteps = useMemo(
    () => [...steps].sort((a, b) => a.startedAt - b.startedAt),
    [steps]
  );
  const allDone = sortedSteps.length > 0 && sortedSteps.every((step) => step.status === "done");
  const canCollapse = !isToolPhaseActive && allDone;
  const uniqueSourceCount = useMemo(() => {
    const titles = new Set(
      sortedSteps
        .map((step) => (step.sourceTitle || "").trim())
        .filter((title) => title.length > 0)
    );
    return titles.size > 0 ? titles.size : sortedSteps.length;
  }, [sortedSteps]);

  useEffect(() => {
    if (sortedSteps.length === 0) {
      setExpanded(false);
      return;
    }
    if (isToolPhaseActive) {
      setExpanded(true);
      return;
    }
    if (allDone) {
      setExpanded(false);
    }
  }, [allDone, isToolPhaseActive, sortedSteps.length]);

  if (sortedSteps.length === 0) {
    return null;
  }

  if (canCollapse && !expanded) {
    return (
      <div className="border-t border-border px-5 py-2 bg-background/60">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/40"
        >
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          <span className="font-medium text-foreground/85">
            Used {uniqueSourceCount} source{uniqueSourceCount === 1 ? "" : "s"}
          </span>
          <span className="text-[11px] text-muted-foreground">click to expand</span>
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-border px-5 py-2 bg-background/60">
      <div className="rounded-lg border bg-card/70 px-3 py-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Wrench className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-medium">Researching sources</span>
          </div>
          {canCollapse && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className="h-3.5 w-3.5" />
              collapse
            </button>
          )}
        </div>

        <div className="space-y-1.5">
          {sortedSteps.map((step) => (
            <div key={step.id} className="flex items-center gap-2 text-xs">
              {step.status === "done" ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              ) : (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
              )}
              <span className="text-foreground/90">{getStepLabel(step)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
