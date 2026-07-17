import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalRequest } from "../../server/canonicalRequest";
import { paidInstagramEntry } from "../../server/paidInstagramEntry";
import { startHttpServer } from "./helpers/http";

describe("paid Instagram server entry", () => {
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
    app.use(paidInstagramEntry);
    app.all("*", (req, res) => res.status(200).send(`spa:${req.method}:${req.originalUrl}`));
    return startHttpServer(app);
  }

  async function request(baseUrl: string, path: string, init: RequestInit = {}) {
    return fetch(`${baseUrl}${path}`, {
      redirect: "manual",
      ...init,
      headers: {
        host: "scholarmark.ai",
        "x-forwarded-host": "scholarmark.ai",
        "x-forwarded-proto": "https",
        ...init.headers,
      },
    });
  }

  it("redirects the real paid Instagram campaign before the SPA while preserving attribution", async () => {
    const server = await startApp();
    try {
      const response = await request(
        server.baseUrl,
        "/?utm_source=ig&utm_medium=paid&utm_campaign=120254753679600309&utm_content=120254753681570309&fbclid=abc123&ignored=secret",
      );

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        "/sign-up?redirect_url=%2Fdashboard&utm_source=ig&utm_medium=paid&utm_campaign=120254753679600309&utm_content=120254753681570309&fbclid=abc123&embedded_auth=1&sm_direct_signup=1",
      );
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("pragma")).toBe("no-cache");
    } finally {
      await server.close();
    }
  });

  it.each([
    ["GET", "/start?utm_source=Instagram&utm_medium=paid_social&utm_campaign=summer"],
    ["HEAD", "/?utm_source=instagram.com&utm_medium=CPC&utm_campaign=summer"],
  ])("redirects normalized %s campaign entry %s", async (method, path) => {
    const server = await startApp();
    try {
      const response = await request(server.baseUrl, path, { method });
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toContain("/sign-up?redirect_url=%2Fdashboard");
      expect(response.headers.get("location")).toContain("embedded_auth=1");
      expect(response.headers.get("location")).toContain("sm_direct_signup=1");
    } finally {
      await server.close();
    }
  });

  it("canonicalizes www/HTTP first, preserves attribution, then redirects to signup", async () => {
    const server = await startApp();
    const campaignPath = "/?utm_source=ig&utm_medium=paid&utm_campaign=canonical";
    try {
      const canonical = await request(server.baseUrl, campaignPath, {
        headers: {
          host: "www.scholarmark.ai",
          "x-forwarded-host": "www.scholarmark.ai",
          "x-forwarded-proto": "http",
        },
      });
      expect(canonical.status).toBe(308);
      expect(canonical.headers.get("location")).toBe(`https://scholarmark.ai${campaignPath}`);

      const signup = await request(server.baseUrl, campaignPath);
      expect(signup.status).toBe(302);
      expect(signup.headers.get("location")).toContain("utm_campaign=canonical");
      expect(signup.headers.get("location")).toContain("sm_direct_signup=1");
    } finally {
      await server.close();
    }
  });

  it.each([
    ["organic Instagram", "/?utm_source=ig&utm_medium=organic"],
    ["Facebook", "/?utm_source=facebook&utm_medium=paid"],
    ["landing opt-out", "/?utm_source=ig&utm_medium=paid&sm_landing=1"],
    ["non-entry route", "/pricing?utm_source=ig&utm_medium=paid"],
  ])("leaves %s traffic on the requested page", async (_label, path) => {
    const server = await startApp();
    try {
      const response = await request(server.baseUrl, path);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(`spa:GET:${path}`);
    } finally {
      await server.close();
    }
  });

  it("does not redirect internal hosts or non-navigation requests", async () => {
    const server = await startApp();
    try {
      const internal = await request(server.baseUrl, "/?utm_source=ig&utm_medium=paid", {
        headers: {
          host: "app.scholarmark.ai",
          "x-forwarded-host": "app.scholarmark.ai",
          "x-forwarded-proto": "https",
        },
      });
      expect(internal.status).toBe(200);

      const post = await request(server.baseUrl, "/?utm_source=ig&utm_medium=paid", {
        method: "POST",
      });
      expect(post.status).toBe(200);
      expect(await post.text()).toContain("spa:POST:");
    } finally {
      await server.close();
    }
  });
});
