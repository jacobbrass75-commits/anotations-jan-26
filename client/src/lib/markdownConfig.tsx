import type { MouseEvent } from "react";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

export const remarkPlugins = [remarkGfm];

const APP_ROUTE_PREFIXES = [
  "/account",
  "/admin",
  "/blog",
  "/chat",
  "/dashboard",
  "/extension-auth",
  "/faq",
  "/invite",
  "/pricing",
  "/privacy",
  "/projects",
  "/sign-in",
  "/sign-up",
  "/sso-callback",
  "/summer",
  "/support",
  "/terms",
  "/web-clips",
  "/write",
  "/writing",
  "/writing-styles",
];

function isAppRoute(pathname: string): boolean {
  return (
    pathname === "/" ||
    APP_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  );
}

export function getInternalMarkdownHref(
  href: string | null | undefined,
  currentOrigin =
    typeof window !== "undefined" && window.location?.origin ? window.location.origin : undefined,
): string | null {
  const trimmed = href?.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) {
    return null;
  }

  if (trimmed.startsWith("/")) {
    return isAppRoute(trimmed.split(/[?#]/, 1)[0] || "/") ? trimmed : null;
  }

  try {
    const url = new URL(trimmed);
    if (!currentOrigin || url.origin !== currentOrigin || !isAppRoute(url.pathname)) {
      return null;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function handleInternalMarkdownClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.altKey ||
    event.ctrlKey ||
    event.shiftKey ||
    typeof window === "undefined"
  ) {
    return;
  }

  event.preventDefault();
  window.history.pushState({}, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export const markdownComponents: Components = {
  a({ href, children, onClick, ...props }) {
    const internalHref = getInternalMarkdownHref(href);
    if (internalHref) {
      return (
        <a
          href={internalHref}
          onClick={(event) => {
            onClick?.(event);
            handleInternalMarkdownClick(event, internalHref);
          }}
          {...props}
        >
          {children}
        </a>
      );
    }

    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  },
  code({ className, children, ...props }) {
    const hasLanguage = /language-(\w+)/.test(className || "");
    const isBlock = hasLanguage || (typeof children === "string" && children.includes("\n"));
    if (isBlock) {
      return (
        <pre className="bg-muted rounded-md p-3 overflow-x-auto text-xs">
          <code className={className} {...props}>
            {children}
          </code>
        </pre>
      );
    }
    return (
      <code className="bg-muted px-1 py-0.5 rounded text-xs" {...props}>
        {children}
      </code>
    );
  },
};
