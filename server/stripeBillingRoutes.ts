import type { Express as ExpressApp, Request, Response } from "express";
import Stripe from "stripe";
import type { User } from "@shared/schema";
import { requireAuth } from "./auth";
import {
  getUserById,
  getUserByStripeCustomerId,
  setUserTier,
  updateUserBillingMetadata,
} from "./authStorage";

type BillingTier = "pro" | "max";

interface StripeBillingPlan {
  label: string;
  amountCents: number;
  currency: "usd";
  lookupKey: string;
}

const PLAN_CONFIG: Record<BillingTier, StripeBillingPlan> = {
  pro: {
    label: "Pro",
    amountCents: 1400,
    currency: "usd",
    lookupKey: "scholarmark_pro_monthly",
  },
  max: {
    label: "Max",
    amountCents: 5000,
    currency: "usd",
    lookupKey: "scholarmark_max_monthly",
  },
};

const PAID_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due"]);

let stripeClient: Stripe | null = null;

function getStripeSecretKey(): string {
  return (process.env.STRIPE_SECRET_KEY || "").trim();
}

function getStripeWebhookSecret(): string {
  return (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
}

function isStripeConfigured(): boolean {
  return Boolean(getStripeSecretKey());
}

function getStripeClient(): Stripe {
  const secretKey = getStripeSecretKey();
  if (!secretKey) {
    throw new Error("Stripe billing is not configured");
  }

  if (!stripeClient) {
    stripeClient = new Stripe(secretKey);
  }
  return stripeClient;
}

function parseTier(value: unknown): BillingTier | null {
  return value === "pro" || value === "max" ? value : null;
}

function getAppBaseUrl(req: Request): string {
  const configuredBaseUrl = (
    process.env.APP_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    ""
  ).trim();
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, "");
  }

  return `${req.protocol}://${req.get("host")}`;
}

function buildAppUrl(
  req: Request,
  pathname: string,
  params: Record<string, string> = {},
): string {
  const url = new URL(pathname, getAppBaseUrl(req));
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function getCustomerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): string {
  if (typeof customer === "string") {
    return customer;
  }
  return customer?.id ?? "";
}

function getSubscriptionCurrentPeriodEnd(
  subscription: Stripe.Subscription,
): Date | null {
  const unixSeconds = (
    subscription as Stripe.Subscription & { current_period_end?: number }
  ).current_period_end;
  return typeof unixSeconds === "number" ? new Date(unixSeconds * 1000) : null;
}

function tierForPrice(
  price: Stripe.Price | null | undefined,
): BillingTier | null {
  if (!price) {
    return null;
  }

  if (
    price.lookup_key === PLAN_CONFIG.pro.lookupKey ||
    price.id === process.env.STRIPE_PRO_PRICE_ID
  ) {
    return "pro";
  }
  if (
    price.lookup_key === PLAN_CONFIG.max.lookupKey ||
    price.id === process.env.STRIPE_MAX_PRICE_ID
  ) {
    return "max";
  }

  return null;
}

function getPrimarySubscriptionPrice(
  subscription: Stripe.Subscription,
): Stripe.Price | null {
  return subscription.items.data[0]?.price ?? null;
}

async function resolvePriceForTier(
  stripe: Stripe,
  tier: BillingTier,
): Promise<Stripe.Price> {
  const configuredPriceId =
    tier === "pro"
      ? process.env.STRIPE_PRO_PRICE_ID
      : process.env.STRIPE_MAX_PRICE_ID;
  if (configuredPriceId?.trim()) {
    return stripe.prices.retrieve(configuredPriceId.trim());
  }

  const prices = await stripe.prices.list({
    active: true,
    limit: 1,
    lookup_keys: [PLAN_CONFIG[tier].lookupKey],
  });
  const price = prices.data[0];
  if (!price) {
    throw new Error(
      `Stripe price not found for ${PLAN_CONFIG[tier].lookupKey}`,
    );
  }
  return price;
}

