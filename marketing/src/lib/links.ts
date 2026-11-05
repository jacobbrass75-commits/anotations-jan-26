import { APP_ORIGIN, SUPPORT_EMAIL } from "../config/release";

/**
 * Where a new account lands after signup. Matches the current scholarmark.ai
 * landing page so onboarding, pricing and attribution behave exactly as today.
 */
export const SIGNUP_REDIRECT = "/pricing?onboarding=1&source=summer";

function appUrl(path: string, params: Record<string, string> = {}): string {
  const url = new URL(path, APP_ORIGIN);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

export const links = {
  signup: appUrl("/sign-up", { redirect_url: SIGNUP_REDIRECT }),
  signin: appUrl("/sign-in", { redirect_url: "/dashboard" }),
  pricing: appUrl("/pricing"),
  privacy: appUrl("/privacy"),
  terms: appUrl("/terms"),
  support: appUrl("/support"),
  supportEmail: `mailto:${SUPPORT_EMAIL}`,
} as const;
