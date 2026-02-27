import { useEffect, useState } from "react";

const TICKER_MESSAGES = [
  "MAGI SYSTEM: ONLINE",
  "NERV DOCUMENT ANALYSIS: ACTIVE",
  "SEMANTIC SEARCH: STANDING BY",
  "PATTERN RECOGNITION: NOMINAL",
  "ANNOTATION ENGINE: READY",
  "ENCRYPTION: AES-256",
];

export function DataTicker() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const timeStr = time.toLocaleTimeString("en-US", { hour12: false });
  const dateStr = time.toISOString().split("T")[0];

  return (
    <div className="fixed bottom-0 inset-x-0 h-6 bg-background/95 border-t border-border flex items-center z-50 font-mono text-[10px] text-muted-foreground overflow-hidden">
      <div className="flex-shrink-0 px-3 border-r border-border text-chart-2">
        {dateStr}
      </div>
      <div className="flex-shrink-0 px-3 border-r border-border text-primary">
        {timeStr}
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="animate-[eva-scroll_30s_linear_infinite] whitespace-nowrap">
          {TICKER_MESSAGES.map((msg, i) => (
            <span key={i} className="mx-8">
              {"/// "}
              {msg}
            </span>
          ))}
          {TICKER_MESSAGES.map((msg, i) => (
            <span key={`dup-${i}`} className="mx-8">
              {"/// "}
              {msg}
            </span>
          ))}
        </div>
      </div>
      <div className="flex-shrink-0 px-3 border-l border-border flex items-center gap-2">
        <div className="eva-status-active" />
        <span className="text-chart-2">OPERATIONAL</span>
      </div>
    </div>
  );
}
