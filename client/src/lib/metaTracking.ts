export type MarketingConsent = "granted" | "denied" | "unknown";

export interface MetaSiteEventOptions {
  ctaOrFeature?: string;
  value?: number;
  currency?: string;
}

interface MetaPixelFunction {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[][];
  loaded?: boolean;
  version?: string;
}

declare global {
  interface Window {
    fbq?: MetaPixelFunction;
    _fbq?: MetaPixelFunction;
  }

  interface Navigator {
    globalPrivacyControl?: boolean;
  }
}

export const MARKETING_CONSENT_KEY = "scholarmark_marketing_consent";
export const MARKETING_CONSENT_EVENT = "scholarmark:marketing-consent";

const META_FBC_KEY = "scholarmark_meta_fbc";
const pixelId = (import.meta.env.VITE_META_PIXEL_ID ?? "").trim();
const pixelEnabled = import.meta.env.VITE_META_TRACKING_ENABLED === "true";
let initializedPixelId: string | null = null;

const STANDARD_META_EVENTS: Record<string, string> = {
  landing_view: "PageView",
  signup_completed: "CompleteRegistration",
};

const CUSTOM_META_EVENTS: Record<string, string> = {
  primary_cta_click: "PrimaryCtaClick",
  signup_started: "SignupStarted",
};

export function isMetaMarketingPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/start" ||
    pathname === "/pricing" ||
    pathname.startsWith("/summer") ||
    pathname.startsWith("/invite") ||
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up")
  );
}

function privacySignalEnabled(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.globalPrivacyControl === true || navigator.doNotTrack === "1";
}

export function isMetaPixelConfigured(): boolean {
  return isMetaPixelConfigValid(pixelEnabled, pixelId);
}

export function isMetaPixelConfigValid(enabled: boolean, configuredPixelId: string): boolean {
  return enabled && /^\d+$/.test(configuredPixelId.trim());
}

export function getMarketingConsent(): MarketingConsent {
  if (privacySignalEnabled()) return "denied";
  try {
    const value = localStorage.getItem(MARKETING_CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : "unknown";
  } catch {
    return "unknown";
  }
}

export function setMarketingConsent(consent: Exclude<MarketingConsent, "unknown">): void {
  try {
    localStorage.setItem(MARKETING_CONSENT_KEY, consent);
  } catch {
    // Consent remains session-local when persistent storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(MARKETING_CONSENT_EVENT, { detail: consent }));
}

export function clearMarketingConsent(): void {
  try {
    localStorage.removeItem(MARKETING_CONSENT_KEY);
  } catch {
    // Storage controls are best effort.
  }
  window.dispatchEvent(new CustomEvent(MARKETING_CONSENT_EVENT, { detail: "unknown" }));
}

function installPixelQueue(): MetaPixelFunction {
  if (window.fbq) return window.fbq;

  const fbq = ((...args: unknown[]) => {
    if (fbq.callMethod) {
      fbq.callMethod(...args);
      return;
    }
    (fbq.queue ??= []).push(args);
  }) as MetaPixelFunction;
  fbq.queue = [];
  fbq.loaded = true;
  fbq.version = "2.0";
  window.fbq = fbq;
  window._fbq = fbq;
  return fbq;
}

export function initializeMetaPixel(): boolean {
  if (!isMetaPixelConfigured() || getMarketingConsent() !== "granted") return false;

  const fbq = installPixelQueue();
  if (!document.getElementById("scholarmark-meta-pixel")) {
    const script = document.createElement("script");
    script.id = "scholarmark-meta-pixel";
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(script);
  }
  if (initializedPixelId !== pixelId) {
    fbq("init", pixelId);
    initializedPixelId = pixelId;
  }
  return true;
}

export function metaEventNameForSiteEvent(
  siteEventName: string,
): { name: string; custom: boolean } | null {
  if (STANDARD_META_EVENTS[siteEventName]) {
    return { name: STANDARD_META_EVENTS[siteEventName], custom: false };
  }
  if (CUSTOM_META_EVENTS[siteEventName]) {
    return { name: CUSTOM_META_EVENTS[siteEventName], custom: true };
  }
  return null;
}

function metaEventParameters(options: MetaSiteEventOptions): Record<string, unknown> {
  const parameters: Record<string, unknown> = {};
  if (options.ctaOrFeature) parameters.content_name = options.ctaOrFeature;
  if (Number.isFinite(options.value) && (options.value ?? -1) >= 0) {
    parameters.value = options.value;
    parameters.currency = (options.currency || "USD").toUpperCase();
  }
  return parameters;
}

export function trackMetaPixelEvent(
  siteEventName: string,
  eventId: string,
  options: MetaSiteEventOptions = {},
): boolean {
  if (!isMetaMarketingPath(window.location.pathname)) return false;
  const mapped = metaEventNameForSiteEvent(siteEventName);
  if (!mapped || !initializeMetaPixel() || !window.fbq) return false;

  const method = mapped.custom ? "trackCustom" : "track";
  window.fbq(method, mapped.name, metaEventParameters(options), { eventID: eventId });
  return true;
}

function cookieValue(name: string): string | null {
  const prefix = `${name}=`;
  for (const item of document.cookie.split(";")) {
    const value = item.trim();
    if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
  }
  return null;
}

function fbcValue(): string | null {
  const cookie = cookieValue("_fbc");
  if (cookie) return cookie.slice(0, 500);

  const fbclid = new URLSearchParams(window.location.search).get("fbclid")?.trim();
  if (fbclid) {
    const fbc = `fb.1.${Date.now()}.${fbclid}`.slice(0, 500);
    try {
      sessionStorage.setItem(META_FBC_KEY, fbc);
    } catch {
      // Session attribution is best effort.
    }
    return fbc;
  }

  try {
    return sessionStorage.getItem(META_FBC_KEY)?.slice(0, 500) ?? null;
  } catch {
    return null;
  }
}

export function getMetaBrowserIdentifiers(): { fbp: string | null; fbc: string | null } {
  if (getMarketingConsent() !== "granted") return { fbp: null, fbc: null };
  return {
    fbp: cookieValue("_fbp")?.slice(0, 500) ?? null,
    fbc: fbcValue(),
  };
}
