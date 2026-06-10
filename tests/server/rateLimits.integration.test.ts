import express from "express";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapTempWorkspace } from "./helpers/bootstrapTempWorkspace";
import { startHttpServer } from "./helpers/http";

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

describe("rate limit integration", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-rate-limits-"));
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

  async function createRateLimitApp() {
    const { sqlite: importedSqlite } = await import("../../server/db");
    const { registerAuthRoutes } = await import("../../server/authRoutes");

    sqlite = importedSqlite;

    const app = express();
    app.use(express.json());
    registerAuthRoutes(app);

    return startHttpServer(app);
  }

  it("returns 429 and standard headers after auth limit is exceeded", async () => {
    const server = await createRateLimitApp();

    try {
      let response = new Response();
      for (let index = 0; index < 20; index += 1) {
        response = await fetch(`${server.baseUrl}/api/auth/me`);
        expect(response.status).toBe(401);
      }

      response = await fetch(`${server.baseUrl}/api/auth/me`);

      expect(response.status).toBe(429);
      expect(response.headers.get("ratelimit-limit")).toBe("20");
      expect(response.headers.get("ratelimit-remaining")).toBe("0");
      expect(response.headers.get("ratelimit-reset")).toMatch(/^\d+$/);
      expect(response.headers.get("ratelimit-policy")).toContain("20;w=900");
    } finally {
      await server.close();
    }
  });
});
