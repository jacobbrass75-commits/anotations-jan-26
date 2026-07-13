import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
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
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

async function renderApp() {
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
