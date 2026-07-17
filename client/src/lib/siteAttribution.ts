export interface SiteAttribution {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  referrer?: string | null;
}

export const SITE_ATTRIBUTION_KEY = "scholarmark_site_attribution";
const SITE_ATTRIBUTION_COOKIE = "scholarmark_site_attribution_v1";
const ATTRIBUTION_TTL_SECONDS = 30 * 60;

function meaningfulEntries(attribution: SiteAttribution): SiteAttribution {
  return Object.fromEntries(
    Object.entries(attribution)
      .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
      .map(([key, value]) => {
        const maxLength =
          key === "referrer" ? 1000 : key === "utmCampaign" || key === "utmContent" ? 200 : 100;
        return [key, (value as string).trim().slice(0, maxLength)];
      }),
  ) as SiteAttribution;
}

/**
 * Keep the first referrer while allowing explicit campaign parameters on the
 * current URL to supersede older campaign values. Missing URL parameters must
 * never erase attribution collected on the previous page.
 */
export function mergeSiteAttribution(
  stored: SiteAttribution,
  current: SiteAttribution,
): SiteAttribution {
  const saved = meaningfulEntries(stored);
  const incoming = meaningfulEntries(current);
  const { referrer: incomingReferrer, ...incomingCampaign } = incoming;

  return {
    ...saved,
    ...incomingCampaign,
    ...(saved.referrer ? {} : incomingReferrer ? { referrer: incomingReferrer } : {}),
  };
}

function safeReferrer(): string | null {
  if (!document.referrer) return null;
  try {
    const url = new URL(document.referrer);
    return `${url.origin}${url.pathname}`.slice(0, 1000);
  } catch {
    return null;
  }
}

function parsedAttribution(value: string | null): SiteAttribution {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? meaningfulEntries(parsed as SiteAttribution)
      : {};
  } catch {
    return {};
  }
}

function attributionCookie(): SiteAttribution {
  if (typeof document === "undefined") return {};
  const prefix = `${SITE_ATTRIBUTION_COOKIE}=`;
  for (const part of document.cookie.split(";")) {
    const value = part.trim();
    if (!value.startsWith(prefix)) continue;
    try {
      return parsedAttribution(decodeURIComponent(value.slice(prefix.length)));
    } catch {
      return {};
    }
  }
  return {};
}

function writeAttributionCookie(attribution: SiteAttribution): void {
  if (typeof document === "undefined" || Object.keys(attribution).length === 0) return;
  const secure =
    typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${SITE_ATTRIBUTION_COOKIE}=${encodeURIComponent(JSON.stringify(attribution))}; Max-Age=${ATTRIBUTION_TTL_SECONDS}; Path=/; SameSite=Lax${secure}`;
}

export function readSiteAttribution(params: URLSearchParams): SiteAttribution {
  const current: SiteAttribution = {
    utmSource: params.get("utm_source"),
    utmMedium: params.get("utm_medium"),
    utmCampaign: params.get("utm_campaign"),
    utmContent: params.get("utm_content"),
    referrer: safeReferrer(),
  };

  let stored: SiteAttribution = {};
  try {
    stored = parsedAttribution(sessionStorage.getItem(SITE_ATTRIBUTION_KEY));
  } catch {
    // Use the first-party cookie when storage is blocked or reset.
  }
  let cookieAttribution: SiteAttribution = {};
  try {
    cookieAttribution = attributionCookie();
  } catch {
    // The current URL still provides attribution when cookies are blocked.
  }

  const merged = mergeSiteAttribution(mergeSiteAttribution(cookieAttribution, stored), current);
  try {
    sessionStorage.setItem(SITE_ATTRIBUTION_KEY, JSON.stringify(merged));
  } catch {
    // The first-party cookie remains the cross-navigation fallback.
  }
  try {
    writeAttributionCookie(merged);
  } catch {
    // Analytics must not affect navigation when cookies are unavailable.
  }
  return merged;
}
