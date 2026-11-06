/**
 * Unit tests for the signup and pricing attribution helpers.
 * Run with `npm test` (Node's built-in test runner; Node 22.18+ strips the types).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attributedLinkKind,
  attributionFromSearch,
  attributionFromStored,
  decorateHref,
} from "../src/scripts/attributionCore.ts";

const SIGNUP =
  "https://app.scholarmark.ai/sign-up?redirect_url=%2Fpricing%3Fonboarding%3D1%26source%3Dsummer";
const PRICING = "https://app.scholarmark.ai/pricing";
const PAID = "?utm_source=ig&utm_medium=paid&utm_campaign=fall&fbclid=abc&gclid=nope&ref=x";

test("reads only the app's attribution parameters, trimmed and capped", () => {
  assert.deepEqual(attributionFromSearch(PAID), {
    utm_source: "ig",
    utm_medium: "paid",
    utm_campaign: "fall",
    fbclid: "abc",
  });
  assert.deepEqual(attributionFromSearch("?utm_source=%20reddit%20&utm_medium="), {
    utm_source: "reddit",
  });
  assert.equal(attributionFromSearch(`?utm_term=${"x".repeat(250)}`).utm_term?.length, 200);
});

test("ignores malformed or foreign stored values", () => {
  assert.deepEqual(attributionFromStored(null), {});
  assert.deepEqual(attributionFromStored("not json"), {});
  assert.deepEqual(attributionFromStored("[1,2]"), {});
  assert.deepEqual(attributionFromStored('{"utm_source":" news ","evil":"x","utm_medium":3}'), {
    utm_source: "news",
  });
});

test("classifies which links carry attribution", () => {
  assert.equal(attributedLinkKind(SIGNUP, true), "signup");
  assert.equal(attributedLinkKind(PRICING, false), "pricing");
  assert.equal(attributedLinkKind(`${PRICING}?onboarding=1`, false), "pricing");
  assert.equal(
    attributedLinkKind("https://app.scholarmark.ai/sign-in?redirect_url=%2Fdashboard", false),
    null,
  );
  assert.equal(attributedLinkKind("https://app.scholarmark.ai/privacy", false), null);
  assert.equal(attributedLinkKind("https://example.org/pricing", false), null);
  assert.equal(attributedLinkKind("https://scholarmark.ai/pricing", false), null);
  assert.equal(attributedLinkKind("not a url", false), null);
});

test("pricing links keep the visitor's campaign", () => {
  const url = new URL(decorateHref(PRICING, "pricing", attributionFromSearch(PAID), false));
  assert.equal(url.origin + url.pathname, PRICING);
  assert.equal(url.searchParams.get("utm_source"), "ig");
  assert.equal(url.searchParams.get("utm_medium"), "paid");
  assert.equal(url.searchParams.get("utm_campaign"), "fall");
  assert.equal(url.searchParams.get("fbclid"), "abc");
  assert.equal(url.searchParams.has("gclid"), false);
});

test("pricing links never get the embedded-auth flag", () => {
  const url = new URL(decorateHref(PRICING, "pricing", { utm_source: "ig" }, true));
  assert.equal(url.searchParams.has("embedded_auth"), false);
});

test("signup links are unchanged in behaviour: campaign, redirect and embedded auth", () => {
  const url = new URL(decorateHref(SIGNUP, "signup", attributionFromSearch(PAID), true));
  assert.equal(url.searchParams.get("redirect_url"), "/pricing?onboarding=1&source=summer");
  assert.equal(url.searchParams.get("utm_source"), "ig");
  assert.equal(url.searchParams.get("fbclid"), "abc");
  assert.equal(url.searchParams.get("embedded_auth"), "1");
  const desktop = new URL(decorateHref(SIGNUP, "signup", {}, false));
  assert.equal(desktop.search, new URL(SIGNUP).search);
});

test("parameters already on a link are not overwritten", () => {
  const href = `${PRICING}?utm_source=email`;
  const url = new URL(
    decorateHref(href, "pricing", { utm_source: "ig", utm_medium: "paid" }, false),
  );
  assert.equal(url.searchParams.get("utm_source"), "email");
  assert.equal(url.searchParams.get("utm_medium"), "paid");
});
