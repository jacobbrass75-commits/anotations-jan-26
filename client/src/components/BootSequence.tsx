import { useState, useEffect } from "react";

const BOOT_LINES = [
  { text: "SCHOLARMARK RESEARCH WORKSPACE", delay: 0, className: "text-primary text-lg" },
  { text: "VERSION 2.0", delay: 200, className: "text-primary" },
  { text: "", delay: 300, className: "" },
  { text: "LOADING CORE TOOLS...", delay: 400, className: "text-muted-foreground" },
  { text: "[OK] Project workspace", delay: 600, className: "text-chart-2" },
  { text: "[OK] Source search", delay: 800, className: "text-chart-2" },
  { text: "[OK] Annotation review", delay: 1000, className: "text-chart-2" },
  { text: "[OK] Writing studio", delay: 1200, className: "text-chart-2" },
  { text: "[OK] Citation tools", delay: 1400, className: "text-chart-2" },
  { text: "", delay: 1500, className: "" },
  { text: "WORKSPACE READY", delay: 1600, className: "text-primary font-bold" },
  { text: "OPENING DASHBOARD", delay: 1800, className: "text-chart-2 font-bold" },
];

export function BootSequence({ onComplete }: { onComplete: () => void }) {
  const [visibleLines, setVisibleLines] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    BOOT_LINES.forEach((line, i) => {
      timers.push(setTimeout(() => setVisibleLines(i + 1), line.delay));
    });
    timers.push(setTimeout(() => setFading(true), 2200));
    timers.push(setTimeout(() => onComplete(), 2700));
    return () => timers.forEach(clearTimeout);
  }, [onComplete]);

  return (
    <div
      className={`fixed inset-0 z-[100] bg-background flex items-center justify-center transition-opacity duration-500 ${
        fading ? "opacity-0" : "opacity-100"
      }`}
    >
      <div className="eva-grid-bg absolute inset-0 opacity-30" />
      <div className="relative max-w-lg w-full px-8">
        <div className="font-mono text-sm space-y-1">
          {BOOT_LINES.slice(0, visibleLines).map((line, i) => (
            <div key={i} className={line.className}>
              {line.text || "\u00A0"}
            </div>
          ))}
          {visibleLines < BOOT_LINES.length && <span className="eva-cursor text-muted-foreground" />}
        </div>
      </div>
    </div>
  );
}
