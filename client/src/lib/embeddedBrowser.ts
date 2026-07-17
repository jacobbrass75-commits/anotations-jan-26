export type EmbeddedBrowserKind = "instagram" | "facebook" | "other";

const FACEBOOK_WEBVIEW_PATTERN = /FBAN|FBAV|FB_IAB|MessengerForiOS/i;
const OTHER_EMBEDDED_BROWSER_PATTERN = /Line\/|Snapchat|Twitter for iPhone|; wv\)|\bwv\b/i;

export function detectEmbeddedBrowser(
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
  search = typeof window === "undefined" ? "" : window.location.search,
): EmbeddedBrowserKind | null {
  if (/Instagram/i.test(userAgent)) return "instagram";
  if (FACEBOOK_WEBVIEW_PATTERN.test(userAgent)) return "facebook";
  if (OTHER_EMBEDDED_BROWSER_PATTERN.test(userAgent)) return "other";
  if (new URLSearchParams(search).get("embedded_auth") === "1") return "other";
  return null;
}
