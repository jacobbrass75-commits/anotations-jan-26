import { useEffect, useMemo, useState } from "react";
import { Progress } from "@/components/ui/progress";

const ANALYSIS_STAGES = [
  { threshold: 0, label: "Preparing samples" },
  { threshold: 18, label: "Chunking writing samples" },
  { threshold: 38, label: "Reading style signals" },
  { threshold: 62, label: "Comparing recurring patterns" },
  { threshold: 82, label: "Synthesizing voice profile" },
  { threshold: 94, label: "Saving profile" },
];

export function useAnalysisProgress(active: boolean) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!active) {
      setProgress(0);
      return;
    }

    setProgress(6);
    const interval = window.setInterval(() => {
      setProgress((current) => {
        if (current < 35) return current + 4;
        if (current < 70) return current + 2;
        if (current < 94) return current + 1;
        return current;
      });
    }, 850);

    return () => window.clearInterval(interval);
  }, [active]);

  const label = useMemo(() => {
    return [...ANALYSIS_STAGES]
      .reverse()
      .find((stage) => progress >= stage.threshold)?.label || ANALYSIS_STAGES[0].label;
  }, [progress]);

  return { progress, label };
}

interface AnalysisProgressPanelProps {
  active: boolean;
  className?: string;
  title?: string;
}

export function AnalysisProgressPanel({
  active,
  className = "",
  title = "Analyzing writing style",
}: AnalysisProgressPanelProps) {
  const { progress, label } = useAnalysisProgress(active);
  if (!active) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2 ${className}`}
    >
      <div className="flex items-center justify-between gap-3 text-xs font-mono uppercase tracking-[0.16em]">
        <span className="text-foreground">{title}</span>
        <span className="text-muted-foreground">{Math.min(progress, 99)}%</span>
      </div>
      <Progress value={progress} className="h-2" />
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
