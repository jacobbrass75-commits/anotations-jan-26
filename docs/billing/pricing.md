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

### Production State Before Release

Recorded from a read-only Stripe preflight and the signed-in Stripe Dashboard on 2026-11-06. No subscriber or charge was changed.

- The USD 5 Pro price (`scholarmark_pro_monthly_usd5`) and the USD 14 Premium price (`scholarmark_max_monthly_usd14`) are active. Each was confirmed by opening a live Stripe Checkout session that was not paid.
- `STRIPE_MAX_PRICE_ID` still points at the legacy USD 50 Max price.
- The app is pinned to its existing portal configuration through `STRIPE_PORTAL_CONFIGURATION_ID`. Live plan switching is enabled in that configuration. Its Pro option was already changed from the legacy USD 14 Pro price to the USD 5 Pro price. It still offers USD 50 Max.
- Production direct Anthropic generation fails with an insufficient-credit error on Claude Haiku 5.5, Claude Sonnet 5.5, and Claude Opus 5.5. ScholarMark's own Claude calls do not work until the Anthropic account has credit. The host-side AI connector is not affected, because it makes no ScholarMark model calls.

### Launch Gates

All of these must pass before launch:

1. **One successful direct production generation on each model:** Claude Haiku 5.5, Claude Sonnet 5.5, and Claude Opus 5.5. Each model's availability can differ, so one model passing does not cover the others. Record the model ID, time, and result for each one. `npm run smoke:prod` does not count, because it makes no model calls. Do not sell Premium, change pricing, or show upgrade prompts until all three pass.
2. The two Stripe changes below are scheduled for the release window.

### Two Separate Stripe Changes

These changes are independent. Each one controls a different path.

| Change                       | Where                                                                          | What it controls                                                            | Release value                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Application checkout pin** | App environment: `STRIPE_MAX_PRICE_ID`, `STRIPE_MAX_LEGACY_PRICE_IDS`          | New Premium Checkout sessions, and the tier that webhooks grant for a price | `STRIPE_MAX_PRICE_ID` = USD 14 Premium price ID. Append the old USD 50 Max price ID to `STRIPE_MAX_LEGACY_PRICE_IDS` |
| **Portal switch**            | Stripe Dashboard: the portal configuration in `STRIPE_PORTAL_CONFIGURATION_ID` | Which prices existing subscribers can switch to in the billing portal       | Replace the USD 50 Max option with USD 14 Premium. Keep USD 5 Pro. `STRIPE_PORTAL_CONFIGURATION_ID` does not change  |

Checkout pin details:

- While `STRIPE_MAX_PRICE_ID` points at USD 50 Max, the new code fails Premium checkout closed (HTTP 502), and no session is created. Leaving it unset also works, because checkout then resolves the `scholarmark_max_monthly_usd14` lookup key.
- Move the old USD 50 Max price ID into `STRIPE_MAX_LEGACY_PRICE_IDS`. If the pin moves and the old ID is not listed, a USD 50 subscriber whose price has no `scholarmark_max_monthly` lookup key and no ScholarMark checkout metadata resolves to Free on the next webhook. Regression coverage: `tests/server/stripeBillingRoutes.integration.test.ts`.
- `STRIPE_PRO_PRICE_ID`, `STRIPE_PRO_LEGACY_PRICE_IDS`, and the PayPal settings keep their current values.
- Recommended: set `STRIPE_PRO_PRODUCT_IDS` to every Pro product ID, including the legacy USD 14 Pro product and the product that holds the USD 5 price. When it is set, Pro checkout only sells prices on those products, so leaving out the USD 5 product makes Pro checkout fail closed.
- Optional: set `STRIPE_MAX_PRODUCT_IDS` to the Premium and legacy Max product IDs. When it is set, Premium checkout only sells prices on those products.

Keep `scholarmark_max_monthly` (USD 50) and `scholarmark_pro_monthly` (USD 14) attached to their existing prices, so legacy subscribers keep their tiers. Optionally rename the Stripe Max product to Premium, so the portal and invoices match.

### Safe Order

1. Before the release window, append the old USD 50 Max price ID to `STRIPE_MAX_LEGACY_PRICE_IDS`. The current production code already honors this variable, so this step is safe on its own.
2. Confirm launch gate 1. All three models must generate.
3. Deploy the release and set `STRIPE_MAX_PRICE_ID` to the USD 14 Premium price ID in the same restart. If either one lands alone, Premium checkout fails closed. Nobody is charged a wrong amount.
4. Right after the deploy, make the portal switch: replace USD 50 Max with USD 14 Premium.
   - Not before the deploy. The current production code does not recognize `scholarmark_max_monthly_usd14`. A Pro subscriber who switched to it would be charged USD 14 and keep Pro.
   - Not much later than the deploy. Until the switch is made, a Pro subscriber who upgrades in the portal lands on USD 50 Max, while the site advertises USD 14 Premium.
5. Verify. Run `npm run smoke:prod`. Open one live Premium Checkout session without paying, and confirm it charges USD 14. Open the portal for a test Pro customer, and confirm that it offers exactly USD 5 Pro and USD 14 Premium.

`npm run smoke:prod` reports the static plan config. It passes even while `STRIPE_MAX_PRICE_ID` makes Premium checkout fail closed, so the unpaid Checkout session in step 5 is the real check.

After deploy, `GET /api/billing/stripe/config` should report `plans.max` as `{ label: "Premium", amountCents: 1400, currency: "usd", lookupKey: "scholarmark_max_monthly_usd14" }`, and `GET /api/billing/paypal/config` should report `plans.max` as `{ label: "Premium", amount: "14.00", amountCents: 1400 }`. Set `SKIP_BILLING_SMOKE=1` only for deploys that do not touch billing.

### Rollback

Reverse the safe order:

1. Make the portal switch back first: replace USD 14 Premium with USD 50 Max. This stops new USD 14 switches.
2. Append the USD 14 Premium price ID to `STRIPE_MAX_LEGACY_PRICE_IDS`. The previous code only recognizes that price through this list. Without it, a subscriber who switched from Pro in the portal keeps Pro checkout metadata and would drop back to Pro.
3. Set `STRIPE_MAX_PRICE_ID` back to the USD 50 Max price ID, and redeploy the previous release in the same restart.

Price-only rollback (keep this code): point `CURRENT_PRICE_OFFERS.max` back to `MAX_PRICE_OFFERS.usd50Monthly`, set `STRIPE_MAX_PRICE_ID` back to USD 50 Max, make the portal switch back, and redeploy. Both prices stay recognized.
