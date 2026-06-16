export type ProductionConfigPhase = "build" | "runtime";

export interface ProductionConfigOptions {
  phase?: ProductionConfigPhase;
}

const DEFAULT_JWT_SECRET =
  "dev-jwt-secret-change-in-production-64chars-long-string-placeholder!!";

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function parseUrl(value: string | undefined): URL | null {
  const rawValue = value?.trim();
  if (!rawValue) return null;

  try {
    return new URL(rawValue);
  } catch {
    return null;
  }
}

function isHttpsUrl(value: string | undefined): boolean {
  const url = parseUrl(value);
  return Boolean(url && url.protocol === "https:");
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isValidChromeExtensionId(value: string): boolean {
  return /^[a-p]{32}$/.test(value);
}

export function getProductionConfigErrors(
  env: NodeJS.ProcessEnv = process.env,
  options: ProductionConfigOptions = {},
): string[] {
  const phase = options.phase ?? "runtime";
  const shouldValidate = phase === "build" || env.NODE_ENV === "production";
  if (!shouldValidate) return [];

  const errors: string[] = [];
  const allowTestClerkKeys = env.CLERK_ALLOW_TEST_KEYS_IN_PRODUCTION === "true";
  const clerkPublishableKey =
    env.VITE_CLERK_PUBLISHABLE_KEY || env.CLERK_PUBLISHABLE_KEY || "";
  const clerkSecretKey = env.CLERK_SECRET_KEY || "";
  const extensionCorsMode = env.EXTENSION_CORS_MODE?.trim() || "enabled";

  if (env.LOCAL_DEV_AUTH === "true" || env.VITE_LOCAL_DEV_AUTH === "true") {
    errors.push(
      "LOCAL_DEV_AUTH and VITE_LOCAL_DEV_AUTH must be disabled in production.",
    );
  }

  if (!allowTestClerkKeys && !clerkPublishableKey.startsWith("pk_live_")) {
    errors.push(
      "Production requires a Clerk publishable key prefixed with pk_live_.",
    );
  }

  if (phase === "build") {
    return errors;
  }

  if (!allowTestClerkKeys && !clerkSecretKey.startsWith("sk_live_")) {
    errors.push(
      "Production requires a Clerk secret key prefixed with sk_live_.",
    );
  }

  const jwtSecret = env.JWT_SECRET?.trim() ?? "";
  if (
    !hasValue(jwtSecret) ||
    jwtSecret === DEFAULT_JWT_SECRET ||
    jwtSecret.length < 32
  ) {
    errors.push(
      "JWT_SECRET must be set to a unique production secret with at least 32 characters.",
    );
  }

  const appBaseUrl = env.APP_BASE_URL || env.PUBLIC_BASE_URL;
  if (!isHttpsUrl(appBaseUrl)) {
    errors.push(
      "APP_BASE_URL or PUBLIC_BASE_URL must be set to the public HTTPS app URL.",
    );
  }

  const allowedOrigins = splitCsv(env.ALLOWED_ORIGINS);
  if (allowedOrigins.length === 0) {
    errors.push(
      "ALLOWED_ORIGINS must list the public HTTPS origins allowed to call the API.",
    );
  }
  if (allowedOrigins.some((origin) => origin === "*" || origin.includes("*"))) {
    errors.push("ALLOWED_ORIGINS must not contain wildcard origins.");
  }
  if (allowedOrigins.some((origin) => !isHttpsUrl(origin))) {
    errors.push("ALLOWED_ORIGINS must contain only HTTPS origins.");
  }

  if (!["enabled", "disabled"].includes(extensionCorsMode)) {
    errors.push(
      "EXTENSION_CORS_MODE must be either enabled or disabled when set.",
    );
  }

  const chromeExtensionIds = splitCsv(env.CHROME_EXTENSION_IDS);
  if (extensionCorsMode !== "disabled" && chromeExtensionIds.length === 0) {
    errors.push(
      "CHROME_EXTENSION_IDS must list the production Chrome extension ID allowed to call the API.",
    );
  }
  if (
    chromeExtensionIds.some(
      (extensionId) => !isValidChromeExtensionId(extensionId),
    )
  ) {
    errors.push(
      "CHROME_EXTENSION_IDS must contain only valid 32-character Chrome extension IDs.",
    );
  }

  const mcpResourceUrl = env.MCP_RESOURCE_URL;
  if (hasValue(mcpResourceUrl) && !isHttpsUrl(mcpResourceUrl)) {
    errors.push("MCP_RESOURCE_URL must be an HTTPS URL when set.");
  }
  if (
    hasValue(mcpResourceUrl) &&
    mcpResourceUrl!.replace(/\/+$/, "").endsWith("/mcp")
  ) {
    errors.push(
      "MCP_RESOURCE_URL should be the MCP origin without a trailing /mcp path.",
    );
  }

  if (!hasValue(env.ANTHROPIC_API_KEY)) {
    errors.push(
      "ANTHROPIC_API_KEY must be set for chat, writing, compile, verify, and fallback humanizer.",
    );
  }
  if (!hasValue(env.OPENAI_API_KEY)) {
    errors.push(
      "OPENAI_API_KEY must be set for embeddings, analysis, summaries, and OCR vision.",
    );
  }
  if (hasValue(env.STRIPE_SECRET_KEY) && !hasValue(env.STRIPE_WEBHOOK_SECRET)) {
    errors.push(
      "STRIPE_WEBHOOK_SECRET must be set when STRIPE_SECRET_KEY is configured.",
    );
  }

  return errors;
}

export function assertProductionConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: ProductionConfigOptions = {},
): void {
  const errors = getProductionConfigErrors(env, options);
  if (errors.length === 0) return;

  throw new Error(
    `Invalid production configuration:\n- ${errors.join("\n- ")}`,
  );
}
