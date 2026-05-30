import type { Response } from "express";

const DEFAULT_HEARTBEAT_MS = 15_000;
const MAX_ERROR_LENGTH = 700;

export function startSseHeartbeat(
  res: Response,
  options: {
    isClosed?: () => boolean;
    intervalMs?: number;
  } = {}
): () => void {
  const isClosed = options.isClosed || (() => false);
  const intervalMs = options.intervalMs || DEFAULT_HEARTBEAT_MS;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const writeHeartbeat = () => {
    if (isClosed() || res.writableEnded || res.destroyed) return;
    res.write(": keepalive\n\n");
  };

  writeHeartbeat();
  const heartbeat = setInterval(writeHeartbeat, intervalMs);
  heartbeat.unref?.();
  return () => clearInterval(heartbeat);
}

export function sanitizeSseError(error: unknown, fallback = "Request failed"): string {
  const raw = error instanceof Error ? error.message : String(error || fallback);
  const compact = raw.replace(/\s+/g, " ").trim();

  if (!compact) return fallback;

  if (/<(?:!doctype|html|head|body|div|span|a)\b/i.test(compact) || /cloudflare|cf-error|errorcode_5\d\d/i.test(compact)) {
    if (/504|gateway|timeout|timed out/i.test(compact)) {
      return "The request timed out while generating. Any completed sections were kept when available. Please try again.";
    }
    return fallback;
  }

  return compact.slice(0, MAX_ERROR_LENGTH);
}
