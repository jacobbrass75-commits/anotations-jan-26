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
  clerkClient: { users: { getUser: clerkGetUser } },
}));

const FUNNEL_ORDER = [
  "landing_view",
  "engaged_10_seconds",
  "scroll_50_percent",
  "primary_cta_click",
  "pricing_view",
  "signup_started",
  "signup_details_submitted",
  "signup_verification_sent",
  "signup_verification_succeeded",
  "signup_completed",
  "checkout_started",
  "purchase_completed",
  "first_project_created",
] as const;

describe("site analytics routes", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();
  const originalAdminIds = process.env.ADMIN_USER_IDS;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-site-analytics-"));
    vi.resetModules();
    vi.clearAllMocks();
    process.env.ADMIN_USER_IDS = "analytics-admin";
    process.chdir(tempDir);
    await bootstrapTempWorkspace(tempDir);
  }, 30_000);

  afterEach(async () => {
    sqlite?.close();
    sqlite = null;
    if (originalAdminIds === undefined) delete process.env.ADMIN_USER_IDS;
    else process.env.ADMIN_USER_IDS = originalAdminIds;
    process.chdir(originalCwd);
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createApp() {
    const { db, sqlite: importedSqlite } = await import("../../server/db");
    const { users } = await import("../../shared/schema");
    const { registerSiteAnalyticsRoutes } = await import("../../server/siteAnalyticsRoutes");
    const { generateToken } = await import("../../server/auth");
    sqlite = importedSqlite;

    const now = new Date();
    await db.insert(users).values({
      id: "analytics-admin",
      email: "analytics@example.com",
      username: "analytics@example.com",
      password: "",
      tier: "max",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    } as any);

    const app = express();
    app.use(express.json());
    registerSiteAnalyticsRoutes(app);
    return {
      server: await startHttpServer(app),
      readLatestPageView: () =>
        importedSqlite
          .prepare(
            "SELECT referrer, referrer_host FROM site_page_views ORDER BY created_at DESC LIMIT 1",
          )
          .get() as { referrer: string | null; referrer_host: string | null } | undefined,
      readCompletionRows: () =>
        importedSqlite
          .prepare(
            "SELECT user_id, visitor_id FROM site_events WHERE event_name = 'signup_completed' ORDER BY created_at",
          )
          .all() as Array<{ user_id: string | null; visitor_id: string }>,
      adminToken: generateToken({
        id: "analytics-admin",
        email: "analytics@example.com",
        tier: "max",
      }),
    };
  }

  function event(eventName: (typeof FUNNEL_ORDER)[number], overrides = {}) {
    return {
      eventName,
      visitorId: "visitor-12345678",
      sessionId: "session-12345678",
      path: "/pricing",
      clientTimestamp: Date.now(),
      utmSource: "instagram",
      utmMedium: "paid_social",
      utmCampaign: "summer-reels",
      utmContent: "reel-4",
      referrer: "https://l.instagram.com/tracking?private=discarded",
      ctaOrFeature: "hero-start-writing",
      deviceCategory: "mobile",
      viewportWidth: 390,
      viewportHeight: 844,
      ...overrides,
    };
  }

  it("ingests funnel events and returns the fixed funnel order to an authenticated admin", async () => {
    const { server, adminToken } = await createApp();
    try {
      for (const payload of [
        event("landing_view"),
        event("landing_view", { sessionId: "session-second-123", path: "/" }),
        event("primary_cta_click"),
        event("signup_started"),
      ]) {
        const response = await requestJson(server.baseUrl, "/api/site-analytics/event", {
          method: "POST",
          body: payload,
        });
        expect(response.status).toBe(204);
      }

      const report = await requestJson<{
        funnel: Array<{ eventName: string; eventCount: number; uniqueVisitors: number }>;
      }>(server.baseUrl, `/api/admin/site-analytics?from=0&to=${Date.now() + 60_000}`, {
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(report.status).toBe(200);
      expect(report.body?.funnel.map((step) => step.eventName)).toEqual(FUNNEL_ORDER);
      expect(report.body?.funnel.find((step) => step.eventName === "landing_view")).toEqual({
        eventName: "landing_view",
        eventCount: 2,
        uniqueVisitors: 1,
      });
      expect(report.body?.funnel.find((step) => step.eventName === "primary_cta_click")).toEqual({
        eventName: "primary_cta_click",
        eventCount: 1,
        uniqueVisitors: 1,
      });
      expect(report.body?.funnel.find((step) => step.eventName === "purchase_completed")).toEqual({
        eventName: "purchase_completed",
        eventCount: 0,
        uniqueVisitors: 0,
      });
      expect(report.headers).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it.each([
    ["unknown event", event("landing_view", { eventName: "made_up_event" })],
    ["short visitor ID", event("landing_view", { visitorId: "short" })],
    ["external path", event("landing_view", { path: "https://evil.example/" })],
    ["unsupported device", event("landing_view", { deviceCategory: "television" })],
    ["negative viewport", event("landing_view", { viewportWidth: -1 })],
    ["oversized CTA name", event("landing_view", { ctaOrFeature: "x".repeat(501) })],
  ])("rejects malformed analytics payloads: %s", async (_label, payload) => {
    const { server } = await createApp();
    try {
      const response = await requestJson(server.baseUrl, "/api/site-analytics/event", {
        method: "POST",
        body: payload,
      });
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ message: "Invalid analytics event" });
    } finally {
      await server.close();
    }
  });

  it("requires admin authentication for the funnel report", async () => {
    const { server } = await createApp();
    try {
      const response = await requestJson(server.baseUrl, "/api/admin/site-analytics");
      expect(response.status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it("records signup completion only for a newly-created verified account", async () => {
    const { server, adminToken, readCompletionRows } = await createApp();
    try {
      const anonymous = await requestJson(server.baseUrl, "/api/site-analytics/event", {
        method: "POST",
        body: event("signup_completed"),
      });
      expect(anonymous.status).toBe(204);

      const legacyJwt = await requestJson(server.baseUrl, "/api/site-analytics/event", {
        method: "POST",
        headers: { authorization: `Bearer ${adminToken}` },
        body: event("signup_completed"),
      });
      expect(legacyJwt.status).toBe(204);

      clerkGetAuth.mockReturnValue({ userId: "analytics-admin" });
      const clerkUser = (createdAt: number, verified: boolean) => ({
        createdAt,
        primaryEmailAddressId: "email-primary",
        emailAddresses: [
          {
            id: "email-primary",
            emailAddress: "analytics@example.com",
            verification: { status: verified ? "verified" : "unverified" },
          },
        ],
        publicMetadata: {},
      });

      clerkGetUser.mockResolvedValue(clerkUser(Date.now(), false));
      const unverified = await requestJson(server.baseUrl, "/api/site-analytics/event", {
        method: "POST",
        body: event("signup_completed", { visitorId: "visitor-unverified" }),
      });
      expect(unverified.status).toBe(204);

      clerkGetUser.mockResolvedValue(clerkUser(Date.now() - 60 * 60 * 1000, true));
      const oldAccount = await requestJson(server.baseUrl, "/api/site-analytics/event", {
        method: "POST",
        body: event("signup_completed", { visitorId: "visitor-old-account" }),
      });
      expect(oldAccount.status).toBe(204);

      clerkGetUser.mockResolvedValue(clerkUser(Date.now(), true));
      for (const visitorId of ["visitor-real-signup", "visitor-replayed-signup"]) {
        const authenticated = await requestJson(server.baseUrl, "/api/site-analytics/event", {
          method: "POST",
          body: event("signup_completed", { visitorId }),
        });
        expect(authenticated.status).toBe(204);
      }

      const report = await requestJson<{
        funnel: Array<{ eventName: string; eventCount: number; uniqueVisitors: number }>;
      }>(server.baseUrl, `/api/admin/site-analytics?from=0&to=${Date.now() + 60_000}`, {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(report.status).toBe(200);
      expect(report.body?.funnel.find((step) => step.eventName === "signup_completed")).toEqual({
        eventName: "signup_completed",
        eventCount: 1,
        uniqueVisitors: 1,
      });
      expect(readCompletionRows()).toEqual([
        { user_id: "analytics-admin", visitor_id: "visitor-real-signup" },
      ]);
    } finally {
      await server.close();
    }
  });

  it("retains campaign attribution while reducing referrers to non-sensitive URL data", async () => {
    const { server, adminToken, readLatestPageView } = await createApp();
    try {
      const ingestion = await requestJson(server.baseUrl, "/api/site-analytics/page-view", {
        method: "POST",
        body: {
          visitorId: "visitor-attribution",
          sessionId: "session-attribution",
          path: "/?offer=student",
          referrer: "https://l.instagram.com/path?token=secret#private",
          utmSource: "instagram",
          utmMedium: "paid_social",
          utmCampaign: "summer-reels",
          utmContent: "reel-4",
        },
      });
      expect(ingestion.status).toBe(204);
      expect(readLatestPageView()).toEqual({
        referrer: "https://l.instagram.com/path",
        referrer_host: "l.instagram.com",
      });

      const report = await requestJson<{
        totals: { page_views: number; unique_visitors: number; sessions: number };
        sources: Array<{ source: string; page_views: number }>;
        campaigns: Array<{ campaign: string; source: string; page_views: number }>;
      }>(server.baseUrl, `/api/admin/site-analytics?from=0&to=${Date.now() + 60_000}`, {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(report.status).toBe(200);
      expect(report.body?.totals).toEqual({ page_views: 1, unique_visitors: 1, sessions: 1 });
      expect(report.body?.sources).toContainEqual({
        source: "instagram",
        page_views: 1,
        unique_visitors: 1,
      });
      expect(report.body?.campaigns).toContainEqual({
        campaign: "summer-reels",
        source: "instagram",
        page_views: 1,
        unique_visitors: 1,
      });
    } finally {
      await server.close();
    }
  });
});
