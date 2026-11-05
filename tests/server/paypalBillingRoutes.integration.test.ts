import express from "express";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapTempWorkspace } from "./helpers/bootstrapTempWorkspace";
import { requestJson, startHttpServer } from "./helpers/http";

const { clerkGetAuth, clerkMiddleware, clerkGetUser } = vi.hoisted(() => ({
  clerkGetAuth: vi.fn(() => ({ userId: null })),
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  clerkGetUser: vi.fn(),
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware,
  getAuth: clerkGetAuth,
  clerkClient: {
    users: {
      getUser: clerkGetUser,
    },
  },
}));

const PAYPAL_ENV_KEYS = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_ENV"] as const;

describe("PayPal billing routes", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  const originalEnv = Object.fromEntries(PAYPAL_ENV_KEYS.map((key) => [key, process.env[key]]));

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-paypal-routes-"));
    vi.resetModules();
    vi.clearAllMocks();
    process.env.PAYPAL_CLIENT_ID = "paypal_client_unit";
    process.env.PAYPAL_CLIENT_SECRET = "paypal_secret_unit";
    process.env.PAYPAL_ENV = "sandbox";
    process.chdir(tempDir);
    await bootstrapTempWorkspace(tempDir);
  });

  afterEach(async () => {
    sqlite?.close();
    sqlite = null;
    globalThis.fetch = originalFetch;
    for (const key of PAYPAL_ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    process.chdir(originalCwd);
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createPayPalApp() {
    const { db, sqlite: importedSqlite } = await import("../../server/db");
    const { users } = await import("../../shared/schema");
    const { generateToken } = await import("../../server/auth");
    const { registerPayPalBillingRoutes } = await import("../../server/paypalBillingRoutes");

    sqlite = importedSqlite;
    const now = new Date("2026-06-01T00:00:00.000Z");
    await db.insert(users).values({
      id: "paypal-user",
      email: "paypal@example.com",
      username: "paypal@example.com",
      password: "",
      tier: "free",
      createdAt: now,
      updatedAt: now,
    } as any);

    const app = express();
    app.use(express.json());
    registerPayPalBillingRoutes(app);

    return {
      server: await startHttpServer(app),
      token: generateToken({ id: "paypal-user", email: "paypal@example.com", tier: "free" }),
      sqlite: importedSqlite,
    };
  }

  it("reports USD 5 Pro and USD 50 Max in the PayPal config", async () => {
    const { server } = await createPayPalApp();

    try {
      const response = await requestJson<Record<string, any>>(
        server.baseUrl,
        "/api/billing/paypal/config",
      );

      expect(response.status).toBe(200);
      expect(response.body?.plans).toEqual({
        pro: { label: "Pro", amount: "5.00", amountCents: 500 },
        max: { label: "Max", amount: "50.00", amountCents: 5000 },
      });
    } finally {
      await server.close();
    }
  });

  it("creates Pro orders for exactly USD 5.00 and records 500 cents", async () => {
    const { server, token, sqlite: db } = await createPayPalApp();
    const paypalRequests: Array<{ url: string; body: string | undefined }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith("https://api-m.sandbox.paypal.com")) {
        return originalFetch(input, init);
      }
      paypalRequests.push({ url, body: init?.body as string | undefined });
      if (url.endsWith("/v1/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "paypal_token" }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "ORDER-PRO-5", status: "CREATED" }), {
        status: 201,
      });
    }) as typeof fetch;

    try {
      const response = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/billing/paypal/orders",
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: { tier: "pro" },
        },
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ orderId: "ORDER-PRO-5" });
      const orderRequest = paypalRequests.find((request) =>
        request.url.endsWith("/v2/checkout/orders"),
      );
      expect(JSON.parse(orderRequest?.body ?? "{}").purchase_units[0].amount).toEqual({
        currency_code: "USD",
        value: "5.00",
      });
      const row = db
        .prepare(
          "SELECT tier, amount_cents, currency FROM billing_payments WHERE provider_order_id = ?",
        )
        .get("ORDER-PRO-5");
      expect(row).toEqual({ tier: "pro", amount_cents: 500, currency: "USD" });
    } finally {
      await server.close();
    }
  });
});