async function ensureStripeCustomer(
  stripe: Stripe,
  userId: string,
): Promise<User> {
  const existingUser = await getUserById(userId);
  if (!existingUser) {
    throw new Error("Authenticated user was not found");
  }

  if (existingUser.stripeCustomerId) {
    return existingUser;
  }

  const customer = await stripe.customers.create({
    email: existingUser.email,
    metadata: {
      app: "scholarmark",
      userId: existingUser.id,
    },
  });

  return updateUserBillingMetadata(existingUser.id, {
    stripeCustomerId: customer.id,
  } as Partial<User>);
}

async function resolvePortalConfigurationId(
  stripe: Stripe,
): Promise<string | undefined> {
  const configured = process.env.STRIPE_PORTAL_CONFIGURATION_ID?.trim();
  if (configured) {
    return configured;
  }

  const configurations = await stripe.billingPortal.configurations.list({
    active: true,
    limit: 100,
  });
  return configurations.data.find(
    (configuration) => configuration.metadata?.app === "scholarmark",
  )?.id;
}

async function retrieveSubscription(
  stripe: Stripe,
  subscriptionId: string,
): Promise<Stripe.Subscription> {
  return stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price"],
  });
}

async function resolveSubscriptionUserId(
  subscription: Stripe.Subscription,
): Promise<string | null> {
  const metadataUserId =
    typeof subscription.metadata?.userId === "string"
      ? subscription.metadata.userId
      : "";
  if (metadataUserId) {
    return metadataUserId;
  }

  const customerId = getCustomerId(subscription.customer);
  if (!customerId) {
    return null;
  }

  const user = await getUserByStripeCustomerId(customerId);
  return user?.id ?? null;
}

async function syncSubscriptionToUser(
  subscription: Stripe.Subscription,
  options: { resetUsage?: boolean } = {},
): Promise<void> {
  const userId = await resolveSubscriptionUserId(subscription);
  if (!userId) {
    console.warn("[billing] Stripe subscription has no local user", {
      subscriptionId: subscription.id,
    });
    return;
  }

  const price = getPrimarySubscriptionPrice(subscription);
  const tier = tierForPrice(price);
  const hasPaidAccess = PAID_SUBSCRIPTION_STATUSES.has(subscription.status);
  const nextTier = hasPaidAccess && tier ? tier : "free";
  const customerId = getCustomerId(subscription.customer);

  await setUserTier(userId, nextTier, {
    resetUsage: options.resetUsage ?? false,
    billing: {
      stripeCustomerId: customerId || null,
      stripeSubscriptionId: subscription.id,
      stripePriceId: price?.id ?? null,
      subscriptionStatus: subscription.status,
      subscriptionCurrentPeriodEnd:
        getSubscriptionCurrentPeriodEnd(subscription),
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    } as Partial<User>,
  });
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const invoiceLike = invoice as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
    parent?: {
      subscription_details?: {
        subscription?: string | Stripe.Subscription | null;
      } | null;
    } | null;
  };
  const candidates = [
    invoiceLike.subscription,
    invoiceLike.parent?.subscription_details?.subscription,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      return candidate;
    }
    if (candidate?.id) {
      return candidate.id;
    }
  }

  return null;
}

async function syncInvoiceSubscription(
  stripe: Stripe,
  invoice: Stripe.Invoice,
  options: { resetUsage?: boolean } = {},
): Promise<void> {
  const subscriptionId = getInvoiceSubscriptionId(invoice);
  if (!subscriptionId) {
    return;
  }

  const subscription = await retrieveSubscription(stripe, subscriptionId);
  await syncSubscriptionToUser(subscription, options);
}

