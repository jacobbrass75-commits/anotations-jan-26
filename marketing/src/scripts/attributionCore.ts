/**
 * Pure helpers behind attribution.ts, kept free of DOM access so they can be unit tested
 * (tests/attribution.test.ts). They mirror buildAttributedSignupUrl in
 * client/src/lib/redirects.ts: the same parameters, trimmed and capped at 200 characters.
 */
import { APP_ORIGIN } from "../config/origins.ts";

export const ATTRIBUTION_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
  "fbclid",
] as const;

export const MAX_VALUE_LENGTH = 200;

export const EMBEDDED_BROWSER = /Instagram|FBAN|FBAV|FB_IAB|MessengerForiOS|; wv\)|\bwv\b/i;

export type Attribution = Partial<Record<(typeof ATTRIBUTION_PARAMS)[number], string>>;

export function attributionFromSearch(search: string): Attribution {
  const params = new URLSearchParams(search);
  const found: Attribution = {};
  for (const key of ATTRIBUTION_PARAMS) {
    const value = params.get(key)?.trim();
    if (value) found[key] = value.slice(0, MAX_VALUE_LENGTH);
  }
  return found;
}

export function attributionFromStored(raw: string | null): Attribution {
  try {
    const parsed: unknown = JSON.parse(raw ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const found: Attribution = {};
    for (const key of ATTRIBUTION_PARAMS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) {
        found[key] = value.trim().slice(0, MAX_VALUE_LENGTH);
      }
    }
    return found;
  } catch {
    return {};
  }
}

/**
 * The links that carry attribution into the app.
 *
 * - `signup`: any link marked `data-signup`. Gets the campaign and, in Instagram/Facebook
 *   webviews, `embedded_auth=1`.
 * - `pricing`: the app pricing page. Gets the campaign only. The app reads attribution from
 *   the URL of the first app page it sees, so without it a visitor who goes to pricing first
 *   reaches the app with no campaign, and so does a signup that starts there.
 *
 * Sign-in, legal and support links are left alone.
 */
export type AttributedLink = "signup" | "pricing" | null;

export function attributedLinkKind(href: string, markedSignup: boolean): AttributedLink {
  if (markedSignup) return "signup";
  try {
    const url = new URL(href);
    return url.origin === APP_ORIGIN && url.pathname === "/pricing" ? "pricing" : null;
  } catch {
    return null;
  }
}

/** Adds the campaign to an app link. Parameters already on the link are never overwritten. */
export function decorateHref(
  href: string,
  kind: Exclude<AttributedLink, null>,
  attribution: Attribution,
  embedded: boolean,
): string {
  const url = new URL(href);
  for (const [key, value] of Object.entries(attribution)) {
    if (value && !url.searchParams.has(key)) url.searchParams.set(key, value);
  }
  // Instagram and Facebook webviews need the app's embedded-auth flow, as on the current landing page.
  if (kind === "signup" && embedded) url.searchParams.set("embedded_auth", "1");
  return url.toString();
}
