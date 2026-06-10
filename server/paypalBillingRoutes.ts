import type { Express as ExpressApp, Request, Response } from "express";
import { randomUUID } from "crypto";
import { sqlite } from "./db";
import { requireAuth } from "./auth";
import { setUserTier } from "./authStorage";
import { createLogger } from "./logger";

const logger = createLogger("paypalBillingRoutes");

type PayPalEnvironment = "sandbox" | "live";
type BillingTier = "pro" | "max";

interface BillingPaymentRow {
  id: string;
  provider_order_id: string;
  provider_capture_id: string | null;
  user_id: string;
  tier: BillingTier;
  amount_cents: number;
  currency: string;
  status: string;
}

const CURRENCY = "USD";
const PLAN_CONFIG: Record<BillingTier, { label: string; amount: string; amountCents: number }> = {
  pro: { label: "Pro", amount: "14.00", amountCents: 1400 },
  max: { label: "Max", amount: "50.00", amountCents: 5000 },
};

const selectPaymentByOrderId = sqlite.prepare(
  `SELECT id, provider_order_id, provider_capture_id, user_id, tier, amount_cents, currency, status
   FROM billing_payments
   WHERE provider_order_id = ?`,
);

const insertPayment = sqlite.prepare(
  `INSERT INTO billing_payments (
     id, provider, provider_order_id, user_id, tier, amount_cents, currency, status, raw_response, created_at, updated_at
   )
   VALUES (?, 'paypal', ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
   ON CONFLICT(provider_order_id) DO UPDATE SET
     status = excluded.status,
     raw_response = excluded.raw_response,
     updated_at = unixepoch()`,
);

const updatePaymentStatus = sqlite.prepare(
  `UPDATE billing_payments
   SET status = ?,
       provider_capture_id = COALESCE(?, provider_capture_id),
       raw_response = ?,
       updated_at = unixepoch(),
       completed_at = CASE WHEN ? = 'COMPLETED' THEN unixepoch() ELSE completed_at END
   WHERE provider_order_id = ?`,
);

function getPayPalConfig(): {
  configured: boolean;
  clientId: string;
  clientSecret: string;
  environment: PayPalEnvironment;
  apiBaseUrl: string;
  webhookId: string;
} {
  const environment: PayPalEnvironment = process.env.PAYPAL_ENV === "sandbox" ? "sandbox" : "live";
  const clientId = (process.env.PAYPAL_CLIENT_ID || process.env.VITE_PAYPAL_CLIENT_ID || "").trim();
  const clientSecret = (process.env.PAYPAL_CLIENT_SECRET || "").trim();
  const webhookId = (process.env.PAYPAL_WEBHOOK_ID || "").trim();
  const apiBaseUrl =
    environment === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";

  return {
    configured: Boolean(clientId && clientSecret),
    clientId,
    clientSecret,
    environment,
    apiBaseUrl,
    webhookId,
  };
}

function parseTier(value: unknown): BillingTier | null {
  return value === "pro" || value === "max" ? value : null;
}

function toCents(value: unknown): number {
  const numeric = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0;
}

async function getPayPalAccessToken(): Promise<string> {
  const config = getPayPalConfig();
  if (!config.configured) {
    throw new Error("PayPal checkout is not configured");
  }

  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const response = await fetch(`${config.apiBaseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    throw new Error(`PayPal token request failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) {
    throw new Error("PayPal token response did not include an access token");
  }

  return body.access_token;
}