export function registerStripeBillingRoutes(app: ExpressApp): void {
  app.get("/api/billing/stripe/config", (_req: Request, res: Response) => {
    res.json({
      enabled: isStripeConfigured(),
      currency: "USD",
      plans: PLAN_CONFIG,
    });
  });

  app.post(
    "/api/billing/stripe/checkout",
    requireAuth,
    async (req: Request, res: Response) => {
      if (!isStripeConfigured()) {
        return res
          .status(503)
          .json({ message: "Stripe billing is not configured" });
      }

      const tier = parseTier(req.body?.tier);
      if (!tier) {
        return res.status(400).json({ message: "Invalid billing tier" });
      }

      try {
        const stripe = getStripeClient();
        const user = await ensureStripeCustomer(stripe, req.user!.userId);
        const price = await resolvePriceForTier(stripe, tier);

        const session = await stripe.checkout.sessions.create({
          mode: "subscription",
          customer: user.stripeCustomerId!,
          client_reference_id: user.id,
          line_items: [
            {
              price: price.id,
              quantity: 1,
            },
          ],
          allow_promotion_codes: true,
          success_url: buildAppUrl(req, "/account", { checkout: "success" }),
          cancel_url: buildAppUrl(req, "/pricing", { checkout: "cancelled" }),
          metadata: {
            app: "scholarmark",
            tier,
            userId: user.id,
          },
          subscription_data: {
            metadata: {
              app: "scholarmark",
              tier,
              userId: user.id,
            },
          },
        });

        if (!session.url) {
          return res
            .status(502)
            .json({ message: "Stripe checkout did not return a URL" });
        }

        return res.json({ url: session.url });
      } catch (error) {
        console.error(
          "[billing] failed to create Stripe checkout session",
          error,
        );
        return res
          .status(502)
          .json({ message: "Failed to create Stripe checkout session" });
      }
    },
  );

  app.post(
    "/api/billing/stripe/portal",
    requireAuth,
    async (req: Request, res: Response) => {
      if (!isStripeConfigured()) {
        return res
          .status(503)
          .json({ message: "Stripe billing is not configured" });
      }

      try {
        const stripe = getStripeClient();
        const user = await getUserById(req.user!.userId);
        if (!user?.stripeCustomerId) {
          return res
            .status(400)
            .json({ message: "No Stripe customer exists for this account" });
        }

        const configuration = await resolvePortalConfigurationId(stripe);
        const session = await stripe.billingPortal.sessions.create({
          customer: user.stripeCustomerId,
          return_url: buildAppUrl(req, "/account"),
          ...(configuration ? { configuration } : {}),
        });

        return res.json({ url: session.url });
      } catch (error) {
        console.error(
          "[billing] failed to create Stripe portal session",
          error,
        );
        return res
          .status(502)
          .json({ message: "Failed to open Stripe billing portal" });
      }
    },
  );

  app.post(
    "/api/billing/stripe/webhook",
    async (req: Request, res: Response) => {
      const webhookSecret = getStripeWebhookSecret();
      if (!isStripeConfigured() || !webhookSecret) {
        return res
          .status(503)
          .json({ message: "Stripe webhook is not configured" });
      }

      const signature = req.header("stripe-signature");
      if (!signature || !Buffer.isBuffer(req.rawBody)) {
        return res
          .status(400)
          .json({ message: "Invalid Stripe webhook request" });
      }

      let event: Stripe.Event;
      try {
        event = getStripeClient().webhooks.constructEvent(
          req.rawBody,
          signature,
          webhookSecret,
        );
      } catch (error) {
        console.warn("[billing] invalid Stripe webhook signature", error);
        return res
          .status(400)
          .json({ message: "Invalid Stripe webhook signature" });
      }

      try {
        const stripe = getStripeClient();
        switch (event.type) {
          case "checkout.session.completed": {
            const session = event.data.object as Stripe.Checkout.Session;
            const subscriptionId =
              typeof session.subscription === "string"
                ? session.subscription
                : session.subscription?.id;
            if (subscriptionId) {
              const subscription = await retrieveSubscription(
                stripe,
                subscriptionId,
              );
              await syncSubscriptionToUser(subscription, { resetUsage: true });
            }
            break;
          }

          case "customer.subscription.created":
          case "customer.subscription.updated":
          case "customer.subscription.deleted": {
            await syncSubscriptionToUser(
              event.data.object as Stripe.Subscription,
            );
            break;
          }

          case "invoice.payment_succeeded": {
            await syncInvoiceSubscription(
              stripe,
              event.data.object as Stripe.Invoice,
              {
                resetUsage: true,
              },
            );
            break;
          }

          case "invoice.payment_failed": {
            await syncInvoiceSubscription(
              stripe,
              event.data.object as Stripe.Invoice,
            );
            break;
          }
        }

        return res.json({ received: true });
      } catch (error) {
        console.error("[billing] Stripe webhook handling failed", error);
        return res
          .status(500)
          .json({ message: "Stripe webhook handling failed" });
      }
    },
  );
}
