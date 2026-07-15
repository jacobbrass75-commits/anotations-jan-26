import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalRequest } from "../../server/canonicalRequest";
import { startHttpServer } from "./helpers/http";

describe("canonical public-site requests", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function startApp() {
    const app = express();
    app.set("trust proxy", true);
    app.use(canonicalRequest);
    app.get("*", (req, res) => res.status(200).send(`ok:${req.originalUrl}`));
    return startHttpServer(app);
  }

  async function request(
    baseUrl: string,
    path: string,
    host: string,
    forwardedProto: "http" | "https",
  ) {
    return fetch(`${baseUrl}${path}`, {
      redirect: "manual",
      headers: { host, "x-forwarded-host": host, "x-forwarded-proto": forwardedProto },
    });
  }

  it.each([
    ["scholarmark.ai", "http", "/", "https://scholarmark.ai/"],
    ["www.scholarmark.ai", "http", "/pricing?utm_source=ig", "https://scholarmark.ai/pricing?utm_source=ig"],
    ["www.scholarmark.ai", "https", "/?utm_campaign=summer", "https://scholarmark.ai/?utm_campaign=summer"],
  ] as const)(
    "redirects %s over %s to one canonical HTTPS URL while preserving the path and query",
    async (host, protocol, path, expectedLocation) => {
      const server = await startApp();
      try {
        const response = await request(server.baseUrl, path, host, protocol);
        expect(response.status).toBe(308);
        expect(response.headers.get("location")).toBe(expectedLocation);
      } finally {
        await server.close();
      }
    },
  );

  it("serves the canonical HTTPS hostname without another redirect", async () => {
    const server = await startApp();
    try {
      const response = await request(
        server.baseUrl,
        "/?utm_source=instagram&utm_content=reel",
        "scholarmark.ai",
        "https",
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("ok:/?utm_source=instagram&utm_content=reel");
    } finally {
      await server.close();
    }
  });

  it("does not rewrite API or internal hosts", async () => {
    const server = await startApp();
    try {
      const response = await request(server.baseUrl, "/health", "app.scholarmark.ai", "http");
      expect(response.status).toBe(200);
    } finally {
      await server.close();
    }
  });
});
