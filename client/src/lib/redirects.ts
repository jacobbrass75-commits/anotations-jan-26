export const DEFAULT_SIGNED_IN_REDIRECT = "/dashboard";

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
