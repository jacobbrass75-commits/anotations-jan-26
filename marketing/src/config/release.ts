/**
 * Build-time release settings. Everything here is read from the build host's
 * environment (CI or static-host settings), not from .env files, so a release
 * can only become indexable when the host states it explicitly.
 */

export type ReleaseEnv = "production" | "staging" | "preview" | "development";

const RELEASE_ENVS: readonly ReleaseEnv[] = ["production", "staging", "preview", "development"];

/** Public origin for the marketing site. Canonical URLs always use this host. */
export const SITE_ORIGIN = "https://scholarmark.ai";

/** Live application origin. Signup, sign-in, pricing and legal pages live here. */
export const APP_ORIGIN = "https://app.scholarmark.ai";

export const SUPPORT_EMAIL = "support@scholarmark.ai";

function readEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

/**
 * Hosts that announce a preview build are never treated as production, even if
 * SITE_RELEASE_ENV=production was copied into their settings by mistake.
 */
function hostReportsPreview(): boolean {
  const vercel = readEnv("VERCEL_ENV");
  const netlify = readEnv("CONTEXT");
  return (
    vercel === "preview" ||
    vercel === "development" ||
    netlify === "deploy-preview" ||
    netlify === "branch-deploy"
  );
}

export function resolveReleaseEnv(): ReleaseEnv {
  const requested = readEnv("SITE_RELEASE_ENV").toLowerCase();
  const env = RELEASE_ENVS.includes(requested as ReleaseEnv)
    ? (requested as ReleaseEnv)
    : "development";
  if (requested && env !== requested) {
    throw new Error(
      `SITE_RELEASE_ENV must be one of ${RELEASE_ENVS.join(", ")}; received "${requested}".`,
    );
  }
  if (env === "production" && hostReportsPreview()) return "preview";
  return env;
}

export const releaseEnv: ReleaseEnv = resolveReleaseEnv();

/** Only an explicit production release may be crawled and indexed. */
export const indexable = releaseEnv === "production";

/**
 * The $5 Pro price is announced only once checkout charges it. Until then the
 * site links to the live app pricing page without quoting an amount.
 */
export const proPriceLive = readEnv("PUBLIC_PRO_PRICE_LIVE") === "true";

export const PRO_PRICE_LABEL = "$5/month";

/**
 * Optional override used only by the verification fixtures. Fixture builds also
 * get their own content cache so fixture guides never reach a real build.
 */
export const guidesFixtureDir = readEnv("GUIDES_CONTENT_DIR");
export const guidesContentDir = guidesFixtureDir || "./src/content/guides";
