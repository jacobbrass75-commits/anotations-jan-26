import type { Express, Request, Response } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { createHash, randomBytes, randomUUID } from "crypto";
import { lookup } from "dns/promises";
import { readFileSync } from "fs";
import ipaddr from "ipaddr.js";
import { isIP } from "net";
import { join } from "path";
import { TIER_LEVELS } from "./auth";
import { getOrCreateUser } from "./authStorage";
import { authLimiter } from "./rateLimits";
import {
  createAuthorizationCode,
  createMcpToken,
  createOAuthClient,
  getActiveMcpTokenByRefreshHash,
  getAuthorizationCodeByHash,
  getOAuthClientById,
  pruneExpiredAuthorizationCodes,
  revokeMcpTokenByAnyHash,
  revokeMcpTokenById,
  consumeAuthorizationCode,
} from "./oauthStorage";
import { createLogger } from "./logger";

const logger = createLogger("oauthRoutes");

const DEFAULT_SCOPES = ["read", "write"];
const ALLOWED_SCOPES = new Set(DEFAULT_SCOPES);
const ALLOWED_GRANT_TYPES = new Set(["authorization_code", "refresh_token"]);
const ALLOWED_RESPONSE_TYPES = new Set(["code"]);
const ALLOWED_CODE_CHALLENGE_METHODS = new Set(["S256"]);
const ALLOWED_TOKEN_AUTH_METHODS = new Set(["none", "client_secret_post"]);
const ACCESS_TOKEN_TTL_SECONDS = Number(process.env.MCP_ACCESS_TOKEN_TTL_SECONDS ?? 3600);
const REFRESH_TOKEN_TTL_SECONDS = Number(
  process.env.MCP_REFRESH_TOKEN_TTL_SECONDS ?? 90 * 24 * 60 * 60,
);
const AUTH_CODE_TTL_SECONDS = Number(process.env.MCP_AUTH_CODE_TTL_SECONDS ?? 600);
const AUTHORIZE_DEDUP_WINDOW_SECONDS = Number(
  process.env.OAUTH_AUTHORIZE_DEDUP_WINDOW_SECONDS ?? 15,
);
const CONSENT_NONCE_TTL_SECONDS = 10 * 60;
const MAX_DYNAMIC_CLIENT_METADATA_REDIRECTS = 3;
const DEFAULT_TRUSTED_PROXY_CIDRS = [
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
];
const KNOWN_METADATA_CLIENTS = new Map<
  string,
  {
    clientName: string;
    redirectUris: string[];
    grantTypes: string[];
    responseTypes: string[];
    tokenEndpointAuthMethod: string;
  }
>([
  [
    "https://claude.ai/oauth/mcp-oauth-client-metadata",
    {
      clientName: "Claude",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      tokenEndpointAuthMethod: "none",
    },
  ],
  [
    "https://claude.ai/api/oauth/mcp-oauth-client-metadata",
    {
      clientName: "Claude",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      tokenEndpointAuthMethod: "none",
    },
  ],
]);

interface SessionUser {
  userId: string;
  email: string;
  tier: string;
}

interface ClerkEmailAddressLike {
  id?: string | null;
  emailAddress?: string | null;
  verification?: {
    status?: string | null;
  } | null;
}

interface ClerkUserEmailLike {
  emailAddresses?: ClerkEmailAddressLike[] | null;
  primaryEmailAddressId?: string | null;
}

interface ClerkEmailSelection {
  email: string;
  verified: boolean;
}

interface OAuthClientLike {
  clientId: string;
  clientSecretHash: string | null;
  clientName: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: string;
}

interface AuthorizeRequestParams {
  clientId: string;
  redirectUri: string;
  responseType: string;
  scope: string;
  invalidScopes: string[];
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
}

interface AuthorizationDecisionCacheEntry {
  codeHash: string;
  redirectUrl: string;
  createdAt: number;
}

interface ConsentNonceEntry {
  userId: string;
  requestKey: string;
  expiresAt: number;
}

const AUTHORIZE_TEMPLATE_PATH = join(process.cwd(), "server", "views", "authorize.html");
let authorizeTemplateCache: string | null = null;
const recentAuthorizationDecisions = new Map<string, AuthorizationDecisionCacheEntry>();
const consentNonces = new Map<string, ConsentNonceEntry>();

function splitCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseIpAddress(rawValue: string | undefined | null): ipaddr.IPv4 | ipaddr.IPv6 | null {
  const value = rawValue?.trim();
  if (!value) return null;

  try {
    return ipaddr.process(value);
  } catch {
    return null;
  }
}

function getTrustedProxyCidrs(): Array<[ipaddr.IPv4 | ipaddr.IPv6, number]> {
  const configured = splitCsv(process.env.OAUTH_TRUSTED_PROXY_CIDRS);
  const cidrs = configured.length > 0 ? configured : DEFAULT_TRUSTED_PROXY_CIDRS;

  return cidrs.flatMap((cidr) => {
    try {
      return [ipaddr.parseCIDR(cidr)];
    } catch {
      logger.warn({ cidr }, "Ignoring invalid OAUTH_TRUSTED_PROXY_CIDRS entry");
      return [];
    }
  });
}

function isIpv4Address(address: ipaddr.IPv4 | ipaddr.IPv6): address is ipaddr.IPv4 {
  return address.kind() === "ipv4";
}

function isIpv6Address(address: ipaddr.IPv4 | ipaddr.IPv6): address is ipaddr.IPv6 {
  return address.kind() === "ipv6";
}

