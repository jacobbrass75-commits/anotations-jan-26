import { useState, useEffect } from "react";

const BOOT_LINES = [
  { text: "NERV DOCUMENT ANALYSIS SYSTEM", delay: 0, className: "text-eva-orange text-lg" },
  { text: "SCHOLARMARK EVA EDITION v2.0", delay: 200, className: "text-eva-orange" },
  { text: "", delay: 300, className: "" },
  { text: "INITIALIZING MAGI SUBSYSTEMS...", delay: 400, className: "text-muted-foreground" },
  { text: "[OK] Pattern Recognition Engine", delay: 600, className: "text-eva-green" },
  { text: "[OK] Semantic Analysis Module", delay: 800, className: "text-eva-green" },
  { text: "[OK] Annotation Pipeline v2", delay: 1000, className: "text-eva-green" },
  { text: "[OK] Document Processing Core", delay: 1200, className: "text-eva-green" },
  { text: "[OK] Citation Generator", delay: 1400, className: "text-eva-green" },
  { text: "", delay: 1500, className: "" },
  { text: "ALL SYSTEMS NOMINAL", delay: 1600, className: "text-eva-orange font-bold" },
  { text: "READY FOR OPERATION", delay: 1800, className: "text-eva-green font-bold" },
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
      className={`fixed inset-0 z-[100] bg-eva-dark flex items-center justify-center transition-opacity duration-500 ${
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
