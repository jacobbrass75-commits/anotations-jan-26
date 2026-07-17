export const SIGNUP_IN_PROGRESS_KEY = "scholarmark_signup_in_progress";
const SIGNUP_IN_PROGRESS_COOKIE = "scholarmark_signup_in_progress";
const SIGNUP_PROGRESS_TTL_SECONDS = 30 * 60;

function hasProgressCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split(";")
    .some((part) => part.trim() === `${SIGNUP_IN_PROGRESS_COOKIE}=1`);
}

function writeProgressCookie(maxAge: number): void {
  if (typeof document === "undefined") return;
  const secure =
    typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${SIGNUP_IN_PROGRESS_COOKIE}=1; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
}

/** Returns true only for the first signup-page mount in this browser session. */
export function markSignupInProgress(): boolean {
  try {
    if (sessionStorage.getItem(SIGNUP_IN_PROGRESS_KEY) === "1") return false;
    sessionStorage.setItem(SIGNUP_IN_PROGRESS_KEY, "1");
  } catch {
    if (hasProgressCookie()) return false;
  }

  try {
    writeProgressCookie(SIGNUP_PROGRESS_TTL_SECONDS);
  } catch {
    // The in-memory page event still works if first-party cookies are blocked.
  }
  return true;
}

/**
 * Consume the marker after authentication. The short-lived first-party cookie
 * recovers attribution when an embedded/private browser drops sessionStorage
 * during the authentication navigation.
 */
export function consumeSignupInProgress(): boolean {
  let pending = false;
  try {
    pending = sessionStorage.getItem(SIGNUP_IN_PROGRESS_KEY) === "1";
    sessionStorage.removeItem(SIGNUP_IN_PROGRESS_KEY);
  } catch {
    // Fall through to the first-party cookie.
  }

  try {
    pending ||= hasProgressCookie();
    writeProgressCookie(0);
  } catch {
    // Analytics state must never block a completed login.
  }
  return pending;
}
