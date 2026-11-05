/**
 * Forwards campaign parameters from the landing URL to signup links so the app
 * records the same attribution it does today (see buildAttributedSignupUrl in
 * client/src/lib/redirects.ts). The marketing site itself sends no analytics.
 *
 * Parameters are kept in sessionStorage only, so a visitor who reads a guide
 * before signing up keeps the campaign that brought them in during that visit.
 */

const ATTRIBUTION_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
  "fbclid",
] as const;

const STORAGE_KEY = "scholarmark_marketing_attribution";
const MAX_VALUE_LENGTH = 200;
const EMBEDDED_BROWSER = /Instagram|FBAN|FBAV|FB_IAB|MessengerForiOS|; wv\)|\bwv\b/i;

type Attribution = Partial<Record<(typeof ATTRIBUTION_PARAMS)[number], string>>;

function fromSearch(search: string): Attribution {
  const params = new URLSearchParams(search);
  const found: Attribution = {};
  for (const key of ATTRIBUTION_PARAMS) {
    const value = params.get(key)?.trim();
    if (value) found[key] = value.slice(0, MAX_VALUE_LENGTH);
  }
  return found;
}

function fromStorage(): Attribution {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const found: Attribution = {};
    for (const key of ATTRIBUTION_PARAMS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) found[key] = value.trim().slice(0, MAX_VALUE_LENGTH);
    }
    return found;
  } catch {
    return {};
  }
}

/** A new campaign on the URL replaces the stored one instead of mixing values. */
function currentAttribution(): Attribution {
  const incoming = fromSearch(window.location.search);
  if (Object.keys(incoming).length === 0) return fromStorage();
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(incoming));
  } catch {
    // Storage can be unavailable in private or in-app browsers; the URL still works.
  }
  return incoming;
}

function decorateSignupLinks(): void {
  const attribution = currentAttribution();
  const embedded = EMBEDDED_BROWSER.test(navigator.userAgent);
  if (Object.keys(attribution).length === 0 && !embedded) return;

  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[data-signup]")) {
    const url = new URL(link.href);
    for (const [key, value] of Object.entries(attribution)) {
      if (value && !url.searchParams.has(key)) url.searchParams.set(key, value);
    }
    // Instagram and Facebook webviews need the app's embedded-auth flow, as on the current landing page.
    if (embedded) url.searchParams.set("embedded_auth", "1");
    link.href = url.toString();
  }
}

decorateSignupLinks();
