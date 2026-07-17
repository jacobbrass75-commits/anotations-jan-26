import { DIRECT_SIGNUP_ATTRIBUTION_PARAMS } from "../../../shared/paidInstagramEntry";

export const DEFAULT_SIGNED_IN_REDIRECT = "/dashboard";
export const DEFAULT_APP_ORIGIN = "https://scholarmark.ai";
export const DEFAULT_CLERK_ACCOUNT_PORTAL_ORIGIN = "https://accounts.scholarmark.ai";

export type ClerkAccountPortalAuthKind = "sign-in" | "sign-up";

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

export function normalizeSafeRedirectUrl(redirectUrl: string | null | undefined): string {
  if (!redirectUrl) return DEFAULT_SIGNED_IN_REDIRECT;
  if (
    !redirectUrl.startsWith("/") ||
    redirectUrl.startsWith("//") ||
    redirectUrl.includes("\\") ||
    hasControlCharacters(redirectUrl)
  ) {
    return DEFAULT_SIGNED_IN_REDIRECT;
  }

  const parsed = new URL(redirectUrl, DEFAULT_APP_ORIGIN);
  if (parsed.origin !== DEFAULT_APP_ORIGIN) return DEFAULT_SIGNED_IN_REDIRECT;

  const pathname = parsed.pathname;
  if (
    pathname === "/sign-in" ||
    pathname.startsWith("/sign-in/") ||
    pathname === "/sign-up" ||
    pathname.startsWith("/sign-up/")
  ) {
    return DEFAULT_SIGNED_IN_REDIRECT;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function getSafeRedirectUrl(search?: string): string {
  const query = search ?? (typeof window === "undefined" ? "" : window.location.search);
  const params = new URLSearchParams(query);
  return normalizeSafeRedirectUrl(params.get("redirect_url") || params.get("redirect"));
}

export function withRedirectUrl(path: string, redirectUrl: string): string {
  const params = new URLSearchParams();
  params.set("redirect_url", redirectUrl);
  return `${path}?${params.toString()}`;
}

export function buildClerkAccountPortalUrl(
  kind: ClerkAccountPortalAuthKind,
  redirectUrl: string,
  appOrigin = typeof window === "undefined" ? DEFAULT_APP_ORIGIN : window.location.origin,
  portalOrigin = DEFAULT_CLERK_ACCOUNT_PORTAL_ORIGIN,
): string {
  const safeRedirectUrl = normalizeSafeRedirectUrl(redirectUrl);
  const appUrl = new URL(appOrigin);
  const returnUrl = new URL(safeRedirectUrl, appUrl);
  if (returnUrl.origin !== appUrl.origin) {
    returnUrl.href = new URL(DEFAULT_SIGNED_IN_REDIRECT, appUrl).toString();
  }
  const portalUrl = new URL(`/${kind}`, portalOrigin);
  portalUrl.searchParams.set("redirect_url", returnUrl.toString());
  return portalUrl.toString();
}

export function buildAttributedSignupUrl(
  search = "",
  redirectUrl = DEFAULT_SIGNED_IN_REDIRECT,
  embeddedAuth = false,
): string {
  const incoming = new URLSearchParams(search);
  const outgoing = new URLSearchParams();
  outgoing.set("redirect_url", normalizeSafeRedirectUrl(redirectUrl));

  for (const key of DIRECT_SIGNUP_ATTRIBUTION_PARAMS) {
    const value = incoming.get(key)?.trim();
    if (value) outgoing.set(key, value.slice(0, 200));
  }

  if (embeddedAuth) outgoing.set("embedded_auth", "1");

  return `/sign-up?${outgoing.toString()}`;
}

export function buildDirectSignupUrl(search = ""): string {
  return buildAttributedSignupUrl(search);
}