function isTrustedProxyAddress(
  address: ipaddr.IPv4 | ipaddr.IPv6,
  trustedProxyCidrs: Array<[ipaddr.IPv4 | ipaddr.IPv6, number]>,
): boolean {
  return trustedProxyCidrs.some(([network, prefix]) => {
    if (isIpv4Address(address) && isIpv4Address(network)) {
      return address.match(network, prefix);
    }
    if (isIpv6Address(address) && isIpv6Address(network)) {
      return address.match(network, prefix);
    }
    return false;
  });
}

function getForwardedForAddresses(req: Request): Array<ipaddr.IPv4 | ipaddr.IPv6> {
  const rawHeaders = req.headers["x-forwarded-for"];
  const values = Array.isArray(rawHeaders) ? rawHeaders : [rawHeaders];

  return values.flatMap((value) =>
    String(value ?? "")
      .split(",")
      .map((item) => parseIpAddress(item))
      .filter((address): address is ipaddr.IPv4 | ipaddr.IPv6 => Boolean(address)),
  );
}

function getOAuthRateLimitClientAddress(req: Request): string {
  const remoteAddress = parseIpAddress(req.socket.remoteAddress);
  if (!remoteAddress) return "unknown";

  const trustedProxyCidrs = getTrustedProxyCidrs();
  if (!isTrustedProxyAddress(remoteAddress, trustedProxyCidrs)) {
    return remoteAddress.toString();
  }

  const forwardedFor = getForwardedForAddresses(req);
  for (let index = forwardedFor.length - 1; index >= 0; index -= 1) {
    const candidate = forwardedFor[index];
    if (candidate && !isTrustedProxyAddress(candidate, trustedProxyCidrs)) {
      return candidate.toString();
    }
  }

  const cloudflareClientIp = parseIpAddress(req.header("cf-connecting-ip"));
  if (
    cloudflareClientIp &&
    forwardedFor.some((address) => isTrustedProxyAddress(address, trustedProxyCidrs))
  ) {
    return cloudflareClientIp.toString();
  }

  return remoteAddress.toString();
}

function createFixedWindowRateLimiter(options: { windowMs: number; max: number }) {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: () => void): void => {
    const now = Date.now();
    const key = `${getOAuthRateLimitClientAddress(req)}:${req.path}`;
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    current.count += 1;
    if (current.count > options.max) {
      res.status(429).json({ error: "rate_limited", error_description: "Too many OAuth requests" });
      return;
    }
    next();
  };
}

const oauthRateLimit = createFixedWindowRateLimiter({ windowMs: 60_000, max: 60 });

function getUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function hashSha256Hex(rawValue: string): string {
  return createHash("sha256").update(rawValue).digest("hex");
}

function hashSha256Base64Url(rawValue: string): string {
  return createHash("sha256").update(rawValue).digest("base64url");
}

function getIssuerBaseUrl(req: Request): string {
  const configured =
    process.env.OAUTH_ISSUER || process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL;
  if (configured && configured.trim().length > 0) {
    return configured.replace(/\/+$/, "");
  }

  const forwardedProto = req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || req.protocol || "https";
  const host = req.header("x-forwarded-host") || req.get("host") || "localhost";
  return `${protocol}://${host}`.replace(/\/+$/, "");
}

function getMcpResourceUrl(): string {
  const configured = process.env.MCP_RESOURCE_URL;
  if (configured && configured.trim().length > 0) {
    return configured.replace(/\/+$/, "");
  }

  return "https://mcp.scholarmark.ai";
}

