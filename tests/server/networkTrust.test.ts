import express, { type Express, type Request } from "express";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRUSTED_PROXY_CIDRS,
  getAppTrustProxySetting,
  resolveListenHost,
} from "../../server/networkTrust";
import { startHttpServer } from "./helpers/http";

// Documentation-range client addresses (RFC 5737) and a Cloudflare edge address.
const REAL_CLIENT = "203.0.113.7";
const SPOOFED_CLIENT = "198.51.100.66";
const DIRECT_ATTACKER = "203.0.113.50";
const CLOUDFLARE_EDGE = "104.16.1.2";
const CLOUDFLARE_EDGE_V6 = "2606:4700:10::6816:102";

function createTrustApp(trustProxy: unknown = getAppTrustProxySetting()): Express {
  const app = express();
  app.set("trust proxy", trustProxy);
  return app;
}

/**
 * Resolves Express's proxy-derived request properties for a given TCP peer.
 * A loopback HTTP server cannot present an arbitrary peer address, so this
 * drives Express's own request getters with a stand-in socket.
 */
function resolveRequest(
  app: Express,
  peer: string,
  headers: Record<string, string>,
): Pick<Request, "ip" | "ips" | "protocol" | "secure" | "hostname"> {
  const socket = { remoteAddress: peer, encrypted: false };
  const req = Object.create(app.request) as Request;
  Object.assign(req, {
    app,
    headers: Object.fromEntries(
      Object.entries({ host: "127.0.0.1:5001", ...headers }).map(([key, value]) => [
        key.toLowerCase(),
        value,
      ]),
    ),
    socket,
    connection: socket,
  });

  return {
    ip: req.ip,
    ips: req.ips,
    protocol: req.protocol,
    secure: req.secure,
    hostname: req.hostname,
  };
}

describe("app trust proxy topology", () => {
  const app = createTrustApp();

  it("uses the client nginx saw for ordinary nginx traffic", () => {
    const resolved = resolveRequest(app, "127.0.0.1", {
      "x-forwarded-for": REAL_CLIENT,
      "x-forwarded-proto": "https",
      "x-forwarded-host": "app.scholarmark.ai",
    });

    expect(resolved.ip).toBe(REAL_CLIENT);
    expect(resolved.protocol).toBe("https");
    expect(resolved.secure).toBe(true);
    expect(resolved.hostname).toBe("app.scholarmark.ai");
  });

  it("skips the Cloudflare edge hop for nginx + Cloudflare traffic", () => {
    expect(
      resolveRequest(app, "127.0.0.1", {
        "x-forwarded-for": `${REAL_CLIENT}, ${CLOUDFLARE_EDGE}`,
      }).ip,
    ).toBe(REAL_CLIENT);

    expect(
      resolveRequest(app, "127.0.0.1", {
        "x-forwarded-for": `${REAL_CLIENT}, ${CLOUDFLARE_EDGE_V6}`,
      }).ip,
    ).toBe(REAL_CLIENT);
  });

  it("ignores an attacker-added leftmost X-Forwarded-For entry behind Cloudflare", () => {
    const resolved = resolveRequest(app, "127.0.0.1", {
      "x-forwarded-for": `${SPOOFED_CLIENT}, ${REAL_CLIENT}, ${CLOUDFLARE_EDGE}`,
    });

    expect(resolved.ip).toBe(REAL_CLIENT);
    // req.ips stops at the first untrusted hop, so the spoofed entry is dropped.
    expect(resolved.ips).toEqual([REAL_CLIENT, CLOUDFLARE_EDGE]);
  });

  it("does not let a client that reaches nginx directly forge a Cloudflare hop", () => {
    // nginx appends the real peer last, so a forged Cloudflare entry stays left of it.
    const resolved = resolveRequest(app, "127.0.0.1", {
      "x-forwarded-for": `${SPOOFED_CLIENT}, ${CLOUDFLARE_EDGE}, ${DIRECT_ATTACKER}`,
    });

    expect(resolved.ip).toBe(DIRECT_ATTACKER);
  });

  it("ignores forwarded headers from an untrusted direct peer", () => {
    const resolved = resolveRequest(app, DIRECT_ATTACKER, {
      "x-forwarded-for": `${SPOOFED_CLIENT}, ${CLOUDFLARE_EDGE}`,
      "x-forwarded-proto": "https",
      "x-forwarded-host": "scholarmark.ai",
    });

    expect(resolved.ip).toBe(DIRECT_ATTACKER);
    expect(resolved.ips).toEqual([]);
    expect(resolved.protocol).toBe("http");
    expect(resolved.secure).toBe(false);
    expect(resolved.hostname).toBe("127.0.0.1");
  });

  it("treats IPv4-mapped peers by their IPv4 address", () => {
    expect(resolveRequest(app, "::ffff:127.0.0.1", { "x-forwarded-for": REAL_CLIENT }).ip).toBe(
      REAL_CLIENT,
    );
    expect(
      resolveRequest(app, `::ffff:${DIRECT_ATTACKER}`, { "x-forwarded-for": SPOOFED_CLIENT }).ip,
    ).toBe(`::ffff:${DIRECT_ATTACKER}`);
  });

  it("differs from trusting every hop, which returns the spoofed leftmost entry", () => {
    const trustAll = createTrustApp(true);

    expect(
      resolveRequest(trustAll, DIRECT_ATTACKER, { "x-forwarded-for": SPOOFED_CLIENT }).ip,
    ).toBe(SPOOFED_CLIENT);
  });

  it("trusts exactly the shared loopback and Cloudflare list", () => {
    expect(getAppTrustProxySetting()).toEqual([...DEFAULT_TRUSTED_PROXY_CIDRS]);
    expect(DEFAULT_TRUSTED_PROXY_CIDRS).toEqual(
      expect.arrayContaining(["127.0.0.1/32", "::1/128", "104.16.0.0/13", "2606:4700::/32"]),
    );
    expect(DEFAULT_TRUSTED_PROXY_CIDRS.some((cidr) => cidr.startsWith("::ffff:"))).toBe(false);
  });
});

