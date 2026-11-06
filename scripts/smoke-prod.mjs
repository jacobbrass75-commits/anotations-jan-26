#!/usr/bin/env node
import "dotenv/config";

const appBaseUrl = trimSlash(process.env.APP_BASE_URL || "http://127.0.0.1:5001");
const mcpBaseUrl = trimSlash(process.env.MCP_BASE_URL || "http://127.0.0.1:5002");
const skipApp = process.env.SKIP_APP_SMOKE === "1";
const skipBilling = process.env.SKIP_BILLING_SMOKE === "1";
const skipMcp = process.env.SKIP_MCP_SMOKE === "1";
const skipStaticRouteSmoke = process.env.SKIP_STATIC_ROUTE_SMOKE === "1";
const skipHtmlCachePolicy = process.env.SKIP_HTML_CACHE_POLICY_SMOKE === "1";
const marketingSiteEnabled =
  process.env.SCHOLARMARK_MARKETING_SITE?.trim().toLowerCase() === "astro";
const chromeExtensionId = (process.env.CHROME_EXTENSION_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .find(Boolean);
const extensionCorsEnabled = process.env.EXTENSION_CORS_MODE !== "disabled";

function trimSlash(value) {
  return value.replace(/\/+$/, "");
}

async function request(path, options = {}) {
  const baseUrl = options.baseUrl || appBaseUrl;
  const method = options.method || "GET";
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: AbortSignal.timeout(Number(process.env.SMOKE_TIMEOUT_MS || 10_000)),
    });
  } catch (error) {
    const cause = error?.cause ? ` (cause: ${error.cause.code || error.cause.message || error.cause})` : "";
    throw new Error(
      `${options.label ? `${options.label}: ` : ""}${method} ${baseUrl}${path} failed: ${error?.message || error}${cause}`,
      { cause: error },
    );
  }
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { response, text, json };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function expectStatus(label, path, expected, options = {}) {
  const result = await request(path, { ...options, label });
  assert(
    result.response.status === expected,
    `${label} expected ${expected}, got ${result.response.status}: ${result.text.slice(0, 300)}`,
  );
  console.log(`[smoke] ${label}: ${result.response.status}`);
  return result;
}

// Defaults to the local app with marketing-host forwarding headers so deploys can
// verify before traffic; MARKETING_BASE_URL=https://scholarmark.ai checks through the proxy.
async function runMarketingSiteSmoke() {
  const marketingBaseUrl = process.env.MARKETING_BASE_URL
    ? trimSlash(process.env.MARKETING_BASE_URL)
    : null;
  const marketingHost = {
    baseUrl: marketingBaseUrl || appBaseUrl,
    headers: marketingBaseUrl
      ? {}
      : { "x-forwarded-host": "scholarmark.ai", "x-forwarded-proto": "https" },
  };

  const root = await expectStatus("marketing root", "/", 200, marketingHost);
  assert(
    root.response.headers.get("x-scholarmark-surface") === "marketing",
    "marketing host root is not served by the Astro build",
  );
  assert(
    root.response.headers.get("cache-control")?.includes("no-store"),
    "marketing root HTML must not be cached",
  );

  const campaign = await expectStatus(
    "marketing paid Instagram landing",
    "/?utm_source=ig&utm_medium=paid&utm_campaign=smoke",
    200,
    marketingHost,
  );
  assert(
    campaign.text.includes('<div id="root">'),
    "paid Instagram root must stay on the SPA landing",
  );

  for (const path of ["/blog", "/pricing"]) {
    const page = await expectStatus(`marketing host SPA ${path}`, path, 200, marketingHost);
    assert(page.text.includes('<div id="root">'), `${path} must stay on the SPA`);
  }

  const robots = await expectStatus("marketing robots.txt", "/robots.txt", 200, marketingHost);
  assert(
    robots.text.includes("Sitemap: https://scholarmark.ai/sitemap.xml"),
    "robots.txt is missing the canonical sitemap",
  );
  const sitemap = await expectStatus("marketing sitemap.xml", "/sitemap.xml", 200, marketingHost);
  assert(
    sitemap.text.includes("<loc>https://scholarmark.ai/blog</loc>"),
    "sitemap.xml lost the legacy blog index",
  );
  assert(
    sitemap.text.includes("<loc>https://scholarmark.ai/guides/"),
    "sitemap.xml does not list the Astro guides (was SITE_RELEASE_ENV=production at build?)",
  );
  const guides = await expectStatus("marketing guides index", "/guides/", 200, marketingHost);
  assert(
    guides.text.includes('<link rel="canonical" href="https://scholarmark.ai/guides/"'),
    "guides index is missing its production canonical URL",
  );

  await expectStatus(
    "marketing missing hashed asset",
    "/_astro/smoke-missing.js",
    404,
    marketingHost,
  );
}