function getAuthorizeTemplate(): string {
  if (!authorizeTemplateCache) {
    authorizeTemplateCache = readFileSync(AUTHORIZE_TEMPLATE_PATH, "utf8");
  }
  return authorizeTemplateCache;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pickString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

function pickBodyOrQueryString(req: Request, key: string): string {
  const bodyValue = (req.body as Record<string, unknown> | undefined)?.[key];
  if (typeof bodyValue === "string") return bodyValue;
  if (Array.isArray(bodyValue) && typeof bodyValue[0] === "string") return bodyValue[0];

  const queryValue = (req.query as Record<string, unknown> | undefined)?.[key];
  if (typeof queryValue === "string") return queryValue;
  if (Array.isArray(queryValue) && typeof queryValue[0] === "string") return queryValue[0];
  return "";
}

function parseScopeList(scopeValue: string): string[] {
  return scopeValue
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function normalizeScope(scopeValue: string): string {
  const requested = parseScopeList(scopeValue);

  const uniqueScopes = Array.from(new Set(requested.filter((scope) => ALLOWED_SCOPES.has(scope))));
  if (uniqueScopes.length === 0) return DEFAULT_SCOPES.join(" ");
  return uniqueScopes.join(" ");
}

function hasOnlyAllowedValues(values: string[], allowedValues: Set<string>): boolean {
  return values.every((value) => allowedValues.has(value));
}

function normalizeAuthorizeRequestParams(req: Request): AuthorizeRequestParams {
  const rawScope = pickBodyOrQueryString(req, "scope");
  const requestedScopes = parseScopeList(rawScope);
  const invalidScopes = Array.from(
    new Set(requestedScopes.filter((scope) => !ALLOWED_SCOPES.has(scope))),
  );
  const scope = normalizeScope(rawScope);
  const state = pickBodyOrQueryString(req, "state");
  const resource = pickBodyOrQueryString(req, "resource");

  return {
    clientId: pickBodyOrQueryString(req, "client_id"),
    redirectUri: pickBodyOrQueryString(req, "redirect_uri"),
    responseType: pickBodyOrQueryString(req, "response_type"),
    scope,
    invalidScopes,
    state,
    codeChallenge: pickBodyOrQueryString(req, "code_challenge"),
    codeChallengeMethod: pickBodyOrQueryString(req, "code_challenge_method") || "S256",
    resource,
  };
}

function buildAuthorizeUrl(params: AuthorizeRequestParams): string {
  const search = new URLSearchParams();
  search.set("client_id", params.clientId);
  search.set("redirect_uri", params.redirectUri);
  search.set("response_type", params.responseType);
  search.set("scope", params.scope);
  if (params.state) search.set("state", params.state);
  if (params.codeChallenge) search.set("code_challenge", params.codeChallenge);
  if (params.codeChallengeMethod) search.set("code_challenge_method", params.codeChallengeMethod);
  if (params.resource) search.set("resource", params.resource);
  return `/oauth/authorize?${search.toString()}`;
}

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:") return true;
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function isAllowedDynamicClientMetadataUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".local")
    ) {
      return false;
    }
    if (isPrivateIpAddress(hostname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isPrivateIpAddress(address: string): boolean {
  if (isIP(address) === 4) {
    return (
      /^10\./.test(address) ||
      /^127\./.test(address) ||
      /^169\.254\./.test(address) ||
      /^192\.168\./.test(address) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(address) ||
      address === "0.0.0.0"
    );
  }

  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    const mappedIpv4 = parseIpv4MappedAddress(normalized);
    if (mappedIpv4) {
      return isPrivateIpAddress(mappedIpv4);
    }
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }

  return false;
}

function parseIpv4MappedAddress(address: string): string | null {
  if (!address.startsWith("::ffff:")) {
    return null;
  }

  const suffix = address.slice("::ffff:".length);
  if (isIP(suffix) === 4) {
    return suffix;
  }

  const words = suffix.split(":");
  if (words.length !== 2 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) {
    return null;
  }

  const first = Number.parseInt(words[0], 16);
  const second = Number.parseInt(words[1], 16);
  if (!Number.isFinite(first) || !Number.isFinite(second)) {
    return null;
  }

  return [(first >> 8) & 255, first & 255, (second >> 8) & 255, second & 255].join(".");
}

async function resolvesToPublicAddresses(value: string): Promise<boolean> {
  const hostname = new URL(value).hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) {
    return !isPrivateIpAddress(hostname);
  }

  try {
    const records = await lookup(hostname, { all: true });
    return records.length > 0 && records.every((record) => !isPrivateIpAddress(record.address));
  } catch {
    return false;
  }
}

async function fetchDynamicClientMetadata(clientId: string): Promise<unknown | null> {
  let metadataUrl = clientId;

  for (
    let redirectCount = 0;
    redirectCount <= MAX_DYNAMIC_CLIENT_METADATA_REDIRECTS;
    redirectCount += 1
  ) {
    if (!isAllowedDynamicClientMetadataUrl(metadataUrl)) {
      return null;
    }
    if (!(await resolvesToPublicAddresses(metadataUrl))) {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(metadataUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "manual",
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return null;
        }

        metadataUrl = new URL(location, metadataUrl).toString();
        continue;
      }

      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  return null;
}

function isValidRedirectUri(redirectUri: string, client: OAuthClientLike): boolean {
  return client.redirectUris.includes(redirectUri);
}

function redirectWithError(
  res: Response,
  redirectUri: string,
  state: string,
  error: string,
  description?: string,
): void {
  try {
    const redirectTarget = new URL(redirectUri);
    redirectTarget.searchParams.set("error", error);
    if (description) {
      redirectTarget.searchParams.set("error_description", description);
    }
    if (state) {
      redirectTarget.searchParams.set("state", state);
    }
    res.redirect(302, redirectTarget.toString());
  } catch {
    res.status(400).json({ error, error_description: description ?? "Invalid redirect_uri" });
  }
}

function sendOAuthError(res: Response, status: number, error: string, description: string): void {
  res.status(status).json({
    error,
    error_description: description,
  });
}

function isUnverifiedClerkEmailError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("email must be verified");
}

function normalizeClerkTier(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "string" && TIER_LEVELS[value] !== undefined) {
    return value;
  }
  throw new Error("Invalid Clerk tier metadata");
}

function getPrimaryClerkEmail(clerkUser: ClerkUserEmailLike): ClerkEmailSelection {
  const addresses = Array.isArray(clerkUser.emailAddresses) ? clerkUser.emailAddresses : [];
  const primary =
    addresses.find((address) => address.id && address.id === clerkUser.primaryEmailAddressId) ??
    null;
  const verified =
    (primary?.verification?.status === "verified" ? primary : null) ??
    addresses.find((address) => address.verification?.status === "verified") ??
    null;
  const selected = verified ?? primary ?? addresses[0] ?? null;
  const email = selected?.emailAddress?.trim();

  if (!email) {
    throw new Error("Clerk user is missing an email address");
  }

  return {
    email,
    verified: selected?.verification?.status === "verified",
  };
}

