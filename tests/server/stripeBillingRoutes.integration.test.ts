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

const { stripeClient, StripeMock } = vi.hoisted(() => {
  const stripeClient = {
    customers: {
      create: vi.fn(async () => ({ id: "cus_new" })),
    },
    prices: {
      retrieve: vi.fn(),
      list: vi.fn(),
    },
    checkout: {
      sessions: {
        create: vi.fn(async () => ({ url: "https://checkout.stripe.test/session" })),
        retrieve: vi.fn(),
      },
    },
    billingPortal: {
      configurations: {
        list: vi.fn(async () => ({ data: [] })),
      },
      sessions: {
        create: vi.fn(async () => ({ url: "https://billing.stripe.test/session" })),
      },
    },
    subscriptions: {
      retrieve: vi.fn(),
    },
    webhooks: {
      constructEvent: vi.fn(),
    },
  };
  return {
    stripeClient,
    StripeMock: vi.fn(function StripeConstructor() {
      return stripeClient;
    }),
  };
});

vi.mock("@clerk/express", () => ({
  clerkMiddleware,
  getAuth: clerkGetAuth,
  clerkClient: {
    users: {
      getUser: clerkGetUser,
    },
  },
}));

vi.mock("stripe", () => ({
  default: StripeMock,
}));

function monthlyPrice(overrides: Record<string, unknown> = {}) {
  return {
    id: "price_pro",
    active: true,
    currency: "usd",
    unit_amount: 1400,
    lookup_key: "scholarmark_pro_monthly",
    recurring: { interval: "month", interval_count: 1 },
    ...overrides,
  };
}

function monthlySubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_new",
    customer: "cus_existing",
    status: "active",
    metadata: { userId: "stripe-user" },
    cancel_at_period_end: false,
    current_period_end: 1_782_000_000,
    items: {
      data: [
        {
          price: monthlyPrice(),
        },
      ],
    },
    ...overrides,
  };
}

describe("Stripe billing routes", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();
  const originalStripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const originalStripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const originalAppBaseUrl = process.env.APP_BASE_URL;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-stripe-routes-"));
    vi.resetModules();
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_unit";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_unit";
    process.env.APP_BASE_URL = "https://app.scholarmark.ai";
    process.chdir(tempDir);
    await bootstrapTempWorkspace(tempDir);
  });

  afterEach(async () => {
    sqlite?.close();
    sqlite = null;
    if (originalStripeSecretKey === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = originalStripeSecretKey;
    }
    if (originalStripeWebhookSecret === undefined) {
      delete process.env.STRIPE_WEBHOOK_SECRET;
    } else {
      process.env.STRIPE_WEBHOOK_SECRET = originalStripeWebhookSecret;
    }
    if (originalAppBaseUrl === undefined) {
      delete process.env.APP_BASE_URL;
    } else {
      process.env.APP_BASE_URL = originalAppBaseUrl;
    }
    process.chdir(originalCwd);
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createStripeApp(
    options: {
      subscriptionStatus?: string | null;
      stripeSubscriptionId?: string | null;
    } = {},
  ) {
    const { db, sqlite: importedSqlite } = await import("../../server/db");
    const { users } = await import("../../shared/schema");
    const { generateToken } = await import("../../server/auth");
    const { registerStripeBillingRoutes } = await import("../../server/stripeBillingRoutes");

    sqlite = importedSqlite;
    const now = new Date("2026-06-01T00:00:00.000Z");
    await db.insert(users).values({
      id: "stripe-user",
      email: "stripe@example.com",
      username: "stripe@example.com",
      password: "",
      tier: "free",
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: options.stripeSubscriptionId ?? null,
      subscriptionStatus: options.subscriptionStatus ?? null,
      createdAt: now,
      updatedAt: now,
    } as any);

    const app = express();
    app.use(express.json());
    registerStripeBillingRoutes(app);

    return {
      server: await startHttpServer(app),
      token: generateToken({ id: "stripe-user", email: "stripe@example.com", tier: "free" }),
    };
  }

  it("does not create a second checkout session for an active Stripe subscriber", async () => {
    const { server, token } = await createStripeApp({
      stripeSubscriptionId: "sub_active",
      subscriptionStatus: "active",
    });

    try {
      const response = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/billing/stripe/checkout",
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: { tier: "pro" },
        },
      );

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        code: "active_subscription_exists",
        action: "billing_portal",
      });
      expect(stripeClient.checkout.sessions.create).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("rejects misconfigured Stripe prices before creating checkout", async () => {
    stripeClient.prices.list.mockResolvedValueOnce({
      data: [monthlyPrice({ unit_amount: 9900 })],
    });
    const { server, token } = await createStripeApp();

    try {
      const response = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/billing/stripe/checkout",
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: { tier: "pro" },
        },
      );

      expect(response.status).toBe(502);
      expect(stripeClient.checkout.sessions.create).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("creates checkout only when the resolved Stripe price matches the plan", async () => {
    stripeClient.prices.list.mockResolvedValueOnce({ data: [monthlyPrice()] });
    const { server, token } = await createStripeApp();

    try {
      const response = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/billing/stripe/checkout",
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: { tier: "pro" },
        },
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ url: "https://checkout.stripe.test/session" });
      expect(stripeClient.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "subscription",
          customer: "cus_existing",
          line_items: [{ price: "price_pro", quantity: 1 }],
          success_url:
            "https://app.scholarmark.ai/account?checkout=success&session_id={CHECKOUT_SESSION_ID}",
          cancel_url: "https://app.scholarmark.ai/pricing?checkout=cancelled",
        }),
      );
    } finally {
      await server.close();
    }
  });

  it("confirms a completed checkout session and upgrades the local user", async () => {
    const subscription = monthlySubscription();
    stripeClient.checkout.sessions.retrieve.mockResolvedValueOnce({
      id: "cs_complete",
      mode: "subscription",
      status: "complete",
      customer: "cus_existing",
      client_reference_id: "stripe-user",
      metadata: { userId: "stripe-user" },
      subscription,
    });
    const { server, token } = await createStripeApp();

    try {
      const response = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/billing/stripe/checkout/confirm",
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: { sessionId: "cs_complete" },
        },
      );
      const { getUserById } = await import("../../server/authStorage");
      const user = await getUserById("stripe-user");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        confirmed: true,
        tier: "pro",
        subscriptionStatus: "active",
      });
      expect(user?.tier).toBe("pro");
      expect(user?.stripeSubscriptionId).toBe("sub_new");
      expect(user?.stripePriceId).toBe("price_pro");
      expect(user?.tokensUsed).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("rejects checkout confirmation for another account", async () => {
    stripeClient.checkout.sessions.retrieve.mockResolvedValueOnce({
      id: "cs_other",
      mode: "subscription",
      status: "complete",
      customer: "cus_existing",
      client_reference_id: "other-user",
      metadata: { userId: "other-user" },
      subscription: monthlySubscription(),
    });
    const { server, token } = await createStripeApp();

    try {
      const response = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/billing/stripe/checkout/confirm",
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: { sessionId: "cs_other" },
        },
      );

      expect(response.status).toBe(403);
    } finally {
      await server.close();
    }
  });
});
