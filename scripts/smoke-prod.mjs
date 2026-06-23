#!/usr/bin/env node
import "dotenv/config";

const appBaseUrl = trimSlash(process.env.APP_BASE_URL || "http://127.0.0.1:5001");
const mcpBaseUrl = trimSlash(process.env.MCP_BASE_URL || "http://127.0.0.1:5002");
const skipApp = process.env.SKIP_APP_SMOKE === "1";
const skipBilling = process.env.SKIP_BILLING_SMOKE === "1";
const skipMcp = process.env.SKIP_MCP_SMOKE === "1";
const skipStaticRouteSmoke = process.env.SKIP_STATIC_ROUTE_SMOKE === "1";
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
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    signal: AbortSignal.timeout(Number(process.env.SMOKE_TIMEOUT_MS || 10_000)),
  });
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
  const result = await request(path, options);
  assert(
    result.response.status === expected,
    `${label} expected ${expected}, got ${result.response.status}: ${result.text.slice(0, 300)}`,
  );
  console.log(`[smoke] ${label}: ${result.response.status}`);
  return result;
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
  assert(root.text.includes('<div id="root"></div>'), "root HTML is missing React mount point");

  const staticFallback = await expectStatus("app static fallback", "/pricing", 200);
  assert(
    staticFallback.text.includes('<div id="root"></div>'),
    "static fallback is missing React mount point",
  );

  if (!skipStaticRouteSmoke) {
    for (const path of ["/summer", "/sign-in", "/sign-up", "/summer/onboarding"]) {
      const page = await expectStatus(`app static fallback ${path}`, path, 200);
      assert(
        page.text.includes('<div id="root"></div>'),
        `${path} is missing React mount point`,
      );
    }
  } else {
    console.log("[smoke] static route fallback checks skipped");
  }

  const protectedApi = await expectStatus("auth-required API", "/api/auth/me", 401);
  assert(protectedApi.json?.message, "auth-required API did not return a JSON error");

  const protectedModelList = await expectStatus(
    "auth-required writing model tests",
    "/api/write/test-models",
    401,
  );
  assert(
    protectedModelList.json?.message,
    "writing model tests did not return a JSON auth error",
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
      stripeConfig.json?.plans?.pro?.amountCents === 1400,
      "Stripe Pro price did not report 1400 cents",
    );
    assert(
      stripeConfig.json?.plans?.max?.amountCents === 5000,
      "Stripe Max price did not report 5000 cents",
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
