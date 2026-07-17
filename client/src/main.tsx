import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";
import {
  buildStaleAssetRecoveryUrl,
  getStaleAssetRecoveryStorageKey,
  STALE_ASSET_STABILITY_MS,
  stripStaleAssetRecoveryParam,
} from "@/lib/assetRecovery";
import { getPaidInstagramSignupRedirect, isFastMarketingEntry } from "@/lib/marketingEntry";

function requestStaleAssetRecovery(): boolean {
  const recoveryWindow = window as typeof window & {
    __scholarmarkRecoverStaleAssets?: () => boolean;
  };
  if (recoveryWindow.__scholarmarkRecoverStaleAssets) {
    return recoveryWindow.__scholarmarkRecoverStaleAssets();
  }

  const storageKey = getStaleAssetRecoveryStorageKey(window.location.pathname);
  try {
    if (window.sessionStorage.getItem(storageKey) === "1") return false;
    window.sessionStorage.setItem(storageKey, "1");
  } catch {
    // The URL marker still prevents a loop when storage is unavailable.
  }
  const recoveryUrl = buildStaleAssetRecoveryUrl(window.location.href);
  if (!recoveryUrl) return false;
  window.location.replace(recoveryUrl);
  return true;
}

// A stale cached document can reference a removed code-split chunk. Recover
// once with a cache-busting document request; the inline bootstrap in
// index.html handles the same failure when even this entry bundle is stale.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  requestStaleAssetRecovery();
});

const LOCAL_DEV_AUTH = import.meta.env.VITE_LOCAL_DEV_AUTH === "true";
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!LOCAL_DEV_AUTH && !PUBLISHABLE_KEY) {
  throw new Error("Missing Clerk Publishable Key");
}

const root = createRoot(document.getElementById("root")!);

async function renderApp() {
  const paidInstagramSignupUrl = getPaidInstagramSignupRedirect(
    window.location.hostname,
    window.location.pathname,
    window.location.search,
  );
  if (paidInstagramSignupUrl) {
    window.location.replace(paidInstagramSignupUrl);
    return;
  }

  if (isFastMarketingEntry(window.location.hostname, window.location.pathname)) {
    const [{ default: SummerCampaign }, { SiteAnalyticsTracker }] = await Promise.all([
      import("./pages/SummerCampaign"),
      import("./components/SiteAnalyticsTracker"),
    ]);
    root.render(
      <StrictMode>
        <SiteAnalyticsTracker />
        <SummerCampaign />
      </StrictMode>,
    );
    return;
  }

  const { default: App } = await import("./App");
  const app = (
    <StrictMode>
      <App />
    </StrictMode>
  );

  if (LOCAL_DEV_AUTH) {
    root.render(app);
    return;
  }

  const { ClerkProvider } = await import("@clerk/clerk-react");
  root.render(
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
      {app}
    </ClerkProvider>,
  );
}

void renderApp().then(() => {
  window.setTimeout(() => {
    try {
      window.sessionStorage.removeItem(getStaleAssetRecoveryStorageKey(window.location.pathname));
    } catch {
      // Storage can be unavailable in privacy-restricted webviews.
    }
    const cleanUrl = stripStaleAssetRecoveryParam(window.location.href);
    if (
      cleanUrl !== `${window.location.pathname}${window.location.search}${window.location.hash}`
    ) {
      window.history.replaceState(window.history.state, "", cleanUrl);
    }
  }, STALE_ASSET_STABILITY_MS);
});