describe("app trust proxy over a loopback socket", () => {
  it("keeps per-client rate limit buckets when the leftmost X-Forwarded-For entry rotates", async () => {
    const { authLimiter } = await import("../../server/rateLimits");
    const app = createTrustApp();
    app.post("/limited", authLimiter, (req, res) => {
      res.json({ ip: req.ip });
    });
    const server = await startHttpServer(app);

    async function post(forwardedFor: string) {
      return fetch(`${server.baseUrl}/limited`, {
        method: "POST",
        headers: { "x-forwarded-for": forwardedFor },
      });
    }

    try {
      const statuses: number[] = [];
      let lastIp: unknown = null;
      for (let index = 0; index < 21; index += 1) {
        const response = await post(`198.51.100.${index}, ${REAL_CLIENT}, ${CLOUDFLARE_EDGE}`);
        statuses.push(response.status);
        if (response.status === 200) {
          lastIp = ((await response.json()) as { ip: unknown }).ip;
        } else {
          await response.text();
        }
      }

      expect(lastIp).toBe(REAL_CLIENT);
      expect(statuses.slice(0, 20)).toEqual(Array(20).fill(200));
      expect(statuses[20]).toBe(429);

      const otherClient = await post(`203.0.113.8, ${CLOUDFLARE_EDGE}`);
      expect(otherClient.status).toBe(200);
      expect(((await otherClient.json()) as { ip: unknown }).ip).toBe("203.0.113.8");
    } finally {
      await server.close();
    }
  });
});

describe("resolveListenHost", () => {
  it("binds loopback in production by default", () => {
    expect(resolveListenHost({ NODE_ENV: "production" })).toBe("127.0.0.1");
  });

  it("keeps listening on every interface outside production", () => {
    expect(resolveListenHost({ NODE_ENV: "development" })).toBe("0.0.0.0");
    expect(resolveListenHost({})).toBe("0.0.0.0");
  });

  it("honours an explicit BIND_HOST override", () => {
    expect(resolveListenHost({ NODE_ENV: "production", BIND_HOST: " 0.0.0.0 " })).toBe("0.0.0.0");
    expect(resolveListenHost({ NODE_ENV: "development", BIND_HOST: "127.0.0.1" })).toBe(
      "127.0.0.1",
    );
    expect(resolveListenHost({ NODE_ENV: "production", BIND_HOST: "  " })).toBe("127.0.0.1");
  });
});
