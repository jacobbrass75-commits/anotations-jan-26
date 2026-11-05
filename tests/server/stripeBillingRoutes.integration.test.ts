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
    id: "price_pro_usd5",
    active: true,
    type: "recurring",
    currency: "usd",
    unit_amount: 500,
    lookup_key: "scholarmark_pro_monthly_usd5",
    metadata: {},
    recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
    ...overrides,
  };
}

function legacyProPrice(overrides: Record<string, unknown> = {}) {
  return monthlyPrice({
    id: "price_pro_legacy",
    unit_amount: 1400,
    lookup_key: "scholarmark_pro_monthly",
    product: "prod_pro_legacy",
    ...overrides,
  });
}

function premiumPrice(overrides: Record<string, unknown> = {}) {
  return monthlyPrice({
    id: "price_premium_usd14",
    unit_amount: 1400,
    lookup_key: "scholarmark_max_monthly_usd14",
    product: "prod_premium",
    ...overrides,
  });
}

function legacyMaxPrice(overrides: Record<string, unknown> = {}) {
  return monthlyPrice({
    id: "price_max_usd50",
    unit_amount: 5000,
    lookup_key: "scholarmark_max_monthly",
    product: "prod_max_legacy",
    ...overrides,
  });
}

const BILLING_ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "APP_BASE_URL",
  "STRIPE_PRO_PRICE_ID",
  "STRIPE_MAX_PRICE_ID",
  "STRIPE_PRO_LEGACY_PRICE_IDS",
  "STRIPE_MAX_LEGACY_PRICE_IDS",
  "STRIPE_PRO_PRODUCT_IDS",
  "STRIPE_MAX_PRODUCT_IDS",
] as const;

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
  const originalEnv = Object.fromEntries(BILLING_ENV_KEYS.map((key) => [key, process.env[key]]));

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-stripe-routes-"));
    vi.resetModules();
    vi.clearAllMocks();
    for (const key of BILLING_ENV_KEYS) {
      delete process.env[key];
    }
    process.env.STRIPE_SECRET_KEY = "sk_test_unit";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_unit";
    process.env.APP_BASE_URL = "https://app.scholarmark.ai";
    process.chdir(tempDir);
    await bootstrapTempWorkspace(tempDir);
  });

  afterEach(async () => {
    sqlite?.close();
    sqlite = null;
    for (const key of BILLING_ENV_KEYS) {
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

  async function createStripeApp(
    options: {
      tier?: string;
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
      tier: options.tier ?? "free",
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: options.stripeSubscriptionId ?? null,
      subscriptionStatus: options.subscriptionStatus ?? null,
      createdAt: now,
      updatedAt: now,
    } as any);

    const app = express();
    app.use(
      express.json({
        verify: (req, _res, buf) => {
          (req as unknown as { rawBody: Buffer }).rawBody = buf;
        },
      }),
    );
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
      expect(stripeClient.prices.list).toHaveBeenCalledWith(
        expect.objectContaining({
          active: true,
          lookup_keys: ["scholarmark_pro_monthly_usd5"],
        }),
      );
      expect(stripeClient.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "subscription",
          payment_method_collection: "always",
          customer: "cus_existing",
          line_items: [{ price: "price_pro_usd5", quantity: 1 }],
          allow_promotion_codes: true,
          adaptive_pricing: { enabled: false },
          metadata: expect.objectContaining({
            billingOffer: "paid_first_month",
            priceOffer: "pro_usd5_monthly",
            tier: "pro",
          }),
          subscription_data: expect.objectContaining({
            metadata: expect.objectContaining({
              billingOffer: "paid_first_month",
              priceOffer: "pro_usd5_monthly",
              tier: "pro",
            }),
          }),
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
      expect(user?.stripePriceId).toBe("price_pro_usd5");
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

  async function postCheckout(baseUrl: string, token: string, tier: "pro" | "max" = "pro") {
    return requestJson<Record<string, unknown>>(baseUrl, "/api/billing/stripe/checkout", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: { tier },
    });
  }

  it("advertises USD 5 Pro and USD 14 Premium in the public billing config", async () => {
    const { server } = await createStripeApp();

    try {
      const response = await requestJson<Record<string, any>>(
        server.baseUrl,
        "/api/billing/stripe/config",
      );

      expect(response.status).toBe(200);
      expect(response.body?.plans).toEqual({
        pro: {
          label: "Pro",
          amountCents: 500,
          currency: "usd",
          lookupKey: "scholarmark_pro_monthly_usd5",
        },
        max: {
          label: "Premium",
          amountCents: 1400,
          currency: "usd",
          lookupKey: "scholarmark_max_monthly_usd14",
        },
      });
    } finally {
      await server.close();
    }
  });

  it("fails closed when STRIPE_PRO_PRICE_ID still points at the legacy USD 14 price", async () => {
    process.env.STRIPE_PRO_PRICE_ID = "price_pro_legacy";
    stripeClient.prices.retrieve.mockResolvedValueOnce(legacyProPrice());
    const { server, token } = await createStripeApp();

    try {
      const response = await postCheckout(server.baseUrl, token);

      expect(response.status).toBe(502);
      expect(stripeClient.prices.retrieve).toHaveBeenCalledWith(
        "price_pro_legacy",
        expect.anything(),
      );
      expect(stripeClient.prices.list).not.toHaveBeenCalled();
      expect(stripeClient.checkout.sessions.create).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("uses a pinned STRIPE_PRO_PRICE_ID when it matches USD 5 monthly", async () => {
    process.env.STRIPE_PRO_PRICE_ID = "price_pro_pinned";
    stripeClient.prices.retrieve.mockResolvedValueOnce(
      monthlyPrice({ id: "price_pro_pinned", lookup_key: null }),
    );
    const { server, token } = await createStripeApp();

    try {
      const response = await postCheckout(server.baseUrl, token);

      expect(response.status).toBe(200);
      expect(stripeClient.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: [{ price: "price_pro_pinned", quantity: 1 }],
        }),
      );
    } finally {
      await server.close();
    }
  });

  it.each([
    ["the legacy USD 14 amount", { unit_amount: 1400 }],
    ["a non-USD currency", { currency: "eur" }],
    ["a yearly interval", { recurring: { interval: "year", interval_count: 1 } }],
    ["a multi-month interval", { recurring: { interval: "month", interval_count: 3 } }],
    [
      "metered usage",
      { recurring: { interval: "month", interval_count: 1, usage_type: "metered" } },
    ],
    ["a one-time price", { type: "one_time", recurring: null }],
    ["an archived price", { active: false }],
    ["tiered pricing", { unit_amount: null }],
    [
      "a tiered billing scheme",
      { billing_scheme: "tiered", tiers_mode: "graduated", tiers: [{ up_to: null, unit_amount: 500 }] },
    ],
    ["a customer-chosen amount", { custom_unit_amount: { minimum: 100, maximum: null, preset: 500 } }],
    ["a quantity transform", { transform_quantity: { divide_by: 2, round: "up" } }],
    [
      "non-USD currency options",
      { currency_options: { usd: { unit_amount: 500 }, eur: { unit_amount: 500 } } },
    ],
  ])("fails closed when the Stripe Pro price has %s", async (_label, overrides) => {
    stripeClient.prices.list.mockResolvedValueOnce({ data: [monthlyPrice(overrides)] });
    const { server, token } = await createStripeApp();

    try {
      const response = await postCheckout(server.baseUrl, token);

      expect(response.status).toBe(502);
      expect(stripeClient.checkout.sessions.create).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("sells Premium at exact USD 14 with Adaptive Pricing off and promotions kept", async () => {
    stripeClient.prices.list.mockResolvedValueOnce({ data: [premiumPrice()] });
    const { server, token } = await createStripeApp();

    try {
      const response = await postCheckout(server.baseUrl, token, "max");

      expect(response.status).toBe(200);
      expect(stripeClient.prices.list).toHaveBeenCalledWith(
        expect.objectContaining({ active: true, lookup_keys: ["scholarmark_max_monthly_usd14"] }),
      );
      const params = stripeClient.checkout.sessions.create.mock.calls[0][0];
      expect(params).toMatchObject({
        mode: "subscription",
        payment_method_collection: "always",
        line_items: [{ price: "price_premium_usd14", quantity: 1 }],
        allow_promotion_codes: true,
        adaptive_pricing: { enabled: false },
        metadata: expect.objectContaining({
          billingOffer: "paid_first_month",
          priceOffer: "max_usd14_monthly",
          tier: "max",
        }),
        subscription_data: {
          metadata: expect.objectContaining({
            billingOffer: "paid_first_month",
            priceOffer: "max_usd14_monthly",
            tier: "max",
          }),
        },
      });
    } finally {
      await server.close();
    }
  });

  it.each([
    {
      name: "the legacy USD 14 Pro price (same amount, Pro lookup key)",
      env: { STRIPE_MAX_PRICE_ID: "price_pro_legacy" },
      price: legacyProPrice(),
    },
    {
      name: "a legacy USD 14 Pro price without a lookup key on a Pro product",
      env: { STRIPE_MAX_PRICE_ID: "price_pro_legacy", STRIPE_PRO_PRODUCT_IDS: "prod_pro_legacy" },
      price: legacyProPrice({ lookup_key: null }),
    },
    {
      name: "a USD 14 price listed as a legacy Pro price ID",
      env: { STRIPE_MAX_PRICE_ID: "price_pro_legacy", STRIPE_PRO_LEGACY_PRICE_IDS: "price_pro_legacy" },
      price: legacyProPrice({ lookup_key: null }),
    },
    {
      name: "a USD 14 price tagged scholarmark_tier=pro",
      env: { STRIPE_MAX_PRICE_ID: "price_pro_legacy" },
      price: legacyProPrice({ lookup_key: null, metadata: { scholarmark_tier: "pro" } }),
    },
    {
      name: "the legacy USD 50 Max price",
      env: { STRIPE_MAX_PRICE_ID: "price_max_usd50" },
      price: legacyMaxPrice(),
    },
    {
      name: "a USD 14 price outside STRIPE_MAX_PRODUCT_IDS",
      env: { STRIPE_MAX_PRICE_ID: "price_other", STRIPE_MAX_PRODUCT_IDS: "prod_premium" },
      price: premiumPrice({ id: "price_other", lookup_key: null, product: "prod_other" }),
    },
  ])("fails closed when Premium checkout resolves $name", async ({ env, price }) => {
    Object.assign(process.env, env);
    stripeClient.prices.retrieve.mockResolvedValueOnce(price);
    const { server, token } = await createStripeApp();

    try {
      const response = await postCheckout(server.baseUrl, token, "max");

      expect(response.status).toBe(502);
      expect(stripeClient.checkout.sessions.create).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("fails closed when the Premium lookup key resolves to a non-USD-14 price", async () => {
    stripeClient.prices.list.mockResolvedValueOnce({
      data: [premiumPrice({ unit_amount: 5000 })],
    });
    const { server, token } = await createStripeApp();

    try {
      const response = await postCheckout(server.baseUrl, token, "max");

      expect(response.status).toBe(502);
      expect(stripeClient.checkout.sessions.create).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("uses a pinned STRIPE_MAX_PRICE_ID on a configured Premium product", async () => {
    process.env.STRIPE_MAX_PRICE_ID = "price_premium_pinned";
    process.env.STRIPE_MAX_PRODUCT_IDS = "prod_max_legacy,prod_premium";
    process.env.STRIPE_PRO_PRODUCT_IDS = "prod_pro_legacy,prod_pro";
    stripeClient.prices.retrieve.mockResolvedValueOnce(
      premiumPrice({ id: "price_premium_pinned", lookup_key: null }),
    );
    const { server, token } = await createStripeApp();

    try {
      const response = await postCheckout(server.baseUrl, token, "max");

      expect(response.status).toBe(200);
      expect(stripeClient.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: [{ price: "price_premium_pinned", quantity: 1 }],
          adaptive_pricing: { enabled: false },
        }),
      );
    } finally {
      await server.close();
    }
  });

  it("fails closed when Pro checkout resolves a Premium-configured price", async () => {
    process.env.STRIPE_PRO_PRICE_ID = "price_pro_pinned";
    stripeClient.prices.retrieve.mockResolvedValueOnce(
      monthlyPrice({ id: "price_pro_pinned", lookup_key: null, metadata: { scholarmark_tier: "max" } }),
    );
    const { server, token } = await createStripeApp();

    try {
      const response = await postCheckout(server.baseUrl, token);

      expect(response.status).toBe(502);
      expect(stripeClient.checkout.sessions.create).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("fails closed when no Stripe price carries the USD 5 lookup key", async () => {
    stripeClient.prices.list.mockResolvedValueOnce({ data: [] });
    const { server, token } = await createStripeApp();

    try {
      const response = await postCheckout(server.baseUrl, token);

      expect(response.status).toBe(502);
      expect(stripeClient.checkout.sessions.create).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  async function postSubscriptionWebhook(
    baseUrl: string,
    subscription: ReturnType<typeof monthlySubscription>,
  ) {
    stripeClient.webhooks.constructEvent.mockReturnValueOnce({
      id: "evt_unit",
      type: "customer.subscription.updated",
      data: { object: subscription },
    });
    return requestJson<Record<string, unknown>>(baseUrl, "/api/billing/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=unit" },
      body: { id: "evt_unit" },
    });
  }

  it.each([
    {
      name: "the legacy USD 14 lookup key",
      price: legacyProPrice(),
      expectedTier: "pro",
    },
    {
      name: "a legacy price ID listed in STRIPE_PRO_LEGACY_PRICE_IDS",
      env: { STRIPE_PRO_LEGACY_PRICE_IDS: "price_other, price_pinned_legacy" },
      price: legacyProPrice({ id: "price_pinned_legacy", lookup_key: null }),
      subscriptionMetadata: {},
      expectedTier: "pro",
    },
    {
      name: "the new USD 5 lookup key",
      price: monthlyPrice(),
      expectedTier: "pro",
    },
    {
      name: "price metadata scholarmark_tier",
      price: monthlyPrice({
        id: "price_unlisted",
        lookup_key: null,
        metadata: { scholarmark_tier: "pro" },
      }),
      subscriptionMetadata: {},
      expectedTier: "pro",
    },
    {
      name: "ScholarMark checkout metadata when the price is unrecognized",
      price: monthlyPrice({ id: "price_unlisted", lookup_key: null }),
      subscriptionMetadata: { app: "scholarmark", tier: "pro", userId: "stripe-user" },
      expectedTier: "pro",
    },
    {
      name: "the legacy USD 50 Max lookup key, even with Pro checkout metadata",
      price: legacyMaxPrice(),
      subscriptionMetadata: { app: "scholarmark", tier: "pro", userId: "stripe-user" },
      expectedTier: "max",
    },
    {
      name: "the new USD 14 Premium lookup key",
      price: premiumPrice(),
      expectedTier: "max",
    },
    {
      name: "a legacy Max price ID listed in STRIPE_MAX_LEGACY_PRICE_IDS",
      env: { STRIPE_MAX_LEGACY_PRICE_IDS: "price_max_pinned" },
      price: legacyMaxPrice({ id: "price_max_pinned", lookup_key: null }),
      subscriptionMetadata: {},
      expectedTier: "max",
    },
    {
      name: "the legacy USD 14 Pro lookup key, even with Premium checkout metadata",
      price: legacyProPrice(),
      subscriptionMetadata: { app: "scholarmark", tier: "max", userId: "stripe-user" },
      expectedTier: "pro",
    },
    {
      name: "the legacy USD 14 Pro price when STRIPE_MAX_PRICE_ID wrongly points at it",
      env: { STRIPE_MAX_PRICE_ID: "price_pro_legacy" },
      price: legacyProPrice(),
      expectedTier: "pro",
    },
    {
      name: "a USD 14 price on a Pro product, even when tagged scholarmark_tier=max",
      env: { STRIPE_PRO_PRODUCT_IDS: "prod_pro_legacy" },
      price: legacyProPrice({ lookup_key: null, metadata: { scholarmark_tier: "max" } }),
      subscriptionMetadata: { app: "scholarmark", tier: "max", userId: "stripe-user" },
      expectedTier: "pro",
    },
    {
      name: "a USD 14 price on a Premium product",
      env: { STRIPE_MAX_PRODUCT_IDS: "prod_premium" },
      price: premiumPrice({ id: "price_premium_unlisted", lookup_key: null }),
      subscriptionMetadata: {},
      expectedTier: "max",
    },
    {
      name: "an unrecognized USD 14 price without ScholarMark metadata",
      price: premiumPrice({ id: "price_unlisted", lookup_key: null, product: "prod_unknown" }),
      subscriptionMetadata: {},
      expectedTier: "free",
    },
    {
      name: "an unrecognized price without ScholarMark metadata",
      price: monthlyPrice({ id: "price_unlisted", lookup_key: null }),
      subscriptionMetadata: {},
      expectedTier: "free",
    },
  ])(
    "webhooks resolve an existing subscriber's tier from $name",
    async ({ env, price, subscriptionMetadata, expectedTier }) => {
      Object.assign(process.env, env ?? {});
      const { server } = await createStripeApp({
        tier: "pro",
        stripeSubscriptionId: "sub_new",
        subscriptionStatus: "active",
      });

      try {
        const response = await postSubscriptionWebhook(
          server.baseUrl,
          monthlySubscription({
            items: { data: [{ price }] },
            ...(subscriptionMetadata ? { metadata: subscriptionMetadata } : {}),
          }),
        );
        const { getUserById } = await import("../../server/authStorage");
        const user = await getUserById("stripe-user");

        expect(response.status).toBe(200);
        expect(user?.tier).toBe(expectedTier);
        expect(user?.stripeSubscriptionId).toBe("sub_new");
        expect(user?.stripePriceId).toBe(price.id);
      } finally {
        await server.close();
      }
    },
  );
});