async function resolveSessionUser(req: Request): Promise<SessionUser | null> {
  const auth = getAuth(req);
  if (!auth?.userId) {
    return null;
  }

  const clerkUser = await clerkClient.users.getUser(auth.userId);
  const { email, verified: emailVerified } = getPrimaryClerkEmail(clerkUser);
  const tier = normalizeClerkTier(clerkUser.publicMetadata?.tier);
  const dbUser = await getOrCreateUser(auth.userId, email, tier, { emailVerified });

  return {
    userId: dbUser.id,
    email: dbUser.email,
    tier: dbUser.tier,
  };
}

function parseStringArray(input: unknown, fallback: string[]): string[] {
  if (!input) return fallback;
  if (Array.isArray(input)) {
    return input.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return fallback;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter((entry): entry is string => typeof entry === "string");
      }
    } catch {
      return trimmed
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
    }
  }
  return fallback;
}

function mapScopeToDescription(scope: string): string {
  if (scope === "read") {
    return "View projects, documents, and conversations";
  }
  if (scope === "write") {
    return "Create conversations, send messages, and compile papers";
  }
  return "Access your ScholarMark account data";
}

function renderAuthorizeHtml(input: {
  clientName: string;
  userEmail: string;
  clientId: string;
  redirectUri: string;
  responseType: string;
  state: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
  csrfToken: string;
  tierNotice: string;
}): string {
  const scopes = input.scope.split(/\s+/).filter(Boolean);
  const scopeItems = scopes
    .map(
      (scope) =>
        `<li><strong>${escapeHtml(scope)}</strong> - ${escapeHtml(mapScopeToDescription(scope))}</li>`,
    )
    .join("\n");

  return getAuthorizeTemplate()
    .replace(/{{CLIENT_NAME}}/g, escapeHtml(input.clientName))
    .replace(/{{USER_EMAIL}}/g, escapeHtml(input.userEmail))
    .replace(/{{CLIENT_ID}}/g, escapeHtml(input.clientId))
    .replace(/{{REDIRECT_URI}}/g, escapeHtml(input.redirectUri))
    .replace(/{{RESPONSE_TYPE}}/g, escapeHtml(input.responseType))
    .replace(/{{STATE}}/g, escapeHtml(input.state))
    .replace(/{{SCOPE}}/g, escapeHtml(input.scope))
    .replace(/{{CODE_CHALLENGE}}/g, escapeHtml(input.codeChallenge))
    .replace(/{{CODE_CHALLENGE_METHOD}}/g, escapeHtml(input.codeChallengeMethod))
    .replace(/{{RESOURCE}}/g, escapeHtml(input.resource))
    .replace(/{{CSRF_TOKEN}}/g, escapeHtml(input.csrfToken))
    .replace(
      /{{SCOPE_ITEMS}}/g,
      scopeItems || "<li><strong>read</strong> - View projects and conversations</li>",
    )
    .replace(/{{TIER_NOTICE}}/g, input.tierNotice);
}

function parseMetadataClient(rawMetadata: unknown, clientId: string): OAuthClientLike | null {
  if (!rawMetadata || typeof rawMetadata !== "object") return null;
  const metadata = rawMetadata as Record<string, unknown>;

  const metadataClientId = pickString(metadata.client_id);
  if (metadataClientId && metadataClientId !== clientId) {
    return null;
  }

  const redirectUris = parseStringArray(metadata.redirect_uris, []);
  if (redirectUris.length === 0 || !redirectUris.every((uri) => isValidUrl(uri))) {
    return null;
  }

  const tokenEndpointAuthMethod = pickString(metadata.token_endpoint_auth_method) || "none";
  if (tokenEndpointAuthMethod !== "none") {
    return null;
  }

  const clientName = pickString(metadata.client_name) || "Claude Connector";
  const grantTypes = parseStringArray(metadata.grant_types, [
    "authorization_code",
    "refresh_token",
  ]);
  const responseTypes = parseStringArray(metadata.response_types, ["code"]);
  if (
    !hasOnlyAllowedValues(grantTypes, ALLOWED_GRANT_TYPES) ||
    !hasOnlyAllowedValues(responseTypes, ALLOWED_RESPONSE_TYPES)
  ) {
    return null;
  }

  return {
    clientId,
    clientSecretHash: null,
    clientName,
    redirectUris,
    grantTypes,
    responseTypes,
    tokenEndpointAuthMethod,
  };
}

function resolveKnownMetadataClient(clientId: string): OAuthClientLike | null {
  const knownClient = KNOWN_METADATA_CLIENTS.get(clientId);
  if (!knownClient) {
    return null;
  }

  return {
    clientId,
    clientSecretHash: null,
    clientName: knownClient.clientName,
    redirectUris: knownClient.redirectUris,
    grantTypes: knownClient.grantTypes,
    responseTypes: knownClient.responseTypes,
    tokenEndpointAuthMethod: knownClient.tokenEndpointAuthMethod,
  };
}

