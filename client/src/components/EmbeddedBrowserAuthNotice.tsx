import type { EmbeddedBrowserKind } from "@/lib/embeddedBrowser";

export const EMBEDDED_BROWSER_AUTH_APPEARANCE = {
  elements: {
    socialButtonsRoot: { display: "none" },
    socialButtons: { display: "none" },
    dividerRow: { display: "none" },
  },
} as const;

export function EmbeddedBrowserAuthNotice({ kind }: { kind: EmbeddedBrowserKind }) {
  const browserName = kind === "instagram" ? "Instagram" : kind === "facebook" ? "Facebook" : "this app";

  return (
    <div
      role="status"
      data-testid="embedded-browser-auth-notice"
      className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm leading-relaxed"
    >
      <p className="font-semibold">Use email here, or open your browser for Google</p>
      <p className="mt-1 text-muted-foreground">
        {browserName} blocks Google sign-in inside its built-in browser. You can create or access
        your account with email and password below.
      </p>
      <p className="mt-2 text-muted-foreground">
        To use Google, tap the three dots at the top right and choose <strong>Open in browser</strong>
        {" "}or <strong>Open in Safari</strong>.
      </p>
    </div>
  );
}

