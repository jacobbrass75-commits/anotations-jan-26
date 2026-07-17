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

  it.each([
    [
      "GET",
      "/?utm_source=ig&utm_medium=paid&utm_campaign=120254753679600309&utm_content=120254753681570309&fbclid=abc123&ignored=secret",
    ],
    ["GET", "/start?utm_source=Instagram&utm_medium=paid_social&utm_campaign=summer"],
    ["HEAD", "/?utm_source=instagram.com&utm_medium=CPC&utm_campaign=summer"],
  ])("serves the campaign landing page for default %s entry %s", async (method, path) => {
    const server = await startApp();
    try {
      const response = await request(server.baseUrl, path, { method });

      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      if (method !== "HEAD") {
        expect(await response.text()).toBe(`spa:${method}:${path}`);
      }
    } finally {
      await server.close();
    }
  });

  it.each([
    [
      "GET",
      "/start?utm_source=Instagram&utm_medium=paid_social&utm_campaign=summer&sm_direct_signup=1",
      "/sign-up?redirect_url=%2Fdashboard&utm_source=Instagram&utm_medium=paid_social&utm_campaign=summer&embedded_auth=1&sm_direct_signup=1",
    ],
    [
      "HEAD",
      "/?utm_source=instagram.com&utm_medium=CPC&utm_campaign=summer&sm_direct_signup=1",
      "/sign-up?redirect_url=%2Fdashboard&utm_source=instagram.com&utm_medium=CPC&utm_campaign=summer&embedded_auth=1&sm_direct_signup=1",
    ],
  ])("redirects explicitly opted-in %s campaign entry %s", async (method, path, location) => {
    const server = await startApp();
    try {
      const response = await request(server.baseUrl, path, { method });
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(location);
    } finally {
      await server.close();
    }
  });

  it("canonicalizes www/HTTP first and keeps the canonical paid campaign on its landing page", async () => {
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

      const landing = await request(server.baseUrl, campaignPath);
      expect(landing.status).toBe(200);
      expect(landing.headers.get("location")).toBeNull();
      expect(await landing.text()).toBe(`spa:GET:${campaignPath}`);
    } finally {
      await server.close();
    }
  });

  it.each([
    ["organic Instagram", "/?utm_source=ig&utm_medium=organic&sm_direct_signup=1"],
    ["Facebook", "/?utm_source=facebook&utm_medium=paid&sm_direct_signup=1"],
    ["landing opt-out", "/?utm_source=ig&utm_medium=paid&sm_direct_signup=1&sm_landing=1"],
    ["non-entry route", "/pricing?utm_source=ig&utm_medium=paid&sm_direct_signup=1"],
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
      const internal = await request(
        server.baseUrl,
        "/?utm_source=ig&utm_medium=paid&sm_direct_signup=1",
        {
          headers: {
            host: "app.scholarmark.ai",
            "x-forwarded-host": "app.scholarmark.ai",
            "x-forwarded-proto": "https",
          },
        },
      );
      expect(internal.status).toBe(200);

      const post = await request(
        server.baseUrl,
        "/?utm_source=ig&utm_medium=paid&sm_direct_signup=1",
        { method: "POST" },
      );
      expect(post.status).toBe(200);
      expect(await post.text()).toContain("spa:POST:");
    } finally {
      await server.close();
    }
  });
});
