const MARKETING_HOSTS = new Set(["scholarmark.ai", "www.scholarmark.ai"]);
const DIRECT_INSTAGRAM_PATHS = new Set(["/", "/start"]);
const INSTAGRAM_SOURCES = new Set(["ig", "instagram", "instagramcom"]);
const PAID_MEDIA = new Set(["paid", "paidsocial", "cpc"]);
export const DIRECT_SIGNUP_ATTRIBUTION_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
  "fbclid",
] as const;

function normalizedCampaignValue(value: string | null): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function isScholarMarkMarketingHost(hostname: string): boolean {
  return MARKETING_HOSTS.has(hostname.toLowerCase());
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
  if (!isScholarMarkMarketingHost(hostname) || !DIRECT_INSTAGRAM_PATHS.has(pathname)) {
    return null;
  }

  const incoming = new URLSearchParams(search);
  // Landing-first is the safe default for Instagram. Direct signup previously
  // recreated an in-app-browser loop, so keep it available only as an explicit
  // opt-in for controlled testing instead of inferring it from paid UTMs.
  if (
    incoming.get("sm_direct_signup") !== "1" ||
    incoming.get("sm_landing") === "1" ||
    !isPaidInstagramCampaign(search)
  ) {
    return null;
  }

  const outgoing = new URLSearchParams();
  outgoing.set("redirect_url", "/dashboard");

  for (const key of DIRECT_SIGNUP_ATTRIBUTION_PARAMS) {
    const value = incoming.get(key)?.trim();
    if (value) outgoing.set(key, value.slice(0, 200));
  }

  outgoing.set("embedded_auth", "1");
  outgoing.set("sm_direct_signup", "1");
  return `/sign-up?${outgoing.toString()}`;
}
