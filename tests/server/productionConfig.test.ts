import { describe, expect, it } from "vitest";
import { getProductionConfigErrors } from "../../server/productionConfig";

describe("production config validation", () => {
  const paidLaunchEnv = {
    STRIPE_SECRET_KEY: "sk_live_example",
    STRIPE_WEBHOOK_SECRET: "whsec_example",
    ADMIN_USER_IDS: "admin-user",
  };

  it("does not run runtime checks outside production", () => {
    expect(getProductionConfigErrors({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toEqual([]);
  });

  it("fails closed on missing production secrets and unsafe defaults", () => {
    const errors = getProductionConfigErrors({
      NODE_ENV: "production",
      LOCAL_DEV_AUTH: "true",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_test_example",
      CLERK_SECRET_KEY: "sk_test_example",
      JWT_SECRET: "dev-jwt-secret-change-in-production-64chars-long-string-placeholder!!",
      APP_BASE_URL: "http://app.scholarmark.ai",
      ALLOWED_ORIGINS: "*,http://app.scholarmark.ai",
      MCP_RESOURCE_URL: "https://mcp.scholarmark.ai/mcp",
    } as NodeJS.ProcessEnv);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("LOCAL_DEV_AUTH"),
        expect.stringContaining("pk_live_"),
        expect.stringContaining("sk_live_"),
        expect.stringContaining("JWT_SECRET"),
        expect.stringContaining("public HTTPS app URL"),
        expect.stringContaining("wildcard"),
        expect.stringContaining("only HTTPS origins"),
        expect.stringContaining("CHROME_EXTENSION_IDS"),
        expect.stringContaining("without a trailing /mcp"),
        expect.stringContaining("ANTHROPIC_API_KEY"),
        expect.stringContaining("OPENAI_API_KEY"),
        expect.stringContaining("STRIPE_SECRET_KEY"),
        expect.stringContaining("STRIPE_WEBHOOK_SECRET"),
        expect.stringContaining("ADMIN_USER_IDS"),
      ]),
    );
  });

  it("does not require runtime-only secrets during production build validation", () => {
    const errors = getProductionConfigErrors(
      {
        NODE_ENV: "production",
        VITE_CLERK_PUBLISHABLE_KEY: "pk_live_example",
      } as NodeJS.ProcessEnv,
      { phase: "build" },
    );

    expect(errors).toEqual([]);
  });

  it("requires a browser Pixel ID during a Meta-enabled production build", () => {
    const errors = getProductionConfigErrors(
      {
        NODE_ENV: "production",
        VITE_CLERK_PUBLISHABLE_KEY: "pk_live_example",
        META_TRACKING_ENABLED: "true",
        VITE_META_TRACKING_ENABLED: "true",
      } as NodeJS.ProcessEnv,
      { phase: "build" },
    );

    expect(errors).toContain(
      "VITE_META_PIXEL_ID must be a numeric Meta Pixel ID when Meta tracking is enabled.",
    );
  });

  it("rejects a browser-only Meta tracking rollout", () => {
    const errors = getProductionConfigErrors(
      {
        NODE_ENV: "production",
        VITE_CLERK_PUBLISHABLE_KEY: "pk_live_example",
        VITE_META_TRACKING_ENABLED: "true",
        VITE_META_PIXEL_ID: "1234567890",
      } as NodeJS.ProcessEnv,
      { phase: "build" },
    );

    expect(errors).toContain(
      "VITE_META_TRACKING_ENABLED must be false unless META_TRACKING_ENABLED is true.",
    );
  });

  it("rejects the trimmed default JWT secret in production", () => {
    const errors = getProductionConfigErrors({
      NODE_ENV: "production",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_live_example",
      CLERK_SECRET_KEY: "sk_live_example",
      JWT_SECRET: " dev-jwt-secret-change-in-production-64chars-long-string-placeholder!! ",
      APP_BASE_URL: "https://app.scholarmark.ai",
      ALLOWED_ORIGINS: "https://app.scholarmark.ai",
      CHROME_EXTENSION_IDS: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      MCP_RESOURCE_URL: "https://mcp.scholarmark.ai",
      ANTHROPIC_API_KEY: "anthropic-key",
      OPENAI_API_KEY: "openai-key",
      ...paidLaunchEnv,
    } as NodeJS.ProcessEnv);

    expect(errors).toEqual([
      "JWT_SECRET must be set to a unique production secret with at least 32 characters.",
    ]);
  });

  it("rejects malformed Chrome extension IDs in production", () => {
    const errors = getProductionConfigErrors({
      NODE_ENV: "production",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_live_example",
      CLERK_SECRET_KEY: "sk_live_example",
      JWT_SECRET: "a-very-long-production-secret-that-is-unique",
      APP_BASE_URL: "https://app.scholarmark.ai",
      ALLOWED_ORIGINS: "https://app.scholarmark.ai",
      CHROME_EXTENSION_IDS: "not-a-real-extension-id",
      MCP_RESOURCE_URL: "https://mcp.scholarmark.ai",
      ANTHROPIC_API_KEY: "anthropic-key",
      OPENAI_API_KEY: "openai-key",
      ...paidLaunchEnv,
    } as NodeJS.ProcessEnv);

    expect(errors).toEqual([
      "CHROME_EXTENSION_IDS must contain only valid 32-character Chrome extension IDs.",
    ]);
  });

  it("allows Chrome extension CORS to be explicitly disabled before the store ID exists", () => {
    const errors = getProductionConfigErrors({
      NODE_ENV: "production",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_live_example",
      CLERK_SECRET_KEY: "sk_live_example",
      JWT_SECRET: "a-very-long-production-secret-that-is-unique",
      APP_BASE_URL: "https://app.scholarmark.ai",
      ALLOWED_ORIGINS: "https://app.scholarmark.ai",
      EXTENSION_CORS_MODE: "disabled",
      MCP_RESOURCE_URL: "https://mcp.scholarmark.ai",
      ANTHROPIC_API_KEY: "anthropic-key",
      OPENAI_API_KEY: "openai-key",
      ...paidLaunchEnv,
    } as NodeJS.ProcessEnv);

    expect(errors).toEqual([]);
  });

  it("rejects unknown Chrome extension CORS modes in production", () => {
    const errors = getProductionConfigErrors({
      NODE_ENV: "production",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_live_example",
      CLERK_SECRET_KEY: "sk_live_example",
      JWT_SECRET: "a-very-long-production-secret-that-is-unique",
      APP_BASE_URL: "https://app.scholarmark.ai",
      ALLOWED_ORIGINS: "https://app.scholarmark.ai",
      EXTENSION_CORS_MODE: "maybe",
      MCP_RESOURCE_URL: "https://mcp.scholarmark.ai",
      ANTHROPIC_API_KEY: "anthropic-key",
      OPENAI_API_KEY: "openai-key",
      ...paidLaunchEnv,
    } as NodeJS.ProcessEnv);

    expect(errors).toEqual(
      expect.arrayContaining([
        "EXTENSION_CORS_MODE must be either enabled or disabled when set.",
        "CHROME_EXTENSION_IDS must list the production Chrome extension ID allowed to call the API.",
      ]),
    );
  });

  it("accepts a complete production runtime configuration", () => {
    const errors = getProductionConfigErrors({
      NODE_ENV: "production",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_live_example",
      CLERK_SECRET_KEY: "sk_live_example",
      JWT_SECRET: "a-very-long-production-secret-that-is-unique",
      APP_BASE_URL: "https://app.scholarmark.ai",
      ALLOWED_ORIGINS: "https://app.scholarmark.ai,https://mcp.scholarmark.ai",
      CHROME_EXTENSION_IDS: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      MCP_RESOURCE_URL: "https://mcp.scholarmark.ai",
      ANTHROPIC_API_KEY: "anthropic-key",
      OPENAI_API_KEY: "openai-key",
      ...paidLaunchEnv,
    } as NodeJS.ProcessEnv);

    expect(errors).toEqual([]);
  });

  it("accepts a complete Meta tracking configuration", () => {
    const errors = getProductionConfigErrors({
      NODE_ENV: "production",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_live_example",
      CLERK_SECRET_KEY: "sk_live_example",
      JWT_SECRET: "a-very-long-production-secret-that-is-unique",
      APP_BASE_URL: "https://app.scholarmark.ai",
      ALLOWED_ORIGINS: "https://app.scholarmark.ai,https://mcp.scholarmark.ai",
      CHROME_EXTENSION_IDS: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      MCP_RESOURCE_URL: "https://mcp.scholarmark.ai",
      ANTHROPIC_API_KEY: "anthropic-key",
      OPENAI_API_KEY: "openai-key",
      META_TRACKING_ENABLED: "true",
      VITE_META_TRACKING_ENABLED: "true",
      VITE_META_PIXEL_ID: "1234567890",
      META_PIXEL_ID: "1234567890",
      META_CONVERSIONS_API_TOKEN: "meta-token",
      META_GRAPH_API_VERSION: "v25.0",
      META_ALLOWED_EVENT_ORIGINS: "https://scholarmark.ai,https://app.scholarmark.ai",
      ...paidLaunchEnv,
    } as NodeJS.ProcessEnv);

    expect(errors).toEqual([]);
  });

  it("rejects test Stripe keys in production", () => {
    const errors = getProductionConfigErrors({
      NODE_ENV: "production",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_live_example",
      CLERK_SECRET_KEY: "sk_live_example",
      JWT_SECRET: "a-very-long-production-secret-that-is-unique",
      APP_BASE_URL: "https://app.scholarmark.ai",
      ALLOWED_ORIGINS: "https://app.scholarmark.ai,https://mcp.scholarmark.ai",
      CHROME_EXTENSION_IDS: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      MCP_RESOURCE_URL: "https://mcp.scholarmark.ai",
      ANTHROPIC_API_KEY: "anthropic-key",
      OPENAI_API_KEY: "openai-key",
      ...paidLaunchEnv,
      STRIPE_SECRET_KEY: "sk_test_not_live",
      STRIPE_WEBHOOK_SECRET: "whsec_test",
    } as NodeJS.ProcessEnv);

    expect(errors).toEqual(["STRIPE_SECRET_KEY must use a live sk_live_ key in production."]);
  });
});
