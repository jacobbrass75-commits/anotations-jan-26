export function getSafeRedirectUrl(search?: string): string {
  const query = search ?? (typeof window === "undefined" ? "" : window.location.search);
  const redirectUrl = new URLSearchParams(query).get("redirect_url") || "/";

  if (!redirectUrl.startsWith("/") || redirectUrl.startsWith("//")) {
    return "/";
  }

  return redirectUrl;
}

export function withRedirectUrl(path: string, redirectUrl: string): string {
  const params = new URLSearchParams();
  params.set("redirect_url", redirectUrl);
  return `${path}?${params.toString()}`;
}
