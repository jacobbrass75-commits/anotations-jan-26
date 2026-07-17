import { DEFAULT_APP_ORIGIN, buildAttributedSignupUrl } from "./redirects";

const MARKETING_HOSTS = new Set(["scholarmark.ai", "www.scholarmark.ai"]);
const FAST_MARKETING_PATHS = ["/", "/start", "/summer", "/invite"];
const DIRECT_INSTAGRAM_PATHS = new Set(["/", "/start"]);
const INSTAGRAM_SOURCES = new Set(["ig", "instagram", "instagramcom"]);
const PAID_MEDIA = new Set(["paid", "paidsocial", "cpc"]);

function normalizedCampaignValue(value: string | null): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function isFastMarketingEntry(hostname: string, pathname: string): boolean {
  if (!MARKETING_HOSTS.has(hostname.toLowerCase())) return false;
  return FAST_MARKETING_PATHS.some(
    (path) => pathname === path || (path !== "/" && pathname.startsWith(`${path}/`)),
  );
}

export function isPaidInstagramCampaign(search: string): boolean {
  const incoming = new URLSearchParams(search);
  const source = normalizedCampaignValue(incoming.get("utm_source"));
  const medium = normalizedCampaignValue(incoming.get("utm_medium"));
  return INSTAGRAM_SOURCES.has(source) && PAID_MEDIA.has(medium);
}

export function isPaidInstagramDirectSignup(search: string): boolean {
  return (
    new URLSearchParams(search).get("sm_direct_signup") === "1" && isPaidInstagramCampaign(search)
  );
}

export function getPaidInstagramSignupRedirect(
  hostname: string,
  pathname: string,
  search: string,
): string | null {
  if (!MARKETING_HOSTS.has(hostname.toLowerCase()) || !DIRECT_INSTAGRAM_PATHS.has(pathname)) {
    return null;
  }

  const incoming = new URLSearchParams(search);
  if (incoming.get("sm_landing") === "1") return null;

  if (!isPaidInstagramCampaign(search)) return null;

  const target = new URL(buildAttributedSignupUrl(search, undefined, true), DEFAULT_APP_ORIGIN);
  target.searchParams.set("sm_direct_signup", "1");
  return `${target.pathname}${target.search}`;
}
