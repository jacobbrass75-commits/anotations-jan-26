/**
 * Network trust boundaries for the app process.
 *
 * Production topology: Cloudflare -> nginx (same host) -> app on 127.0.0.1:5001.
 * nginx appends the peer it saw to X-Forwarded-For, so walking that header from
 * the right and skipping only these hops yields the real client address.
 */

// Loopback (nginx and the MCP OAuth proxy on the same host) plus Cloudflare's
// published edge ranges (https://www.cloudflare.com/ips/).
export const DEFAULT_TRUSTED_PROXY_CIDRS: readonly string[] = Object.freeze([
  "127.0.0.1/32",
  "::1/128",
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
]);

/**
 * Value for Express's "trust proxy" setting. Only hops in the trusted list are
 * skipped, so a direct peer outside it gets its socket address as req.ip and its
 * X-Forwarded-* headers are ignored.
 */
export function getAppTrustProxySetting(): string[] {
  return [...DEFAULT_TRUSTED_PROXY_CIDRS];
}

/**
 * Interface the HTTP listener binds to. Production defaults to loopback because
 * nginx, the MCP server and the deploy health checks all reach the app on
 * 127.0.0.1. Development keeps listening on every interface. BIND_HOST
 * overrides either default.
 */
export function resolveListenHost(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.BIND_HOST?.trim();
  if (configured) return configured;
  return env.NODE_ENV === "production" ? "127.0.0.1" : "0.0.0.0";
}
