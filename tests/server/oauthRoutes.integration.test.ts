import express from "express";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapTempWorkspace } from "./helpers/bootstrapTempWorkspace";
import { requestJson, startHttpServer } from "./helpers/http";

const { clerkGetAuth, clerkGetUser } = vi.hoisted(() => ({
  clerkGetAuth: vi.fn(() => ({ userId: "oauth-user" })),
  clerkGetUser: vi.fn(),
}));

vi.mock("@clerk/express", () => ({
  getAuth: clerkGetAuth,
  clerkClient: {
    users: {
      getUser: clerkGetUser,
    },
  },
}));

describe("OAuth route hardening", () => {
  let tempDir = "";
  let sqlite: {
    close: () => void;
    prepare: (sql: string) => {
      run: (...args: unknown[]) => unknown;
      all: (...args: unknown[]) => unknown[];
    };
  } | null = null;
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-oauth-routes-"));
    vi.resetModules();
    vi.clearAllMocks();
    process.chdir(tempDir);
    await bootstrapTempWorkspace(tempDir);
    clerkGetAuth.mockReturnValue({ userId: "oauth-user" });
    clerkGetUser.mockResolvedValue({
      emailAddresses: [{ emailAddress: "oauth@example.com" }],
      publicMetadata: { tier: "pro" },
    });
  });

  afterEach(async () => {
    sqlite?.close();
    sqlite = null;
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createOAuthApp() {
    const { sqlite: importedSqlite } = await import("../../server/db");
    const { registerOAuthRoutes } = await import("../../server/oauthRoutes");
    sqlite = importedSqlite;

    const app = express();
    app.set("trust proxy", true);
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    registerOAuthRoutes(app);

    return startHttpServer(app);
  }

  async function registerClient(baseUrl: string) {
    const response = await requestJson<Record<string, unknown>>(baseUrl, "/oauth/register", {
      method: "POST",
      body: {
        client_name: "Test Client",
        redirect_uris: ["http://localhost/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
    });

    expect(response.status).toBe(201);
    return String(response.body?.client_id);
  }

  function authorizePath(clientId: string, overrides: Record<string, string> = {}) {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: "http://localhost/callback",
      response_type: "code",
      scope: "read write",
      state: "state-1",
      code_challenge: "challenge",
      code_challenge_method: "S256",
      ...overrides,
    });
    return `/oauth/authorize?${params.toString()}`;
  }

  function fetchInputUrl(input: RequestInfo | URL): string {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.toString();
    return input.url;
  }

  it("rejects GET authorization approvals", async () => {
    const server = await createOAuthApp();

    try {
      const clientId = await registerClient(server.baseUrl);
      const response = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        authorizePath(clientId, { decision: "approve" }),
      );

      expect(response.status).toBe(405);
      expect(response.body).toEqual({
        error: "invalid_request",
        error_description: "Authorization decisions must be submitted with POST",
      });
    } finally {
      await server.close();
    }
  });

  it("requires a consent nonce for POST authorization decisions", async () => {
    const server = await createOAuthApp();

    try {
      const clientId = await registerClient(server.baseUrl);
      const response = await requestJson<Record<string, unknown>>(server.baseUrl, "/oauth/authorize", {
        method: "POST",
        headers: { origin: server.baseUrl },
        body: {
          client_id: clientId,
          redirect_uri: "http://localhost/callback",
          response_type: "code",
          scope: "read write",
          state: "state-1",
          code_challenge: "challenge",
          code_challenge_method: "S256",
          decision: "approve",
        },
      });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: "invalid_request",
        error_description: "Invalid authorization consent token",
      });
    } finally {
      await server.close();
    }
  });

  it("blocks private and localhost dynamic client metadata URLs", async () => {
    const server = await createOAuthApp();

    try {
      for (const clientId of [
        "https://127.0.0.1/oauth-client.json",
        "https://localhost/oauth-client.json",
        "https://[::ffff:127.0.0.1]/oauth-client.json",
        "https://[::ffff:10.0.0.1]/oauth-client.json",
        "https://[::ffff:c0a8:0001]/oauth-client.json",
      ]) {
        const response = await requestJson<Record<string, unknown>>(server.baseUrl, authorizePath(clientId));

        expect(response.status).toBe(400);
        expect(response.body).toEqual({
          error: "invalid_client",
          error_description: "Unknown client_id",
        });
      }
    } finally {
      await server.close();
    }
  });

  it("blocks dynamic client metadata redirects to private addresses", async () => {
    const server = await createOAuthApp();
    const clientId = "https://93.184.216.34/oauth-client.json";
    const metadataFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (fetchInputUrl(input) === clientId) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://127.0.0.1/oauth-client.json" },
        });
      }

      return originalFetch(input, init);
    });
    globalThis.fetch = metadataFetch as typeof fetch;

    try {
      const response = await requestJson<Record<string, unknown>>(server.baseUrl, authorizePath(clientId));
      const metadataCalls = metadataFetch.mock.calls.filter(([input]) => fetchInputUrl(input) === clientId);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: "invalid_client",
        error_description: "Unknown client_id",
      });
      expect(metadataCalls).toHaveLength(1);
      expect(metadataCalls[0]?.[1]).toMatchObject({ redirect: "manual" });
    } finally {
      await server.close();
    }
  });

  it("does not adopt an existing local user from an unverified Clerk email during authorization", async () => {
    const server = await createOAuthApp();
    const now = Date.now();
    sqlite
      ?.prepare(
        `INSERT INTO users (
          id,
          email,
          username,
          password,
          tier,
          tokens_used,
          token_limit,
          storage_used,
          storage_limit,
          email_verified,
          billing_cycle_start,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "existing-oauth-user",
        "oauth@example.com",
        "oauth@example.com",
        "",
        "pro",
        100,
        500_000,
        0,
        524_288_000,
        1,
        now,
        now,
        now,
      );
    clerkGetAuth.mockReturnValue({ userId: "unverified-oauth-user" });
    clerkGetUser.mockResolvedValue({
      primaryEmailAddressId: "email_unverified",
      emailAddresses: [
        {
          id: "email_unverified",
          emailAddress: "oauth@example.com",
          verification: { status: "unverified" },
        },
      ],
      publicMetadata: { tier: "max" },
    });

    try {
      const clientId = await registerClient(server.baseUrl);
      const response = await requestJson<Record<string, unknown>>(server.baseUrl, authorizePath(clientId));
      const usersAfterAuth = sqlite
        ?.prepare("SELECT id, tier, email_verified FROM users WHERE email = ?")
        .all("oauth@example.com");

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: "access_denied",
        error_description: "Clerk email must be verified before authorization",
      });
      expect(usersAfterAuth).toEqual([
        {
          id: "existing-oauth-user",
          tier: "pro",
          email_verified: 1,
        },
      ]);
    } finally {
      await server.close();
    }
  });

  it("does not adopt an unverified local user from a verified Clerk email during authorization", async () => {
    const server = await createOAuthApp();
    const now = Date.now();
    sqlite
      ?.prepare(
        `INSERT INTO users (
          id,
          email,
          username,
          password,
          tier,
          tokens_used,
          token_limit,
          storage_used,
          storage_limit,
          email_verified,
          billing_cycle_start,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "existing-unverified-oauth-user",
        "oauth-unverified-local@example.com",
        "oauth-unverified-local@example.com",
        "",
        "pro",
        100,
        500_000,
        0,
        524_288_000,
        0,
        now,
        now,
        now,
      );
    clerkGetAuth.mockReturnValue({ userId: "verified-oauth-user" });
    clerkGetUser.mockResolvedValue({
      primaryEmailAddressId: "email_verified",
      emailAddresses: [
        {
          id: "email_verified",
          emailAddress: "oauth-unverified-local@example.com",
          verification: { status: "verified" },
        },
      ],
      publicMetadata: { tier: "max" },
    });

    try {
      const clientId = await registerClient(server.baseUrl);
      const response = await requestJson<Record<string, unknown>>(server.baseUrl, authorizePath(clientId));
      const usersAfterAuth = sqlite
        ?.prepare("SELECT id, tier, email_verified FROM users WHERE email = ?")
        .all("oauth-unverified-local@example.com");

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: "access_denied",
        error_description: "Clerk email must be verified before authorization",
      });
      expect(usersAfterAuth).toEqual([
        {
          id: "existing-unverified-oauth-user",
          tier: "pro",
          email_verified: 0,
        },
      ]);
    } finally {
      await server.close();
    }
  });

  it("rejects unknown OAuth scopes instead of widening access", async () => {
    const server = await createOAuthApp();

    try {
      const clientId = await registerClient(server.baseUrl);
      const response = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        authorizePath(clientId, { scope: "read admin" }),
      );

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: "invalid_request",
        error_description: "Unsupported scope: admin",
      });
    } finally {
      await server.close();
    }
  });

  it("does not let forwarded IP spoofing bypass OAuth rate limits", async () => {
    const server = await createOAuthApp();

    try {
      const statuses: number[] = [];
      for (let index = 0; index < 61; index += 1) {
        const response = await requestJson<Record<string, unknown>>(server.baseUrl, "/oauth/register", {
          method: "POST",
          headers: { "x-forwarded-for": `198.51.100.${index}, 203.0.113.10` },
          body: {
            client_name: `Rate Limit Client ${index}`,
            redirect_uris: ["http://localhost/callback"],
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: "none",
          },
        });
        statuses.push(response.status);
      }

      expect(statuses.slice(0, 60)).toEqual(Array(60).fill(201));
      expect(statuses[60]).toBe(429);
    } finally {
      await server.close();
    }
  });

  it("keeps separate OAuth rate buckets for real clients behind a trusted proxy", async () => {
    const server = await createOAuthApp();

    async function registerFromForwardedIp(clientIp: string, index: number) {
      return requestJson<Record<string, unknown>>(server.baseUrl, "/oauth/register", {
        method: "POST",
        headers: { "x-forwarded-for": clientIp },
        body: {
          client_name: `Forwarded Client ${clientIp} ${index}`,
          redirect_uris: ["http://localhost/callback"],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        },
      });
    }

    try {
      const firstClientStatuses: number[] = [];
      for (let index = 0; index < 60; index += 1) {
        const response = await registerFromForwardedIp("198.51.100.20", index);
        firstClientStatuses.push(response.status);
      }
      const secondClientResponse = await registerFromForwardedIp("198.51.100.21", 0);
      const firstClientOverLimitResponse = await registerFromForwardedIp("198.51.100.20", 60);

      expect(firstClientStatuses).toEqual(Array(60).fill(201));
      expect(secondClientResponse.status).toBe(201);
      expect(firstClientOverLimitResponse.status).toBe(429);
    } finally {
      await server.close();
    }
  });
});
