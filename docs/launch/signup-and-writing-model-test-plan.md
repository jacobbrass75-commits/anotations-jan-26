# Signup and Writing Model Test Plan

## Summer Signup

- Visit `/summer`, `/sign-in`, `/sign-up`, and `/summer/onboarding`; each should return the React app shell in production smoke tests.
- Submit an invalid `/api/campaign/signup` payload; it must return `400` JSON validation instead of silently succeeding.
- Submit a new campaign lead; it must create one `campaign_signups` row, return `201`, return a referral code, and send one Resend welcome email when Resend is configured.
- Submit the same email again; it must return `200`, reuse the existing referral code, and not send a second welcome email.
- The welcome email CTA must use `/sign-up?redirect_url=%2Fsummer%2Fonboarding`.
- When a verified account is created with the same email, the campaign lead must be claimed with `user_id` and `account_created_at` without marking it activated until the user completes a real product action.

## Sign-In Redirects

- Public sign-in links should point to `/sign-in?redirect_url=%2Fdashboard`.
- Existing links that use the older `redirect=` query parameter should still resolve safely.
- Unsafe redirects, external URLs, protocol-relative URLs, and auth-loop redirects must resolve to `/dashboard`.

## OpenRouter Writing Model Tests

- `GET /api/write/test-models` requires auth and returns the seven requested model IDs, fixed settings, and the user's plan budget.
- `POST /api/write/test-models/run` requires auth, accepts only the requested model IDs, and sends every OpenRouter call with:
  - `temperature: 0.8`
  - `max_tokens: 800`
  - system prompt: `You are a skilled prose writer.`
- Pro users get a $7 monthly OpenRouter writing-test budget; Max users get $25.
- The server estimates the maximum request cost before calling OpenRouter and blocks requests that would exceed the remaining budget.
- After a successful OpenRouter response, the server records actual spend in `users.ai_budget_microdollars_used`.
- If OpenRouter does not currently list a requested model ID, the model remains visible but unavailable until the catalog supports it.
