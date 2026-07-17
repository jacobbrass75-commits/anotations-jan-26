const memoryIds = new Map<string, string>();

function newId(): string {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto?.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function cookieValue(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const value = part.trim();
    if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
  }
  return null;
}

function writeIdCookie(key: string, value: string): void {
  if (typeof document === "undefined") return;
  const maxAge = key.includes("visitor") ? 365 * 24 * 60 * 60 : 30 * 60;
  const secure =
    typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${key}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
}

/**
 * local/session storage remains the primary store. A matching first-party
 * cookie keeps the pseudonymous ID stable across embedded-browser reloads when
 * those storage APIs are unavailable.
 */
export function getAnalyticsId(storage: Storage, key: string): string {
  try {
    const existing = storage.getItem(key);
    if (existing) {
      try {
        writeIdCookie(key, existing);
      } catch {
        // The storage-backed ID remains valid when cookies are blocked.
      }
      return existing;
    }
  } catch {
    // Fall through to the first-party cookie and shared module memory.
  }

  let value: string | null = null;
  try {
    value = cookieValue(key);
  } catch {
    // Ignore malformed or blocked cookies.
  }
  value ||= memoryIds.get(key) ?? newId();
  memoryIds.set(key, value);

  try {
    storage.setItem(key, value);
  } catch {
    // Cookie and module memory remain available.
  }
  try {
    writeIdCookie(key, value);
  } catch {
    // Module memory remains the final same-page fallback.
  }
  return value;
}