async function resolveOAuthClient(clientId: string): Promise<OAuthClientLike | null> {
  const storedClient = getOAuthClientById(clientId);
  if (storedClient) {
    return storedClient;
  }

  if (!isAllowedDynamicClientMetadataUrl(clientId)) {
    return null;
  }

  const knownClient = resolveKnownMetadataClient(clientId);
  if (knownClient) {
    createOAuthClient({
      clientId: knownClient.clientId,
      clientSecretHash: knownClient.clientSecretHash,
      clientName: knownClient.clientName,
      redirectUris: knownClient.redirectUris,
      grantTypes: knownClient.grantTypes,
      responseTypes: knownClient.responseTypes,
      tokenEndpointAuthMethod: knownClient.tokenEndpointAuthMethod,
      createdAt: getUnixSeconds(),
    });

    return knownClient;
  }

  try {
    const metadata = await fetchDynamicClientMetadata(clientId);
    if (!metadata) return null;

    const parsedClient = parseMetadataClient(metadata, clientId);
    if (!parsedClient) {
      return null;
    }

    // Dynamic client_id metadata documents still need a local row because
    // auth codes and tokens enforce foreign keys against mcp_oauth_clients.
    createOAuthClient({
      clientId: parsedClient.clientId,
      clientSecretHash: parsedClient.clientSecretHash,
      clientName: parsedClient.clientName,
      redirectUris: parsedClient.redirectUris,
      grantTypes: parsedClient.grantTypes,
      responseTypes: parsedClient.responseTypes,
      tokenEndpointAuthMethod: parsedClient.tokenEndpointAuthMethod,
      createdAt: getUnixSeconds(),
    });

    return parsedClient;
  } catch {
    return null;
  }
}

function verifyPkce(
  codeVerifier: string,
  codeChallenge: string,
  codeChallengeMethod: string,
): boolean {
  if (codeChallengeMethod !== "S256") return false;
  const expectedChallenge = hashSha256Base64Url(codeVerifier);
  return expectedChallenge === codeChallenge;
}

function issueTokenPair(scope: string): {
  accessToken: string;
  refreshToken: string;
  keyHash: string;
  refreshTokenHash: string;
  keyPrefix: string;
  scope: string;
} {
  const accessToken = `mcp_sm_${randomBytes(32).toString("hex")}`;
  const refreshToken = `mcp_rt_${randomBytes(32).toString("hex")}`;
  const keyHash = hashSha256Hex(accessToken);
  const refreshTokenHash = hashSha256Hex(refreshToken);
  return {
    accessToken,
    refreshToken,
    keyHash,
    refreshTokenHash,
    keyPrefix: accessToken.slice(0, 14),
    scope,
  };
}

async function validateTokenClient(req: Request): Promise<{
  ok: boolean;
  client: OAuthClientLike | null;
  error?: { status: number; code: string; description: string };
}> {
  const clientId = pickBodyOrQueryString(req, "client_id");
  if (!clientId) {
    return {
      ok: false,
      client: null,
      error: { status: 401, code: "invalid_client", description: "Missing client_id" },
    };
  }

  const client = await resolveOAuthClient(clientId);
  if (!client) {
    return {
      ok: false,
      client: null,
      error: { status: 401, code: "invalid_client", description: "Unknown client_id" },
    };
  }

  if (!ALLOWED_TOKEN_AUTH_METHODS.has(client.tokenEndpointAuthMethod)) {
    return {
      ok: false,
      client,
      error: {
        status: 401,
        code: "invalid_client",
        description: "Unsupported token_endpoint_auth_method",
      },
    };
  }

  if (client.tokenEndpointAuthMethod === "client_secret_post") {
    const providedSecret = pickBodyOrQueryString(req, "client_secret");
    if (
      !providedSecret ||
      !client.clientSecretHash ||
      hashSha256Hex(providedSecret) !== client.clientSecretHash
    ) {
      return {
        ok: false,
        client,
        error: { status: 401, code: "invalid_client", description: "Invalid client credentials" },
      };
    }
  }

  return { ok: true, client };
}

function validateAuthorizeParams(params: AuthorizeRequestParams): {
  ok: boolean;
  description?: string;
} {
  if (!params.clientId) return { ok: false, description: "Missing client_id" };
  if (!params.redirectUri) return { ok: false, description: "Missing redirect_uri" };
  if (!params.responseType) return { ok: false, description: "Missing response_type" };
  if (params.responseType !== "code")
    return { ok: false, description: "Unsupported response_type" };
  if (params.invalidScopes.length > 0) {
    return { ok: false, description: `Unsupported scope: ${params.invalidScopes.join(" ")}` };
  }
  if (!params.codeChallenge) return { ok: false, description: "Missing code_challenge" };
  if (!ALLOWED_CODE_CHALLENGE_METHODS.has(params.codeChallengeMethod)) {
    return { ok: false, description: "Unsupported code_challenge_method" };
  }
  return { ok: true };
}

function buildAuthorizationCodeRedirect(
  redirectUri: string,
  state: string,
  authorizationCode: string,
): string {
  const redirectTarget = new URL(redirectUri);
  redirectTarget.searchParams.set("code", authorizationCode);
  if (state) {
    redirectTarget.searchParams.set("state", state);
  }
  return redirectTarget.toString();
}

function buildAuthorizationDecisionCacheKey(
  userId: string,
  params: AuthorizeRequestParams,
): string {
  return JSON.stringify([
    userId,
    params.clientId,
    params.redirectUri,
    params.responseType,
    params.state,
    params.scope,
    params.codeChallenge,
    params.codeChallengeMethod,
    params.resource,
  ]);
}

function issueConsentNonce(sessionUser: SessionUser, params: AuthorizeRequestParams): string {
  const now = getUnixSeconds();
  const nonce = randomBytes(32).toString("base64url");
  consentNonces.set(nonce, {
    userId: sessionUser.userId,
    requestKey: buildAuthorizationDecisionCacheKey(sessionUser.userId, params),
    expiresAt: now + CONSENT_NONCE_TTL_SECONDS,
  });
  return nonce;
}