async function runAppSmoke() {
  const health = await expectStatus("app health", "/healthz", 200);
  assert(health.json?.ok === true, "app /healthz did not return ok=true");

  const ready = await expectStatus("app readiness", "/readyz", 200);
  assert(ready.json?.database === "ok", "app /readyz did not report database ok");

  const root = await expectStatus("app root static", "/", 200);
  assert(
    root.response.headers.get("content-type")?.includes("text/html"),
    "root did not return HTML",
  );
  assert(root.text.includes('<div id="root">'), "root HTML is missing React mount point");
  assert(root.text.includes("Get ahead on your thesis"), "root HTML is missing resilient content");
  if (!skipHtmlCachePolicy) {
    assert(
      root.response.headers.get("cache-control")?.includes("no-store"),
      "root HTML must not be cached across asset deployments",
    );
  }
  assert(
    root.text.includes("__scholarmarkRecoverStaleAssets"),
    "root HTML is missing one-shot stale-asset recovery",
  );
  assert(
    root.text.includes("accounts.scholarmark.ai"),
    "root HTML is missing the embedded-auth hosted fallback",
  );

  const staticFallback = await expectStatus("app static fallback", "/pricing", 200);
  assert(
    staticFallback.text.includes('<div id="root">'),
    "static fallback is missing React mount point",
  );

  if (!skipStaticRouteSmoke) {
    for (const path of ["/start", "/summer", "/sign-in", "/sign-up", "/summer/onboarding"]) {
      const page = await expectStatus(`app static fallback ${path}`, path, 200);
      assert(page.text.includes('<div id="root">'), `${path} is missing React mount point`);
      if (!skipHtmlCachePolicy) {
        assert(
          page.response.headers.get("cache-control")?.includes("no-store"),
          `${path} HTML must not be cached across asset deployments`,
        );
      }
    }
  } else {
    console.log("[smoke] static route fallback checks skipped");
  }

  if (marketingSiteEnabled) {
    await runMarketingSiteSmoke();
  } else {
    console.log("[smoke] Astro marketing site disabled; SPA root checks only");
  }

  const protectedApi = await expectStatus("auth-required API", "/api/auth/me", 401);
  assert(protectedApi.json?.message, "auth-required API did not return a JSON error");

  const protectedWriting = await expectStatus(
    "auth-required writing API",
    "/api/write/history",
    401,
  );
  assert(protectedWriting.json?.message, "writing API did not return a JSON auth error");

  // Non-Claude model tests are retired: the gate answers before auth, so even
  // unauthenticated probes must get its JSON 404 rather than a 401 or a model list.
  // The POST route is covered by the writing routes integration suite.
  const retired = await expectStatus(
    "retired writing model tests GET",
    "/api/write/test-models",
    404,
  );
  assert(
    retired.json?.message === "Not found",
    "retired writing model tests GET did not return the gate's JSON 404",
  );

  const invalidCampaignSignup = await expectStatus(
    "campaign signup validation",
    "/api/campaign/signup",
    400,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    },
  );
  assert(
    invalidCampaignSignup.json?.message,
    "campaign signup validation did not return a JSON error",
  );

  if (!skipBilling) {
    const stripeConfig = await expectStatus(
      "Stripe billing config",
      "/api/billing/stripe/config",
      200,
    );
    assert(stripeConfig.json?.enabled === true, "Stripe billing config is not enabled");
    assert(stripeConfig.json?.currency === "USD", "Stripe billing config did not report USD");
    assert(
      stripeConfig.json?.plans?.pro?.amountCents === 500,
      "Stripe Pro price did not report 500 cents",
    );
    assert(
      stripeConfig.json?.plans?.pro?.lookupKey === "scholarmark_pro_monthly_usd5",
      "Stripe Pro checkout is not using the USD 5 lookup key",
    );
    assert(
      stripeConfig.json?.plans?.max?.amountCents === 1400,
      "Stripe Premium price did not report 1400 cents",
    );
    assert(
      stripeConfig.json?.plans?.max?.label === "Premium",
      "Stripe max plan is not labeled Premium",
    );
    assert(
      stripeConfig.json?.plans?.max?.lookupKey === "scholarmark_max_monthly_usd14",
      "Stripe Premium checkout is not using the USD 14 lookup key",
    );
  } else {
    console.log("[smoke] Stripe billing config check skipped");
  }

  if (chromeExtensionId && extensionCorsEnabled) {
    const extensionOrigin = `chrome-extension://${chromeExtensionId}`;
    const extensionCors = await expectStatus(
      "extension CORS auth-required API",
      "/api/auth/me",
      401,
      {
        headers: { origin: extensionOrigin },
      },
    );
    assert(
      extensionCors.response.headers.get("access-control-allow-origin") === extensionOrigin,
      "extension CORS response did not allow the configured Chrome extension origin",
    );
  } else if (chromeExtensionId) {
    console.log("[smoke] extension CORS check skipped because EXTENSION_CORS_MODE=disabled");
  }
}

async function runMcpSmoke() {
  const health = await expectStatus("MCP health", "/healthz", 200, { baseUrl: mcpBaseUrl });
  assert(health.json?.ok === true, "MCP /healthz did not return ok=true");

  const metadata = await expectStatus(
    "MCP protected-resource metadata",
    "/.well-known/oauth-protected-resource",
    200,
    {
      baseUrl: mcpBaseUrl,
    },
  );
  assert(
    metadata.json?.resource || metadata.json?.authorization_servers,
    "MCP metadata response is missing OAuth metadata",
  );

  const initialize = await expectStatus("MCP initialize probe", "/mcp", 200, {
    baseUrl: mcpBaseUrl,
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "scholarmark-smoke", version: "1.0.0" },
      },
    }),
  });
  assert(initialize.json?.result, "MCP initialize probe did not return a JSON-RPC result");

  const toolsList = await expectStatus("MCP unauthenticated tools/list challenge", "/mcp", 401, {
    baseUrl: mcpBaseUrl,
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  assert(
    toolsList.response.headers.get("www-authenticate")?.toLowerCase().includes("bearer"),
    "MCP tools/list did not return a Bearer challenge",
  );
}

try {
  if (!skipApp) {
    await runAppSmoke();
  } else {
    console.log("[smoke] app checks skipped");
  }
  if (!skipMcp) {
    await runMcpSmoke();
  } else {
    console.log("[smoke] MCP checks skipped");
  }
  console.log("[smoke] production smoke checks passed");
} catch (error) {
  console.error("[smoke] production smoke checks failed");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
