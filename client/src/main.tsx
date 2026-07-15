import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";

// A cached HTML document can reference a code-split chunk removed by a newer
// deployment. Embedded social browsers are especially aggressive about that
// cache. Let Vite recover by requesting the current entry document.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  window.location.reload();
});

const LOCAL_DEV_AUTH = import.meta.env.VITE_LOCAL_DEV_AUTH === "true";
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!LOCAL_DEV_AUTH && !PUBLISHABLE_KEY) {
  throw new Error("Missing Clerk Publishable Key");
}

const root = createRoot(document.getElementById("root")!);

const MARKETING_HOSTS = new Set(["scholarmark.ai", "www.scholarmark.ai"]);
const FAST_MARKETING_PATHS = ["/", "/summer", "/invite"];

function isFastMarketingEntry(): boolean {
  if (!MARKETING_HOSTS.has(window.location.hostname.toLowerCase())) return false;
  return FAST_MARKETING_PATHS.some(
    (path) => window.location.pathname === path || window.location.pathname.startsWith(`${path}/`),
  );
}

async function renderApp() {
  if (isFastMarketingEntry()) {
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

void renderApp();