async function paypalRequest<T>(
  path: string,
  options: RequestInit & { requestId?: string } = {},
): Promise<T> {
  const config = getPayPalConfig();
  const accessToken = await getPayPalAccessToken();
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("Content-Type", "application/json");
  if (options.requestId) {
    headers.set("PayPal-Request-Id", options.requestId);
  }

  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw new Error(`PayPal API request failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as T;
}

function getCaptureDetails(order: any): {
  status: string;
  captureId: string | null;
  amountCents: number;
  currency: string | null;
} {
  const capture = order?.purchase_units?.[0]?.payments?.captures?.[0];
  const status = String(capture?.status || order?.status || "UNKNOWN");
  return {
    status,
    captureId: typeof capture?.id === "string" ? capture.id : null,
    amountCents: toCents(capture?.amount?.value),
    currency:
      typeof capture?.amount?.currency_code === "string" ? capture.amount.currency_code : null,
  };
}

async function grantTierIfPaymentCompleted(
  orderId: string,
  paypalOrder: any,
): Promise<{
  completed: boolean;
  tier?: BillingTier;
  status: string;
}> {
  const row = selectPaymentByOrderId.get(orderId) as BillingPaymentRow | undefined;
  if (!row) {
    return { completed: false, status: "UNKNOWN_ORDER" };
  }

  const capture = getCaptureDetails(paypalOrder);
  const rawResponse = JSON.stringify(paypalOrder);

  if (capture.status !== "COMPLETED") {
    updatePaymentStatus.run(
      capture.status,
      capture.captureId,
      rawResponse,
      capture.status,
      orderId,
    );
    return { completed: false, status: capture.status };
  }

  if (capture.currency !== row.currency || capture.amountCents !== row.amount_cents) {
    updatePaymentStatus.run(
      "AMOUNT_MISMATCH",
      capture.captureId,
      rawResponse,
      "AMOUNT_MISMATCH",
      orderId,
    );
    throw new Error("Captured PayPal amount does not match the requested ScholarMark plan");
  }

  await setUserTier(row.user_id, row.tier);
  updatePaymentStatus.run("COMPLETED", capture.captureId, rawResponse, "COMPLETED", orderId);
  return { completed: true, tier: row.tier, status: "COMPLETED" };
}

async function capturePayPalOrder(orderId: string): Promise<any> {
  return paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    body: "{}",
    requestId: `scholarmark-capture-${orderId}`,
  });
}

async function showPayPalOrder(orderId: string): Promise<any> {
  return paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
  });
}

async function captureOrReadCompletedOrder(orderId: string): Promise<any> {
  try {
    return await capturePayPalOrder(orderId);
  } catch (error) {
    const order = await showPayPalOrder(orderId);
    if (getCaptureDetails(order).status === "COMPLETED") {
      return order;
    }
    throw error;
  }
}

async function verifyWebhook(req: Request): Promise<boolean> {
  const config = getPayPalConfig();
  if (!config.configured || !config.webhookId) {
    return false;
  }

  const verification = await paypalRequest<{ verification_status?: string }>(
    "/v1/notifications/verify-webhook-signature",
    {
      method: "POST",
      body: JSON.stringify({
        auth_algo: req.header("paypal-auth-algo"),
        cert_url: req.header("paypal-cert-url"),
        transmission_id: req.header("paypal-transmission-id"),
        transmission_sig: req.header("paypal-transmission-sig"),
        transmission_time: req.header("paypal-transmission-time"),
        webhook_id: config.webhookId,
        webhook_event: req.body,
      }),
    },
  );

  return verification.verification_status === "SUCCESS";
}

export function registerPayPalBillingRoutes(app: ExpressApp): void {
  app.get("/api/billing/paypal/config", (_req: Request, res: Response) => {
    const config = getPayPalConfig();
    res.json({
      enabled: config.configured,
      clientId: config.configured ? config.clientId : null,
      environment: config.environment,
      currency: CURRENCY,
      plans: PLAN_CONFIG,
    });
  });

  app.post("/api/billing/paypal/orders", requireAuth, async (req: Request, res: Response) => {
    const config = getPayPalConfig();
    if (!config.configured) {
      return res.status(503).json({ message: "PayPal checkout is not configured" });
    }

    const tier = parseTier(req.body?.tier);
    if (!tier) {
      return res.status(400).json({ message: "Invalid billing tier" });
    }

    const plan = PLAN_CONFIG[tier];
    try {
      const order = await paypalRequest<{ id: string; status: string }>("/v2/checkout/orders", {
        method: "POST",
        requestId: randomUUID(),
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              reference_id: `scholarmark-${tier}`,
              custom_id: req.user!.userId,
              description: `ScholarMark ${plan.label} monthly access`,
              amount: {
                currency_code: CURRENCY,
                value: plan.amount,
              },
            },
          ],
          application_context: {
            brand_name: "ScholarMark",
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
          },
        }),
      });

      insertPayment.run(
        randomUUID(),
        order.id,
        req.user!.userId,
        tier,
        plan.amountCents,
        CURRENCY,
        order.status || "CREATED",
        JSON.stringify(order),
      );

      return res.json({ orderId: order.id });
    } catch (error) {
      logger.error({ err: error }, "[billing] failed to create PayPal order");
      return res.status(502).json({ message: "Failed to create PayPal order" });
    }
  });

  app.post(
    "/api/billing/paypal/orders/:orderId/capture",
    requireAuth,
    async (req: Request, res: Response) => {
      const row = selectPaymentByOrderId.get(req.params.orderId) as BillingPaymentRow | undefined;
      if (!row || row.user_id !== req.user!.userId) {
        return res.status(404).json({ message: "Payment order not found" });
      }

      if (row.status === "COMPLETED") {
        return res.json({ completed: true, tier: row.tier, status: "COMPLETED" });
      }

      try {
        const capturedOrder = await captureOrReadCompletedOrder(req.params.orderId);
        const result = await grantTierIfPaymentCompleted(req.params.orderId, capturedOrder);
        return res.json(result);
      } catch (error) {
        logger.error({ err: error }, "[billing] failed to capture PayPal order");
        return res.status(502).json({ message: "Failed to capture PayPal order" });
      }
    },
  );

  app.post("/api/billing/paypal/webhook", async (req: Request, res: Response) => {
    try {
      const verified = await verifyWebhook(req);
      if (!verified) {
        return res.status(400).json({ message: "Invalid PayPal webhook signature" });
      }

      const eventType = String(req.body?.event_type || "");
      if (eventType === "CHECKOUT.ORDER.APPROVED") {
        const orderId = req.body?.resource?.id;
        if (typeof orderId === "string" && selectPaymentByOrderId.get(orderId)) {
          const capturedOrder = await captureOrReadCompletedOrder(orderId);
          await grantTierIfPaymentCompleted(orderId, capturedOrder);
        }
      }

      if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
        const orderId = req.body?.resource?.supplementary_data?.related_ids?.order_id;
        if (typeof orderId === "string" && selectPaymentByOrderId.get(orderId)) {
          const order = await showPayPalOrder(orderId);
          await grantTierIfPaymentCompleted(orderId, order);
        }
      }

      return res.json({ received: true });
    } catch (error) {
      logger.error({ err: error }, "[billing] PayPal webhook handling failed");
      return res.status(500).json({ message: "PayPal webhook handling failed" });
    }
  });
}
