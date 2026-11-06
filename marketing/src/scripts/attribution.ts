/**
 * Forwards campaign parameters from the landing URL to app links so the app records the
 * same attribution it does today (see buildAttributedSignupUrl in
 * client/src/lib/redirects.ts). The marketing site itself sends no analytics.
 *
 * Parameters are kept in sessionStorage only, so a visitor who reads a guide before
 * signing up keeps the campaign that brought them in during that visit.
 */
import {
  EMBEDDED_BROWSER,
  attributedLinkKind,
  attributionFromSearch,
  attributionFromStored,
  decorateHref,
  type Attribution,
} from "./attributionCore.ts";

const STORAGE_KEY = "scholarmark_marketing_attribution";

function fromStorage(): Attribution {
  try {
    return attributionFromStored(sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

/** A new campaign on the URL replaces the stored one instead of mixing values. */
function currentAttribution(): Attribution {
  const incoming = attributionFromSearch(window.location.search);
  if (Object.keys(incoming).length === 0) return fromStorage();
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(incoming));
  } catch {
    // Storage can be unavailable in private or in-app browsers; the URL still works.
  }
  return incoming;
}

function decorateAppLinks(): void {
  const attribution = currentAttribution();
  const embedded = EMBEDDED_BROWSER.test(navigator.userAgent);
  if (Object.keys(attribution).length === 0 && !embedded) return;

  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const kind = attributedLinkKind(link.href, link.hasAttribute("data-signup"));
    if (kind) link.href = decorateHref(link.href, kind, attribution, embedded);
  }
}

decorateAppLinks();