function validateAndConsumeConsentNonce(
  token: string,
  sessionUser: SessionUser,
  params: AuthorizeRequestParams,
): boolean {
  const now = getUnixSeconds();
  for (const [nonce, entry] of Array.from(consentNonces.entries())) {
    if (entry.expiresAt <= now) {
      consentNonces.delete(nonce);
    }
  }

  const entry = consentNonces.get(token);
  if (!entry) return false;
  consentNonces.delete(token);
  return (
    entry.userId === sessionUser.userId &&
    entry.requestKey === buildAuthorizationDecisionCacheKey(sessionUser.userId, params) &&
    entry.expiresAt > now
  );
}

function getOriginFromUrl(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isTrustedAuthorizePostOrigin(req: Request): boolean {
  const issuerOrigin = getOriginFromUrl(getIssuerBaseUrl(req));
  if (!issuerOrigin) return false;

  const origin = req.header("origin");
  if (origin) {
    return getOriginFromUrl(origin) === issuerOrigin;
  }

  const referer = req.header("referer");
  if (referer) {
    return getOriginFromUrl(referer) === issuerOrigin;
  }

  return process.env.NODE_ENV !== "production";
}

function pruneRecentAuthorizationDecisions(now: number): void {
  for (const [key, entry] of Array.from(recentAuthorizationDecisions.entries())) {
    if (entry.createdAt + AUTHORIZE_DEDUP_WINDOW_SECONDS <= now) {
      recentAuthorizationDecisions.delete(key);
    }
  }
}

function sendDuplicateApprovalResponse(res: Response): void {
  res
    .status(202)
    .setHeader("Cache-Control", "no-store")
    .setHeader("Content-Type", "text/html; charset=utf-8").send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Authorization Already Submitted</title>
  </head>
  <body>
    <p>Authorization is already in progress. You can return to Claude.</p>
  </body>
</html>`);
}

function approveAuthorizationRequest(
  res: Response,
  sessionUser: SessionUser,
  params: AuthorizeRequestParams,
): void {
  const now = getUnixSeconds();
  pruneRecentAuthorizationDecisions(now);

  const cacheKey = buildAuthorizationDecisionCacheKey(sessionUser.userId, params);
  const cachedDecision = recentAuthorizationDecisions.get(cacheKey);
  if (cachedDecision && cachedDecision.createdAt + AUTHORIZE_DEDUP_WINDOW_SECONDS > now) {
    const existingAuthCode = getAuthorizationCodeByHash(cachedDecision.codeHash);
    if (existingAuthCode && existingAuthCode.used === 0 && existingAuthCode.expiresAt > now) {
      res.redirect(303, cachedDecision.redirectUrl);
      return;
    }

    sendDuplicateApprovalResponse(res);
    return;
  }

  const authorizationCode = randomBytes(32).toString("hex");
  const codeHash = hashSha256Hex(authorizationCode);

  createAuthorizationCode({
    codeHash,
    userId: sessionUser.userId,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    scope: params.scope,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: params.codeChallengeMethod,
    expiresAt: now + AUTH_CODE_TTL_SECONDS,
    createdAt: now,
  });

  pruneExpiredAuthorizationCodes(now);

  const redirectUrl = buildAuthorizationCodeRedirect(
    params.redirectUri,
    params.state,
    authorizationCode,
  );
  recentAuthorizationDecisions.set(cacheKey, {
    codeHash,
    redirectUrl,
    createdAt: now,
  });

  res.redirect(303, redirectUrl);
}

export function registerOAuthRoutes(app: Express): void {
  app.get("/.well-known/oauth-authorization-server", (req: Request, res: Response) => {
    const issuer = getIssuerBaseUrl(req);
    return res.json({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: DEFAULT_SCOPES,
      client_id_metadata_document_supported: true,
    });
  });

  app.post("/oauth/register", oauthRateLimit, async (req: Request, res: Response) => {
    try {
      const clientNameInput = pickString(req.body?.client_name).trim();
      const redirectUris = parseStringArray(req.body?.redirect_uris, []);
      const tokenEndpointAuthMethod = pickString(req.body?.token_endpoint_auth_method) || "none";
      const grantTypes = parseStringArray(req.body?.grant_types, [
        "authorization_code",
        "refresh_token",
      ]);
      const responseTypes = parseStringArray(req.body?.response_types, ["code"]);

      if (!clientNameInput) {
        return sendOAuthError(res, 400, "invalid_client_metadata", "client_name is required");
      }
      if (redirectUris.length === 0) {
        return sendOAuthError(
          res,
          400,
          "invalid_redirect_uri",
          "At least one redirect URI is required",
        );
      }
      if (!redirectUris.every((uri) => isValidUrl(uri))) {
        return sendOAuthError(
          res,
          400,
          "invalid_redirect_uri",
          "All redirect URIs must be valid absolute URLs",
        );
      }
      if (!ALLOWED_TOKEN_AUTH_METHODS.has(tokenEndpointAuthMethod)) {
        return sendOAuthError(
          res,
          400,
          "invalid_client_metadata",
          "Unsupported token_endpoint_auth_method",
        );
      }
      if (!hasOnlyAllowedValues(grantTypes, ALLOWED_GRANT_TYPES)) {
        return sendOAuthError(res, 400, "invalid_client_metadata", "Unsupported grant_type");
      }
      if (!hasOnlyAllowedValues(responseTypes, ALLOWED_RESPONSE_TYPES)) {
        return sendOAuthError(res, 400, "invalid_client_metadata", "Unsupported response_type");
      }

      const clientId = `mcp_client_${randomUUID()}`;
      const clientSecret =
        tokenEndpointAuthMethod === "client_secret_post" ? randomBytes(32).toString("hex") : null;
      const clientSecretHash = clientSecret ? hashSha256Hex(clientSecret) : null;
      const createdAt = getUnixSeconds();

      createOAuthClient({
        clientId,
        clientSecretHash,
        clientName: clientNameInput,
        redirectUris,
        grantTypes,
        responseTypes,
        tokenEndpointAuthMethod,
        createdAt,
      });

      return res.status(201).json({
        client_id: clientId,
        client_secret: clientSecret ?? undefined,
        client_name: clientNameInput,
        redirect_uris: redirectUris,
        grant_types: grantTypes,
        response_types: responseTypes,
        token_endpoint_auth_method: tokenEndpointAuthMethod,
      });
    } catch (error) {
      logger.error({ err: error }, "OAuth client registration error:");
      return sendOAuthError(res, 500, "server_error", "Failed to register OAuth client");
    }
  });

  app.get("/oauth/authorize", authLimiter, async (req: Request, res: Response) => {
    try {
      const params = normalizeAuthorizeRequestParams(req);
      const decision = pickBodyOrQueryString(req, "decision");
      const paramValidation = validateAuthorizeParams(params);
      if (!paramValidation.ok) {
        return res
          .status(400)
          .json({ error: "invalid_request", error_description: paramValidation.description });
      }

      const client = await resolveOAuthClient(params.clientId);
      if (!client) {
        return res
          .status(400)
          .json({ error: "invalid_client", error_description: "Unknown client_id" });
      }
      if (!isValidRedirectUri(params.redirectUri, client)) {
        return res.status(400).json({
          error: "invalid_redirect_uri",
          error_description: "redirect_uri is not allowed",
        });
      }

      const sessionUser = await resolveSessionUser(req);
      if (!sessionUser) {
        const redirectUrl = `/sign-in?redirect_url=${encodeURIComponent(req.originalUrl)}`;
        return res.redirect(302, redirectUrl);
      }

      if (decision) {
        return res.status(405).json({
          error: "invalid_request",
          error_description: "Authorization decisions must be submitted with POST",
        });
      }

      const userTierLevel = TIER_LEVELS[sessionUser.tier] ?? 0;
      const proTierLevel = TIER_LEVELS.pro ?? 1;
      const tierNotice =
        userTierLevel < proTierLevel
          ? '<p class="notice warning">Note: Chat, compile, and verify endpoints require a Pro plan. Authorization can still proceed.</p>'
          : "";
      const csrfToken = issueConsentNonce(sessionUser, params);

      const html = renderAuthorizeHtml({
        clientName: client.clientName,
        userEmail: sessionUser.email,
        clientId: params.clientId,
        redirectUri: params.redirectUri,
        responseType: params.responseType,
        state: params.state,
        scope: params.scope,
        codeChallenge: params.codeChallenge,
        codeChallengeMethod: params.codeChallengeMethod,
        resource: params.resource,
        csrfToken,
        tierNotice,
      });

      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(html);
    } catch (error) {
      if (isUnverifiedClerkEmailError(error)) {
        return sendOAuthError(
          res,
          403,
          "access_denied",
          "Clerk email must be verified before authorization",
        );
      }
      logger.error({ err: error }, "OAuth authorize page error:");
      return sendOAuthError(res, 500, "server_error", "Failed to render authorization page");
    }
  });

  app.post("/oauth/authorize", authLimiter, async (req: Request, res: Response) => {
    try {
      if (!isTrustedAuthorizePostOrigin(req)) {
        return res
          .status(403)
          .json({ error: "invalid_request", error_description: "Untrusted authorization origin" });
      }

      const params = normalizeAuthorizeRequestParams(req);
      const decision = pickBodyOrQueryString(req, "decision");
      const csrfToken = pickBodyOrQueryString(req, "csrf_token");
      const paramValidation = validateAuthorizeParams(params);
      if (!paramValidation.ok) {
        return res
          .status(400)
          .json({ error: "invalid_request", error_description: paramValidation.description });
      }

      const client = await resolveOAuthClient(params.clientId);
      if (!client) {
        return res
          .status(400)
          .json({ error: "invalid_client", error_description: "Unknown client_id" });
      }
      if (!isValidRedirectUri(params.redirectUri, client)) {
        return res.status(400).json({
          error: "invalid_redirect_uri",
          error_description: "redirect_uri is not allowed",
        });
      }

      const sessionUser = await resolveSessionUser(req);
      if (!sessionUser) {
        const redirectUrl = `/sign-in?redirect_url=${encodeURIComponent(buildAuthorizeUrl(params))}`;
        return res.redirect(302, redirectUrl);
      }

      if (!csrfToken || !validateAndConsumeConsentNonce(csrfToken, sessionUser, params)) {
        return res.status(403).json({
          error: "invalid_request",
          error_description: "Invalid authorization consent token",
        });
      }

      if (decision !== "approve") {
        return redirectWithError(
          res,
          params.redirectUri,
          params.state,
          "access_denied",
          "The user denied the request",
        );
      }

      // Use 303 so clients never replay POST against the callback endpoint.
      approveAuthorizationRequest(res, sessionUser, params);
      return;
    } catch (error) {
      if (isUnverifiedClerkEmailError(error)) {
        return sendOAuthError(
          res,
          403,
          "access_denied",
          "Clerk email must be verified before authorization",
        );
      }
      logger.error({ err: error }, "OAuth authorize decision error:");
      return sendOAuthError(res, 500, "server_error", "Failed to process authorization decision");
    }
  });

  app.post("/oauth/token", authLimiter, async (req: Request, res: Response) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");

      const grantType = pickBodyOrQueryString(req, "grant_type");
      const clientValidation = await validateTokenClient(req);
      if (!clientValidation.ok || !clientValidation.client) {
        const error = clientValidation.error ?? {
          status: 401,
          code: "invalid_client",
          description: "Client authentication failed",
        };
        return sendOAuthError(res, error.status, error.code, error.description);
      }
      const client = clientValidation.client;

      if (grantType === "authorization_code") {
        const code = pickBodyOrQueryString(req, "code");
        const redirectUri = pickBodyOrQueryString(req, "redirect_uri");
        const codeVerifier = pickBodyOrQueryString(req, "code_verifier");
        const requestedClientId = pickBodyOrQueryString(req, "client_id");

        if (!code || !redirectUri || !codeVerifier || !requestedClientId) {
          return sendOAuthError(
            res,
            400,
            "invalid_request",
            "Missing required authorization_code parameters",
          );
        }

        const now = getUnixSeconds();
        const authCode = consumeAuthorizationCode(hashSha256Hex(code), now);
        if (!authCode) {
          return sendOAuthError(
            res,
            400,
            "invalid_grant",
            "Authorization code is invalid, expired, or already used",
          );
        }
        if (authCode.clientId !== client.clientId || authCode.redirectUri !== redirectUri) {
          return sendOAuthError(
            res,
            400,
            "invalid_grant",
            "Authorization code does not match client or redirect URI",
          );
        }
        if (!verifyPkce(codeVerifier, authCode.codeChallenge, authCode.codeChallengeMethod)) {
          return sendOAuthError(res, 400, "invalid_grant", "PKCE verification failed");
        }

        const tokenPair = issueTokenPair(authCode.scope || DEFAULT_SCOPES.join(" "));
        createMcpToken({
          id: randomUUID(),
          userId: authCode.userId,
          clientId: authCode.clientId,
          keyHash: tokenPair.keyHash,
          keyPrefix: tokenPair.keyPrefix,
          scope: tokenPair.scope,
          refreshTokenHash: tokenPair.refreshTokenHash,
          expiresAt: now + ACCESS_TOKEN_TTL_SECONDS,
          createdAt: now,
        });

        return res.status(200).json({
          access_token: tokenPair.accessToken,
          token_type: "bearer",
          expires_in: ACCESS_TOKEN_TTL_SECONDS,
          refresh_token: tokenPair.refreshToken,
          scope: tokenPair.scope,
          resource: getMcpResourceUrl(),
        });
      }

      if (grantType === "refresh_token") {
        const refreshToken = pickBodyOrQueryString(req, "refresh_token");
        if (!refreshToken) {
          return sendOAuthError(res, 400, "invalid_request", "Missing refresh_token");
        }

        const refreshTokenHash = hashSha256Hex(refreshToken);
        const existingToken = getActiveMcpTokenByRefreshHash(refreshTokenHash);
        if (!existingToken) {
          return sendOAuthError(res, 400, "invalid_grant", "Refresh token is invalid");
        }
        if (existingToken.clientId !== client.clientId) {
          return sendOAuthError(
            res,
            400,
            "invalid_grant",
            "Refresh token does not belong to this client",
          );
        }

        const now = getUnixSeconds();
        if (existingToken.createdAt + REFRESH_TOKEN_TTL_SECONDS <= now) {
          revokeMcpTokenById(existingToken.id, now);
          return sendOAuthError(res, 400, "invalid_grant", "Refresh token has expired");
        }

        revokeMcpTokenById(existingToken.id, now);

        const tokenPair = issueTokenPair(existingToken.scope || DEFAULT_SCOPES.join(" "));
        createMcpToken({
          id: randomUUID(),
          userId: existingToken.userId,
          clientId: existingToken.clientId,
          keyHash: tokenPair.keyHash,
          keyPrefix: tokenPair.keyPrefix,
          scope: tokenPair.scope,
          refreshTokenHash: tokenPair.refreshTokenHash,
          expiresAt: now + ACCESS_TOKEN_TTL_SECONDS,
          createdAt: now,
        });

        return res.status(200).json({
          access_token: tokenPair.accessToken,
          token_type: "bearer",
          expires_in: ACCESS_TOKEN_TTL_SECONDS,
          refresh_token: tokenPair.refreshToken,
          scope: tokenPair.scope,
          resource: getMcpResourceUrl(),
        });
      }

      return sendOAuthError(res, 400, "unsupported_grant_type", "Unsupported grant_type");
    } catch (error) {
      logger.error({ err: error }, "OAuth token error:");
      return sendOAuthError(res, 500, "server_error", "Failed to issue token");
    }
  });

  app.post("/oauth/revoke", oauthRateLimit, (req: Request, res: Response) => {
    try {
      const token = pickBodyOrQueryString(req, "token");
      if (token) {
        revokeMcpTokenByAnyHash(hashSha256Hex(token), getUnixSeconds());
      }
      return res.status(200).send("");
    } catch (error) {
      logger.error({ err: error }, "OAuth revoke error:");
      return res.status(200).send("");
    }
  });
}
