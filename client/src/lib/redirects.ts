export const DEFAULT_SIGNED_IN_REDIRECT = "/dashboard";

const DIRECT_SIGNUP_ATTRIBUTION_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
  "fbclid",
] as const;

export function getSafeRedirectUrl(search?: string): string {
  const query = search ?? (typeof window === "undefined" ? "" : window.location.search);
  const params = new URLSearchParams(query);
  const redirectUrl =
    params.get("redirect_url") || params.get("redirect") || DEFAULT_SIGNED_IN_REDIRECT;

  if (!redirectUrl.startsWith("/") || redirectUrl.startsWith("//")) {
    return DEFAULT_SIGNED_IN_REDIRECT;
  }

  if (redirectUrl.startsWith("/sign-in") || redirectUrl.startsWith("/sign-up")) {
    return DEFAULT_SIGNED_IN_REDIRECT;
  }

  return redirectUrl;
}

export function withRedirectUrl(path: string, redirectUrl: string): string {
  const params = new URLSearchParams();
  params.set("redirect_url", redirectUrl);
  return `${path}?${params.toString()}`;
}

export function buildDirectSignupUrl(search = ""): string {
  const incoming = new URLSearchParams(search);
  const outgoing = new URLSearchParams();
  outgoing.set("redirect_url", "/dashboard");

  for (const key of DIRECT_SIGNUP_ATTRIBUTION_PARAMS) {
    const value = incoming.get(key)?.trim();
    if (value) outgoing.set(key, value.slice(0, 200));
  }

  return `/sign-up?${outgoing.toString()}`;
}
