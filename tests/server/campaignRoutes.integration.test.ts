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

async function waitFor<T>(read: () => T, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 1000;
  let latest = read();
  while (Date.now() < deadline) {
    latest = read();
    if (done(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return latest;
}

describe("summer campaign routes", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();
  const originalAdminUserIds = process.env.ADMIN_USER_IDS;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-campaign-routes-"));
    vi.resetModules();
    vi.clearAllMocks();
    process.env.ADMIN_USER_IDS = "campaign-admin";
    process.chdir(tempDir);
    await bootstrapTempWorkspace(tempDir);
  });

  afterEach(async () => {
    sqlite?.close();
    sqlite = null;
    if (originalAdminUserIds === undefined) {
      delete process.env.ADMIN_USER_IDS;
    } else {
      process.env.ADMIN_USER_IDS = originalAdminUserIds;
    }
    process.chdir(originalCwd);
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createCampaignApp() {
    const { db, sqlite: importedSqlite } = await import("../../server/db");
    const { campaignSignups, users } = await import("../../shared/schema");
    const { generateToken, requireAuth } = await import("../../server/auth");
    const { registerCampaignRoutes, trackCampaignActivation } = await import(
      "../../server/campaignRoutes"
    );

    sqlite = importedSqlite;

    const now = new Date("2026-06-01T00:00:00.000Z");
    await db.insert(users).values([
      {
        id: "campaign-admin",
        email: "admin@example.com",
        username: "admin@example.com",
        password: "",
        tier: "max",
        createdAt: now,
        updatedAt: now,
      } as any,
      {
        id: "lead-user",
        email: "lead@example.com",
        username: "lead@example.com",
        password: "",
        tier: "free",
        createdAt: now,
        updatedAt: now,
      } as any,
      {
        id: "paid-user",
        email: "paid@example.com",
        username: "paid@example.com",
        password: "",
        tier: "pro",
        stripeCustomerId: "cus_paid",
        stripeSubscriptionId: "sub_paid",
        subscriptionStatus: "active",
        createdAt: now,
        updatedAt: now,
      } as any,
    ]);

    const app = express();
    app.use(express.json());
    registerCampaignRoutes(app);
    app.post(
      "/api/test/success-action",
      requireAuth,
      trackCampaignActivation("created_project"),
      (_req, res) => res.status(201).json({ ok: true }),
    );
    app.post(
      "/api/test/failed-action",
      requireAuth,
      trackCampaignActivation("created_project"),
      (_req, res) => res.status(400).json({ ok: false }),
    );

    const server = await startHttpServer(app);
    return {
      campaignSignups,
      db,
      server,
      adminToken: generateToken({ id: "campaign-admin", email: "admin@example.com", tier: "max" }),
      leadToken: generateToken({ id: "lead-user", email: "lead@example.com", tier: "free" }),
    };
  }

  it("records visits, creates idempotent signups, and exposes admin metrics", async () => {
    const { adminToken, server } = await createCampaignApp();

    try {
      const visit = await requestJson(server.baseUrl, "/api/campaign/visit", {
        method: "POST",
        body: {
          campus: "ucla",
          major: "history",
          channel: "discord",
          inviteCode: "HISTCAPSTONE",
          landingPath: "/summer",
        },
      });
      expect(visit.status).toBe(204);

      const signup = await requestJson<{ alreadySignedUp: boolean; referralCode: string }>(
        server.baseUrl,
        "/api/campaign/signup",
        {
          method: "POST",
          body: {
            name: "Maya Chen",
            email: "MAYA@EXAMPLE.COM",
            school: "UCLA",
            major: "History",
            classYear: "rising_senior",
            paperType: "senior_thesis",
            hasTopic: "kind_of",
            campus: "ucla",
            channel: "discord",
            inviteCode: "HISTCAPSTONE",
          },
        },
      );
      expect(signup.status).toBe(201);
      expect(signup.body?.alreadySignedUp).toBe(false);
      expect(signup.body?.referralCode).toMatch(/^maya-[a-f0-9]{4}$/);

      const duplicate = await requestJson<{ alreadySignedUp: boolean; referralCode: string }>(
        server.baseUrl,
        "/api/campaign/signup",
        {
          method: "POST",
          body: {
            name: "Maya Chen",
            email: "maya@example.com",
            school: "UCLA",
            major: "History",
            classYear: "rising_senior",
            paperType: "senior_thesis",
            hasTopic: "kind_of",
          },
        },
      );
      expect(duplicate.status).toBe(200);
      expect(duplicate.body).toEqual({
        alreadySignedUp: true,
        referralCode: signup.body?.referralCode,
      });

      const paidVisit = await requestJson(server.baseUrl, "/api/campaign/visit", {
        method: "POST",
        body: {
          campus: "ucla",
          major: "history",
          channel: "discord",
          landingPath: "/summer",
        },
      });
      expect(paidVisit.status).toBe(204);

      const paidSignup = await requestJson<{ alreadySignedUp: boolean; referralCode: string }>(
        server.baseUrl,
        "/api/campaign/signup",
        {
          method: "POST",
          body: {
            name: "Paid Student",
            email: "paid@example.com",
            school: "UCLA",
            major: "History",
            classYear: "rising_senior",
            paperType: "senior_thesis",
            hasTopic: "yes",
            channel: "discord",
          },
        },
      );
      expect(paidSignup.status).toBe(201);

      const metrics = await requestJson<{
        totals: { visits: number; signups: number; activated: number; paid: number };
        rates: { signupRate: number | null; paidRate: number | null };
        breakdowns: { channel: Array<{ value: string; paid: number }> };
        recentSignups: Array<{ email: string; paid: boolean; plan: string | null }>;
      }>(server.baseUrl, "/api/admin/campaign/metrics", {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(metrics.status).toBe(200);
      expect(metrics.body?.totals).toMatchObject({
        visits: 2,
        signups: 2,
        activated: 0,
        paid: 1,
      });
      expect(metrics.body?.rates.signupRate).toBe(1);
      expect(metrics.body?.rates.paidRate).toBe(0.5);
      expect(metrics.body?.breakdowns.channel.find((row) => row.value === "discord")?.paid).toBe(
        1,
      );
      expect(metrics.body?.recentSignups.find((row) => row.email === "paid@example.com")).toEqual(
        expect.objectContaining({ paid: true, plan: "pro" }),
      );
    } finally {
      await server.close();
    }
  });

  it("only marks a campaign lead activated after a successful product action", async () => {
    const { campaignSignups, db, leadToken, server } = await createCampaignApp();

    try {
      await db.insert(campaignSignups).values({
        name: "Lead User",
        email: "lead@example.com",
        school: "Test U",
        major: "History",
        classYear: "rising_senior",
        paperType: "senior_thesis",
        hasTopic: "yes",
        referralCode: "lead-0001",
        createdAt: new Date("2026-06-01T00:00:00.000Z"),
      });

      const failed = await requestJson(server.baseUrl, "/api/test/failed-action", {
        method: "POST",
        headers: { authorization: `Bearer ${leadToken}` },
      });
      expect(failed.status).toBe(400);

      const afterFailure = await db.select().from(campaignSignups);
      expect(afterFailure[0].activatedAt).toBeNull();

      const success = await requestJson(server.baseUrl, "/api/test/success-action", {
        method: "POST",
        headers: { authorization: `Bearer ${leadToken}` },
      });
      expect(success.status).toBe(201);

      const activated = await waitFor(
        () => db.select().from(campaignSignups).all(),
        (rows) => Boolean(rows[0]?.activatedAt),
      );
      expect(activated[0].userId).toBe("lead-user");
      expect(activated[0].firstAction).toBe("created_project");
    } finally {
      await server.close();
    }
  });
});
