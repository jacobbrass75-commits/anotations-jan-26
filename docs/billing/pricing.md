# ScholarMark Pricing And Billing

`shared/billingPlans.ts` is the source of truth for plan names, prices, lookup keys, advertised model access, and connector copy. The Stripe and PayPal routes, the Pricing page, the upgrade modal, the Account page label, and the Terms all read from it.

## Plans

| Customer name | Internal tier | New checkout price | Advertised models                                                                             |
| ------------- | ------------- | ------------------ | --------------------------------------------------------------------------------------------- |
| Free          | `free`        | USD 0              | Starter caps                                                                                  |
| Pro           | `pro`         | USD 5 / month      | Claude Sonnet 5.5 and Claude Haiku 5.5                                                        |
| Premium       | `max`         | USD 14 / month     | Claude Sonnet 5.5 and Claude Haiku 5.5, plus up to 10 Claude Opus 5.5 runs per monthly window |

Model access is subject to each plan's monthly AI credits, cost ceiling, and usage limits. Model routing and the Premium Opus cap are enforced by the model policy (`server/aiModels.ts`, `server/planLimits.ts`), not by billing.

The internal tier ID stays `max`. Stored user tiers, Stripe subscription metadata (`tier: "max"`), and PayPal payment rows keep using it, so no data migration is needed.

## Stripe Prices

| Lookup key                      | Amount | Tier    | Sold to new checkouts |
| ------------------------------- | ------ | ------- | --------------------- |
| `scholarmark_pro_monthly_usd5`  | USD 5  | Pro     | Yes                   |
| `scholarmark_pro_monthly`       | USD 14 | Pro     | No, legacy            |
| `scholarmark_max_monthly_usd14` | USD 14 | Premium | Yes                   |
| `scholarmark_max_monthly`       | USD 50 | Premium | No, legacy Max        |

Checkout fails closed unless the resolved price is active, recurring monthly, flat per-unit, USD only, and exactly the advertised amount. It also rejects a price that carries another lookup key or any signal for the other tier. Every Stripe checkout sets `adaptive_pricing: { enabled: false }` so customers are charged in exact USD. Promotion codes, the `paid_first_month` offer metadata, the single-subscription guard, and the success and cancel URLs are unchanged.

### Entitlement Resolution

Webhooks and checkout confirmation map a subscription's price to a tier using these signals, in this priority:

1. A Pro signal: `STRIPE_PRO_PRICE_ID`, `STRIPE_PRO_LEGACY_PRICE_IDS`, a Pro lookup key, price metadata `scholarmark_tier=pro`, or a product in `STRIPE_PRO_PRODUCT_IDS`. Any Pro signal grants Pro, even if a Premium signal also matches (logged as an error).
2. A Premium signal: the same set for `max`.
3. If the price is unrecognized, the ScholarMark checkout metadata on the subscription (`app=scholarmark`, `tier`).
4. Otherwise the user is set to Free.

Billing never infers a tier from the price amount. The legacy USD 14 Pro price and the USD 14 Premium price share an amount, so the amount is not a reliable signal.

## PayPal

PayPal and Venmo orders are one-time payments for one month of access. New Premium orders are created for USD 14.00, labeled `ScholarMark Premium monthly access`. Pending orders are captured against the amount on their own row, so orders created at USD 50 before the change still settle.

## Host-Side AI Connector

On any plan, users can connect ScholarMark to Claude or ChatGPT/Codex at `https://mcp.scholarmark.ai/mcp` and use their own AI account. ScholarMark stores the results and makes no model calls for those requests. See [host-ai-mode.md](../integrations/host-ai-mode.md), [claude-mcp.md](../integrations/claude-mcp.md), and [openai-chatgpt-mcp.md](../integrations/openai-chatgpt-mcp.md).

## Rollout

The Stripe provisioning session must finish first:

1. Create an active, recurring, monthly, USD-only, flat USD 14 price with lookup key `scholarmark_max_monthly_usd14` on a Premium product. Do not add it to, or move it onto, the legacy USD 14 Pro product.
2. Keep `scholarmark_max_monthly` (USD 50) and `scholarmark_pro_monthly` (USD 14) attached to their existing prices so legacy subscribers keep their tiers.
3. Update the billing portal configuration so plan switching offers USD 5 Pro and USD 14 Premium, and not the legacy USD 14 Pro or USD 50 Max prices.
4. Optionally rename the Stripe Max product to Premium so the portal and invoices match.

Production environment:

- Leave `STRIPE_MAX_PRICE_ID` unset, or set it to the new USD 14 Premium price ID. A value pointing at the old USD 50 Max price or the legacy USD 14 Pro price makes Premium checkout fail closed.
- Recommended: set `STRIPE_PRO_PRODUCT_IDS` to every Pro product ID, including the legacy USD 14 Pro product and the product that holds the USD 5 price. When it is set, Pro checkout only sells prices on those products, so leaving out the USD 5 product makes Pro checkout fail closed.
- Optional: set `STRIPE_MAX_PRODUCT_IDS` to the Premium and legacy Max product IDs. When it is set, Premium checkout only sells prices on those products.
- No other env changes. `STRIPE_PRO_PRICE_ID`, `STRIPE_*_LEGACY_PRICE_IDS`, and the PayPal settings keep their current values.

After deploy, `GET /api/billing/stripe/config` should report `plans.max` as `{ label: "Premium", amountCents: 1400, currency: "usd", lookupKey: "scholarmark_max_monthly_usd14" }`, and `GET /api/billing/paypal/config` should report `plans.max` as `{ label: "Premium", amount: "14.00", amountCents: 1400 }`.

`npm run smoke:prod` (`scripts/smoke-prod.mjs`) asserts Pro at 500 cents on `scholarmark_pro_monthly_usd5` and Premium at 1400 cents, labeled `Premium`, on `scholarmark_max_monthly_usd14`. Set `SKIP_BILLING_SMOKE=1` only for deploys that do not touch billing.

### Rollout Status

- Both Stripe prices are provisioned. The USD 5 Pro and USD 14 Premium prices were each confirmed by opening a live Stripe Checkout session that was not paid.
- Production direct Anthropic generation currently fails with an insufficient-credit error from Anthropic. Claude model calls made by ScholarMark do not work until the Anthropic account has credit. The host-side AI connector is not affected because it makes no ScholarMark model calls.
- Before any model or billing rollout, preflight with one successful production generation on a Claude model, and record the model and time. A smoke pass alone does not count, because the smoke does not call a model.
- Do not sell Premium while the model service is unavailable. Premium is sold on Claude model access, including the Opus runs. Hold Premium marketing, pricing changes, and upgrade prompts until the preflight generation succeeds.

Rollback: point `CURRENT_PRICE_OFFERS.max` back to `MAX_PRICE_OFFERS.usd50Monthly` and redeploy. Both prices stay recognized.
