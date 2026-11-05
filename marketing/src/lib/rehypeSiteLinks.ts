import { APP_ORIGIN, SITE_ORIGIN } from "../config/release";
import { SIGNUP_REDIRECT } from "./links";

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const SIGNUP_URL = `${APP_ORIGIN}/sign-up`;

/** `/guides/foo` and `https://scholarmark.ai/guides/foo` become `/guides/foo/`. */
function normalizeInternal(href: string): string | null {
  const isRootRelative = href.startsWith("/") && !href.startsWith("//");
  if (!isRootRelative && !href.startsWith(`${SITE_ORIGIN}/`)) return null;

  const url = new URL(href, SITE_ORIGIN);
  const lastSegment = url.pathname.split("/").pop() ?? "";
  if (lastSegment && !lastSegment.includes(".")) url.pathname = `${url.pathname}/`;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Signup links written in guides get the same onboarding redirect and attribution as the site's CTAs. */
function decorateSignup(node: HastNode, href: string): void {
  if (href !== SIGNUP_URL && !href.startsWith(`${SIGNUP_URL}?`) && !href.startsWith(`${SIGNUP_URL}/`)) {
    return;
  }
  const url = new URL(href);
  if (!url.searchParams.has("redirect_url")) url.searchParams.set("redirect_url", SIGNUP_REDIRECT);
  node.properties = {
    ...node.properties,
    href: url.toString(),
    dataSignup: "",
    target: "_top",
  };
}

function walk(node: HastNode): void {
  if (node.type === "element" && node.tagName === "a") {
    const href = node.properties?.href;
    if (typeof href === "string") {
      const internal = normalizeInternal(href);
      if (internal !== null) node.properties = { ...node.properties, href: internal };
      else decorateSignup(node, href);
    }
  }
  node.children?.forEach(walk);
}

/**
 * Rewrites links inside guide Markdown at build time so authors can write natural
 * URLs without breaking trailing-slash canonicals or the signup attribution flow.
 */
export default function rehypeSiteLinks() {
  return (tree: HastNode) => walk(tree);
}
