import { createHash } from "crypto";
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

describe("auth route integration", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-auth-routes-"));
    vi.resetModules();
    vi.clearAllMocks();
    process.chdir(tempDir);
    await bootstrapTempWorkspace(tempDir);
  });

  afterEach(async () => {
    sqlite?.close();
    sqlite = null;
    process.chdir(originalCwd);
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createAuthApp() {
    const express = (await import("express")).default;
    const { db, sqlite: importedSqlite } = await import("../../server/db");
    const { users } = await import("../../shared/schema");
    const { registerAuthRoutes } = await import("../../server/authRoutes");
    const { generateToken, requireAuth } = await import("../../server/auth");

    sqlite = importedSqlite;

    const app = express();
    app.use(express.json());
    registerAuthRoutes(app);
    app.post("/api/documents/:id/search", requireAuth, (_req, res) => {
      res.json({ ok: true });
    });
    app.post("/api/project-documents/:id/search", requireAuth, (_req, res) => {
      res.json({ ok: true });
    });
    app.post("/api/projects/:projectId/search", requireAuth, (_req, res) => {
      res.json({ ok: true });
    });

    const now = new Date("2026-03-01T00:00:00.000Z");
    await db.insert(users).values({
      id: "user-1",
      email: "researcher@example.com",
      username: "researcher@example.com",
      password: "",
      tier: "pro",
      tokensUsed: 1250,
      tokenLimit: 5000,
      storageUsed: 2048,
      storageLimit: 8192,
      emailVerified: true,
      billingCycleStart: now,
      createdAt: now,
      updatedAt: now,
    } as any);

    return {
      db,
      sqlite: importedSqlite,
      token: generateToken({
        id: "user-1",
        email: "researcher@example.com",
        tier: "pro",
      }),
      server: await startHttpServer(app),
    };
  }

  it("rejects unauthenticated requests", async () => {
    const { server } = await createAuthApp();

    try {
      const response = await requestJson(server.baseUrl, "/api/auth/me");

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: "Authentication required" });
    } finally {
      await server.close();
    }
  });

  it("returns profile and usage for a valid JWT", async () => {
    const { token, server } = await createAuthApp();

    try {
      const profile = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/auth/me", {
        headers: { authorization: `Bearer ${token}` },
      });
      const usage = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/auth/usage", {
        headers: { authorization: `Bearer ${token}` },
      });

      expect(profile.status).toBe(200);
      expect(profile.body).toMatchObject({
        id: "user-1",
        email: "researcher@example.com",
        tier: "pro",
        tokensUsed: 1250,
        tokenLimit: 5000,
      });
      expect(profile.body).not.toHaveProperty("password");

      expect(usage.status).toBe(200);
      expect(usage.body).toMatchObject({
        tokensUsed: 1250,
        tokenLimit: 5000,
        tokenPercent: 25,
        storageUsed: 2048,
        storageLimit: 8192,
        storagePercent: 25,
        tier: "pro",
      });
      expect(typeof usage.body?.billingCycleStart).toBe("string");
    } finally {
      await server.close();
    }
  });

  it("reserves storage usage with a single conditional update", async () => {
    const { sqlite } = await createAuthApp();
    const { reserveStorageUsage } = await import("../../server/authStorage");

    sqlite
      .prepare("UPDATE users SET storage_used = ?, storage_limit = ? WHERE id = ?")
      .run(7000, 8000, "user-1");

    const results = await Promise.all([
      reserveStorageUsage("user-1", 700),
      reserveStorageUsage("user-1", 700),
    ]);
    const userAfterReserve = sqlite
      .prepare("SELECT storage_used, storage_limit FROM users WHERE id = ?")
      .get("user-1") as { storage_used: number; storage_limit: number };

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      {
        ok: false,
        reason: "limit",
        requestedBytes: 700,
        storageLimit: 8000,
        storageUsed: 7700,
      },
    ]);
    expect(userAfterReserve).toEqual({
      storage_used: 7700,
      storage_limit: 8000,
    });
  });

  it("adopts an existing local user when a new Clerk user signs in with the same email", async () => {
    const { server, sqlite } = await createAuthApp();
    clerkGetAuth.mockReturnValue({ userId: "user_new_clerk_instance" });
    clerkGetUser.mockResolvedValue({
      primaryEmailAddressId: "email_primary",
      emailAddresses: [
        {
          id: "email_primary",
          emailAddress: "Researcher@Example.com",
          verification: { status: "verified" },
        },
      ],
      publicMetadata: {},
    });

    try {
      const profile = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/auth/me");
      const usage = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/auth/usage");
      const usersAfterAuth = sqlite
        .prepare(
          "SELECT id, email, tier, tokens_used, token_limit, storage_limit FROM users ORDER BY email",
        )
        .all() as Array<{
        id: string;
        email: string;
        tier: string;
        tokens_used: number;
        token_limit: number;
        storage_limit: number;
      }>;

      expect(profile.status).toBe(200);
      expect(profile.body).toMatchObject({
        id: "user-1",
        email: "researcher@example.com",
        tier: "pro",
        tokensUsed: 1250,
        tokenLimit: 500_000,
        storageLimit: 524_288_000,
      });

      expect(usage.status).toBe(200);
      expect(usage.body).toMatchObject({
        tokensUsed: 1250,
        tokenLimit: 500_000,
        storageLimit: 524_288_000,
        tier: "pro",
      });

      expect(usersAfterAuth).toEqual([
        {
          id: "user-1",
          email: "researcher@example.com",
          tier: "pro",
          tokens_used: 1250,
          token_limit: 500_000,
          storage_limit: 524_288_000,
        },
      ]);
    } finally {
      await server.close();
    }
  });

  it("claims legacy ownerless user data when a verified Clerk account is resolved", async () => {
    const { server, sqlite } = await createAuthApp();
    const nowMs = new Date("2026-03-01T00:00:00.000Z").getTime();
    sqlite
      .prepare(
        "INSERT INTO documents (id, filename, full_text, upload_date, user_id) VALUES (?, ?, ?, ?, NULL)",
      )
      .run("legacy-doc", "legacy.txt", "legacy source text", nowMs);
    sqlite
      .prepare(
        "INSERT INTO projects (id, name, user_id, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)",
      )
      .run("legacy-project", "Legacy Project", nowMs, nowMs);
    sqlite
      .prepare(
        "INSERT INTO conversations (id, title, model, user_id, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)",
      )
      .run("legacy-conversation", "Legacy Chat", "claude-opus-4-6", nowMs, nowMs);
    sqlite
      .prepare(
        `INSERT INTO web_clips (
          id, user_id, highlighted_text, category, source_url, page_title, created_at
        ) VALUES (?, NULL, ?, ?, ?, ?, ?)`,
      )
      .run("legacy-clip", "legacy highlight", "key_quote", "https://example.com", "Example", nowMs);

    clerkGetAuth.mockReturnValue({ userId: "user_new_clerk_instance" });
    clerkGetUser.mockResolvedValue({
      primaryEmailAddressId: "email_primary",
      emailAddresses: [
        {
          id: "email_primary",
          emailAddress: "Researcher@Example.com",
          verification: { status: "verified" },
        },
      ],
      publicMetadata: {},
    });

    try {
      const profile = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/auth/me");
      const owners = {
        document: sqlite.prepare("SELECT user_id FROM documents WHERE id = ?").get("legacy-doc"),
        project: sqlite.prepare("SELECT user_id FROM projects WHERE id = ?").get("legacy-project"),
        conversation: sqlite
          .prepare("SELECT user_id FROM conversations WHERE id = ?")
          .get("legacy-conversation"),
        webClip: sqlite.prepare("SELECT user_id FROM web_clips WHERE id = ?").get("legacy-clip"),
      } as Record<string, { user_id: string }>;

      expect(profile.status).toBe(200);
      expect(profile.body).toMatchObject({ id: "user-1" });
      expect(owners).toEqual({
        document: { user_id: "user-1" },
        project: { user_id: "user-1" },
        conversation: { user_id: "user-1" },
        webClip: { user_id: "user-1" },
      });
    } finally {
      await server.close();
    }
  });

  it("only claims multi-user legacy data when an owned relationship proves the target user", async () => {
    const { server, sqlite } = await createAuthApp();
    const nowMs = new Date("2026-03-01T00:00:00.000Z").getTime();
    sqlite
      .prepare(
        `INSERT INTO users (
          id, email, username, password, tier, tokens_used, token_limit,
          storage_used, storage_limit, email_verified, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "user-2",
        "other@example.com",
        "other@example.com",
        "",
        "pro",
        0,
        500_000,
        0,
        524_288_000,
        1,
        nowMs,
        nowMs,
      );
    sqlite
      .prepare(
        "INSERT INTO documents (id, filename, full_text, upload_date, user_id) VALUES (?, ?, ?, ?, NULL)",
      )
      .run("linked-doc", "linked.txt", "legacy linked source text", nowMs);
    sqlite
      .prepare(
        "INSERT INTO documents (id, filename, full_text, upload_date, user_id) VALUES (?, ?, ?, ?, NULL)",
      )
      .run("orphan-doc", "orphan.txt", "legacy orphan source text", nowMs);
    sqlite
      .prepare(
        "INSERT INTO projects (id, name, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("owned-project", "Owned Project", "user-1", nowMs, nowMs);
    sqlite
      .prepare(
        "INSERT INTO project_documents (id, project_id, document_id, added_at) VALUES (?, ?, ?, ?)",
      )
      .run("linked-project-doc", "owned-project", "linked-doc", nowMs);
    sqlite
      .prepare(
        "INSERT INTO conversations (id, project_id, title, model, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)",
      )
      .run("linked-conversation", "owned-project", "Legacy Chat", "claude-opus-4-6", nowMs, nowMs);
    sqlite
      .prepare(
        `INSERT INTO web_clips (
          id, user_id, highlighted_text, category, source_url, page_title, project_id, created_at
        ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "linked-clip",
        "legacy highlight",
        "key_quote",
        "https://example.com/linked",
        "Linked",
        "owned-project",
        nowMs,
      );
    sqlite
      .prepare(
        `INSERT INTO web_clips (
          id, user_id, highlighted_text, category, source_url, page_title, created_at
        ) VALUES (?, NULL, ?, ?, ?, ?, ?)`,
      )
      .run(
        "orphan-clip",
        "orphan highlight",
        "key_quote",
        "https://example.com/orphan",
        "Orphan",
        nowMs,
      );

    clerkGetAuth.mockReturnValue({ userId: "user_new_clerk_instance" });
    clerkGetUser.mockResolvedValue({
      primaryEmailAddressId: "email_primary",
      emailAddresses: [
        {
          id: "email_primary",
          emailAddress: "Researcher@Example.com",
          verification: { status: "verified" },
        },
      ],
      publicMetadata: {},
    });

    try {
      const profile = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/auth/me");
      const documentOwners = sqlite
        .prepare("SELECT id, user_id FROM documents WHERE id IN (?, ?) ORDER BY id")
        .all("linked-doc", "orphan-doc") as Array<{ id: string; user_id: string | null }>;
      const conversationOwner = sqlite
        .prepare("SELECT user_id FROM conversations WHERE id = ?")
        .get("linked-conversation") as { user_id: string };
      const clipOwners = sqlite
        .prepare("SELECT id, user_id FROM web_clips WHERE id IN (?, ?) ORDER BY id")
        .all("linked-clip", "orphan-clip") as Array<{ id: string; user_id: string | null }>;

      expect(profile.status).toBe(200);
      expect(profile.body).toMatchObject({ id: "user-1" });
      expect(documentOwners).toEqual([
        { id: "linked-doc", user_id: "user-1" },
        { id: "orphan-doc", user_id: null },
      ]);
      expect(conversationOwner).toEqual({ user_id: "user-1" });
      expect(clipOwners).toEqual([
        { id: "linked-clip", user_id: "user-1" },
        { id: "orphan-clip", user_id: null },
      ]);
    } finally {
      await server.close();
    }
  });

  it("does not adopt an existing local user from an unverified Clerk email", async () => {
    const { server, sqlite } = await createAuthApp();
    clerkGetAuth.mockReturnValue({ userId: "user_unverified_clerk_instance" });
    clerkGetUser.mockResolvedValue({
      primaryEmailAddressId: "email_unverified",
      emailAddresses: [
        {
          id: "email_unverified",
          emailAddress: "Researcher@Example.com",
          verification: { status: "unverified" },
        },
      ],
      publicMetadata: { tier: "max" },
    });

    try {
      const profile = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/auth/me");
      const usersAfterAuth = sqlite
        .prepare("SELECT id, email, tier, tokens_used FROM users ORDER BY email")
        .all() as Array<{ id: string; email: string; tier: string; tokens_used: number }>;

      expect(profile.status).toBe(401);
      expect(profile.body).toEqual({ message: "Authentication failed" });
      expect(usersAfterAuth).toEqual([
        {
          id: "user-1",
          email: "researcher@example.com",
          tier: "pro",
          tokens_used: 1250,
        },
      ]);
    } finally {
      await server.close();
    }
  });

  it("does not adopt an unverified local user from a verified Clerk email", async () => {
    const { server, sqlite } = await createAuthApp();
    sqlite.prepare("UPDATE users SET email_verified = ? WHERE id = ?").run(0, "user-1");
    clerkGetAuth.mockReturnValue({ userId: "user_verified_clerk_instance" });
    clerkGetUser.mockResolvedValue({
      primaryEmailAddressId: "email_verified",
      emailAddresses: [
        {
          id: "email_verified",
          emailAddress: "Researcher@Example.com",
          verification: { status: "verified" },
        },
      ],
      publicMetadata: { tier: "max" },
    });

    try {
      const profile = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/auth/me");
      const existingUser = sqlite
        .prepare("SELECT id, tier, email_verified FROM users WHERE id = ?")
        .get("user-1") as { id: string; tier: string; email_verified: number };

      expect(profile.status).toBe(401);
      expect(profile.body).toEqual({ message: "Authentication failed" });
      expect(existingUser).toEqual({
        id: "user-1",
        tier: "pro",
        email_verified: 0,
      });
    } finally {
      await server.close();
    }
  });

  it("applies token and storage limits from explicit Clerk tiers", async () => {
    const { server, sqlite } = await createAuthApp();

    try {
      clerkGetAuth.mockReturnValue({ userId: "user_new_max" });
      clerkGetUser.mockResolvedValue({
        primaryEmailAddressId: "email_max",
        emailAddresses: [
          {
            id: "email_max",
            emailAddress: "max@example.com",
            verification: { status: "verified" },
          },
        ],
        publicMetadata: { tier: "max" },
      });

      const createdMax = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/auth/me");
      expect(createdMax.status).toBe(200);
      expect(createdMax.body).toMatchObject({
        id: "user_new_max",
        tier: "max",
        tokenLimit: 2_000_000,
        storageLimit: 5_368_709_120,
      });

      clerkGetAuth.mockReturnValue({ userId: "user_recreated_as_max" });
      clerkGetUser.mockResolvedValue({
        primaryEmailAddressId: "email_existing",
        emailAddresses: [
          {
            id: "email_existing",
            emailAddress: "Researcher@Example.com",
            verification: { status: "verified" },
          },
        ],
        publicMetadata: { tier: "max" },
      });

      const migratedMax = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/auth/me",
      );
      const existingUser = sqlite
        .prepare("SELECT id, tier, token_limit, storage_limit FROM users WHERE id = ?")
        .get("user-1") as {
        id: string;
        tier: string;
        token_limit: number;
        storage_limit: number;
      };

      expect(migratedMax.status).toBe(200);
      expect(migratedMax.body).toMatchObject({
        id: "user-1",
        tier: "max",
        tokenLimit: 2_000_000,
        storageLimit: 5_368_709_120,
      });
      expect(existingUser).toEqual({
        id: "user-1",
        tier: "max",
        token_limit: 2_000_000,
        storage_limit: 5_368_709_120,
      });
    } finally {
      await server.close();
    }
  });

  it("does not let stale Clerk tier metadata override Stripe-managed subscriptions", async () => {
    const { server, sqlite } = await createAuthApp();

    try {
      sqlite
        .prepare(
          `UPDATE users
           SET tier = ?, token_limit = ?, storage_limit = ?,
               stripe_customer_id = ?, stripe_subscription_id = ?,
               stripe_price_id = ?, subscription_status = ?
           WHERE id = ?`,
        )
        .run(
          "pro",
          500_000,
          524_288_000,
          "cus_active",
          "sub_active",
          "price_pro",
          "active",
          "user-1",
        );
      clerkGetAuth.mockReturnValue({ userId: "user_new_clerk_instance" });
      clerkGetUser.mockResolvedValue({
        primaryEmailAddressId: "email_existing",
        emailAddresses: [
          {
            id: "email_existing",
            emailAddress: "Researcher@Example.com",
            verification: { status: "verified" },
          },
        ],
        publicMetadata: { tier: "free" },
      });

      const activeProfile = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/auth/me",
      );
      expect(activeProfile.status).toBe(200);
      expect(activeProfile.body).toMatchObject({
        id: "user-1",
        tier: "pro",
        tokenLimit: 500_000,
        storageLimit: 524_288_000,
      });

      sqlite
        .prepare(
          `UPDATE users
           SET tier = ?, token_limit = ?, storage_limit = ?,
               stripe_customer_id = ?, stripe_subscription_id = ?,
               stripe_price_id = ?, subscription_status = ?
           WHERE id = ?`,
        )
        .run(
          "free",
          50_000,
          52_428_800,
          "cus_canceled",
          "sub_canceled",
          "price_pro",
          "canceled",
          "user-1",
        );
      clerkGetUser.mockResolvedValue({
        primaryEmailAddressId: "email_existing",
        emailAddresses: [
          {
            id: "email_existing",
            emailAddress: "Researcher@Example.com",
            verification: { status: "verified" },
          },
        ],
        publicMetadata: { tier: "pro" },
      });

      const canceledProfile = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/auth/me",
      );
      expect(canceledProfile.status).toBe(200);
      expect(canceledProfile.body).toMatchObject({
        id: "user-1",
        tier: "free",
        tokenLimit: 50_000,
        storageLimit: 52_428_800,
      });
    } finally {
      await server.close();
    }
  });

  it("accepts valid API keys and rejects invalid ones", async () => {
    const { db, server } = await createAuthApp();
    const { apiKeys } = await import("../../shared/schema");
    const rawApiKey = "sk_sm_test_valid_api_key";
    const now = Math.floor(Date.now() / 1000);

    await db.insert(apiKeys).values({
      id: "key-1",
      userId: "user-1",
      label: "Integration key",
      keyHash: createHash("sha256").update(rawApiKey).digest("hex"),
      keyPrefix: rawApiKey.slice(0, 12),
      createdAt: now,
    } as any);

    try {
      const validApiKeyProfile = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/auth/me",
        {
          headers: { authorization: `Bearer ${rawApiKey}` },
        },
      );

      expect(validApiKeyProfile.status).toBe(200);
      expect(validApiKeyProfile.body).toMatchObject({
        id: "user-1",
        email: "researcher@example.com",
      });

      const invalidApiKeyProfile = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/auth/me",
        {
          headers: { authorization: "Bearer sk_sm_invalid_api_key" },
        },
      );

      expect(invalidApiKeyProfile.status).toBe(401);
      expect(invalidApiKeyProfile.body).toEqual({ message: "Invalid API key" });
    } finally {
      await server.close();
    }
  });

  it("creates, lists, and revokes API keys for the authenticated user", async () => {
    const { server, token } = await createAuthApp();

    try {
      const created = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/auth/api-keys",
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: { label: "Chrome Extension" },
        },
      );

      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        id: expect.any(String),
        label: "Chrome Extension",
        keyPrefix: expect.stringMatching(/^sk_sm_/),
        key: expect.stringMatching(/^sk_sm_/),
      });

      const listBeforeRevoke = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/auth/api-keys",
        {
          headers: { authorization: `Bearer ${token}` },
        },
      );

      expect(listBeforeRevoke.status).toBe(200);
      expect(listBeforeRevoke.body).toEqual({
        apiKeys: [
          expect.objectContaining({
            id: created.body?.id,
            label: "Chrome Extension",
            keyPrefix: created.body?.keyPrefix,
          }),
        ],
      });

      const keyProfile = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/auth/me",
        {
          headers: { authorization: `Bearer ${created.body?.key}` },
        },
      );

      expect(keyProfile.status).toBe(200);
      expect(keyProfile.body).toMatchObject({
        id: "user-1",
        email: "researcher@example.com",
      });

      const revoke = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        `/api/auth/api-keys/${created.body?.id}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}` },
        },
      );

      expect(revoke.status).toBe(204);

      const listAfterRevoke = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/auth/api-keys",
        {
          headers: { authorization: `Bearer ${token}` },
        },
      );

      expect(listAfterRevoke.status).toBe(200);
      expect(listAfterRevoke.body).toEqual({ apiKeys: [] });

      const revokedKeyProfile = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/auth/me",
        {
          headers: { authorization: `Bearer ${created.body?.key}` },
        },
      );

      expect(revokedKeyProfile.status).toBe(401);
      expect(revokedKeyProfile.body).toEqual({ message: "Invalid API key" });
    } finally {
      await server.close();
    }
  });

  it("allows MCP read tokens for reads and denies writes without write scope", async () => {
    const { server, sqlite } = await createAuthApp();
    const rawMcpToken = "mcp_sm_test_read_only_token";
    const now = Math.floor(Date.now() / 1000);

    sqlite
      .prepare(
        `INSERT INTO mcp_oauth_clients (
         client_id,
         client_secret_hash,
         client_name,
         redirect_uris,
         grant_types,
         response_types,
         token_endpoint_auth_method,
         created_at
       ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "mcp-client-readonly",
        "Read Only Client",
        JSON.stringify(["http://localhost/callback"]),
        JSON.stringify(["authorization_code"]),
        JSON.stringify(["code"]),
        "none",
        now,
      );
    sqlite
      .prepare(
        `INSERT INTO mcp_tokens (
         id,
         user_id,
         client_id,
         key_hash,
         key_prefix,
         scope,
         expires_at,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "mcp-token-readonly",
        "user-1",
        "mcp-client-readonly",
        createHash("sha256").update(rawMcpToken).digest("hex"),
        rawMcpToken.slice(0, 14),
        "read",
        now + 3600,
        now,
      );

    try {
      const readResponse = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/auth/me",
        {
          headers: { authorization: `Bearer ${rawMcpToken}` },
        },
      );
      const readPostSearchResponse = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/project-documents/project-doc-1/search",
        {
          method: "POST",
          headers: { authorization: `Bearer ${rawMcpToken}` },
          body: { query: "find this" },
        },
      );
      const readProjectSearchResponse = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/projects/project-1/search",
        {
          method: "POST",
          headers: { authorization: `Bearer ${rawMcpToken}` },
          body: { query: "find this" },
        },
      );
      const writeResponse = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/auth/api-keys",
        {
          method: "POST",
          headers: { authorization: `Bearer ${rawMcpToken}` },
          body: { label: "Should fail" },
        },
      );

      expect(readResponse.status).toBe(200);
      expect(readPostSearchResponse.status).toBe(200);
      expect(readPostSearchResponse.body).toEqual({ ok: true });
      expect(readProjectSearchResponse.status).toBe(200);
      expect(readProjectSearchResponse.body).toEqual({ ok: true });
      expect(writeResponse.status).toBe(403);
      expect(writeResponse.body).toEqual({
        message: "OAuth token lacks required scope",
        requiredScope: "write",
      });
    } finally {
      await server.close();
    }
  });

  it("does not let write-scoped MCP tokens mint unrestricted API keys", async () => {
    const { server, sqlite } = await createAuthApp();
    const rawMcpToken = "mcp_sm_test_write_scoped_token";
    const now = Math.floor(Date.now() / 1000);

    sqlite
      .prepare(
        `INSERT INTO mcp_oauth_clients (
         client_id,
         client_secret_hash,
         client_name,
         redirect_uris,
         grant_types,
         response_types,
         token_endpoint_auth_method,
         created_at
       ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "mcp-client-write",
        "Write Client",
        JSON.stringify(["http://localhost/callback"]),
        JSON.stringify(["authorization_code"]),
        JSON.stringify(["code"]),
        "none",
        now,
      );
    sqlite
      .prepare(
        `INSERT INTO mcp_tokens (
         id,
         user_id,
         client_id,
         key_hash,
         key_prefix,
         scope,
         expires_at,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "mcp-token-write",
        "user-1",
        "mcp-client-write",
        createHash("sha256").update(rawMcpToken).digest("hex"),
        rawMcpToken.slice(0, 14),
        "read write",
        now + 3600,
        now,
      );

    try {
      const createKeyResponse = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        "/api/auth/api-keys",
        {
          method: "POST",
          headers: { authorization: `Bearer ${rawMcpToken}` },
          body: { label: "Should fail" },
        },
      );

      expect(createKeyResponse.status).toBe(403);
      expect(createKeyResponse.body).toEqual({
        message: "API keys and OAuth tokens cannot manage API keys",
      });
    } finally {
      await server.close();
    }
  });
});
