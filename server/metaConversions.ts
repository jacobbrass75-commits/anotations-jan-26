import { createHash } from "node:crypto";
import { createLogger } from "./logger";

const logger = createLogger("meta-conversions");
const DEFAULT_GRAPH_VERSION = "v25.0";
const NEW_REGISTRATION_WINDOW_MS = 30 * 60 * 1000;

const STANDARD_EVENTS: Record<string, string> = {
  landing_view: "PageView",
  signup_completed: "CompleteRegistration",
};

const CUSTOM_EVENTS: Record<string, string> = {
  primary_cta_click: "PrimaryCtaClick",
  signup_started: "SignupStarted",
};

export interface MetaConversionInput {
  siteEventName: string;
  eventId: string;
  eventTimeMs?: number | null;
  eventSourceUrl: string;
  visitorId: string;
  email?: string | null;
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  ctaOrFeature?: string | null;
  value?: number | null;
  currency?: string | null;
}

interface MetaConfig {
  pixelId: string;
  accessToken: string;
  graphVersion: string;
  testEventCode: string | null;
  allowedOrigins: Set<string>;
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function config(env: NodeJS.ProcessEnv = process.env): MetaConfig | null {
  if (env.META_TRACKING_ENABLED !== "true") return null;
  const pixelId = (env.META_PIXEL_ID || env.VITE_META_PIXEL_ID || "").trim();
  const accessToken = (env.META_CONVERSIONS_API_TOKEN || "").trim();
  if (!/^\d+$/.test(pixelId) || !accessToken) return null;

  const configuredOrigins = splitCsv(env.META_ALLOWED_EVENT_ORIGINS);
  const fallbackOrigins = [
    env.MARKETING_BASE_URL,
    env.APP_BASE_URL,
    "https://scholarmark.ai",
    "https://www.scholarmark.ai",
    "https://app.scholarmark.ai",
  ].filter((value): value is string => Boolean(value));

  return {
    pixelId,
    accessToken,
    graphVersion: /^v\d+\.\d+$/.test(env.META_GRAPH_API_VERSION || "")
      ? env.META_GRAPH_API_VERSION!
      : DEFAULT_GRAPH_VERSION,
    testEventCode: env.META_TEST_EVENT_CODE?.trim() || null,
    allowedOrigins: new Set(
      (configuredOrigins.length ? configuredOrigins : fallbackOrigins).map((origin) =>
        origin.replace(/\/$/, ""),
      ),
    ),
  };
}

export function isMetaConversionsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return config(env) !== null;
}

export function isRecentMetaRegistration(
  createdAtMs: number | null | undefined,
  now = Date.now(),
): boolean {
  return (
    typeof createdAtMs === "number" &&
    Number.isFinite(createdAtMs) &&
    createdAtMs <= now &&
    now - createdAtMs <= NEW_REGISTRATION_WINDOW_MS
  );
}

export function metaEventNameForSiteEvent(
  siteEventName: string,
): { name: string; custom: boolean } | null {
  if (STANDARD_EVENTS[siteEventName]) {
    return { name: STANDARD_EVENTS[siteEventName], custom: false };
  }
  if (CUSTOM_EVENTS[siteEventName]) {
    return { name: CUSTOM_EVENTS[siteEventName], custom: true };
  }
  return null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

function eventTimeSeconds(value: number | null | undefined, now = Date.now()): number {
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const fiveMinutesMs = 5 * 60 * 1000;
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= now - sevenDaysMs &&
    value <= now + fiveMinutesMs
  ) {
    return Math.floor(value / 1000);
  }
  return Math.floor(now / 1000);
}

function safeSourceUrl(raw: string, allowedOrigins: Set<string>): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !allowedOrigins.has(url.origin)) return null;
    return `${url.origin}${url.pathname}`.slice(0, 1000);
  } catch {
    return null;
  }
}

export function buildMetaServerEvent(
  input: MetaConversionInput,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> | null {
  const resolvedConfig = config(env);
  const mapped = metaEventNameForSiteEvent(input.siteEventName);
  if (!resolvedConfig || !mapped) return null;

  const eventSourceUrl = safeSourceUrl(input.eventSourceUrl, resolvedConfig.allowedOrigins);
  if (!eventSourceUrl) return null;

  const userData: Record<string, unknown> = {
    external_id: [sha256(input.visitorId)],
  };
  if (input.email?.trim()) userData.em = [sha256(normalizedEmail(input.email))];
  if (input.clientIpAddress) userData.client_ip_address = input.clientIpAddress;
  if (input.clientUserAgent) userData.client_user_agent = input.clientUserAgent.slice(0, 500);
  if (input.fbp) userData.fbp = input.fbp.slice(0, 500);
  if (input.fbc) userData.fbc = input.fbc.slice(0, 500);

  const customData: Record<string, unknown> = {};
  if (input.ctaOrFeature) customData.content_name = input.ctaOrFeature.slice(0, 200);
  if (typeof input.value === "number" && Number.isFinite(input.value) && input.value >= 0) {
    customData.value = input.value;
    customData.currency = (input.currency || "USD").toUpperCase().slice(0, 3);
  }

  return {
    event_name: mapped.name,
    event_time: eventTimeSeconds(input.eventTimeMs),
    event_id: input.eventId,
    event_source_url: eventSourceUrl,
    action_source: "website",
    user_data: userData,
    ...(Object.keys(customData).length ? { custom_data: customData } : {}),
  };
}

export async function sendMetaConversion(
  input: MetaConversionInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const resolvedConfig = config(env);
  const serverEvent = buildMetaServerEvent(input, env);
  if (!resolvedConfig || !serverEvent) return false;

  const body: Record<string, unknown> = { data: [serverEvent] };
  if (resolvedConfig.testEventCode) body.test_event_code = resolvedConfig.testEventCode;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(
      `https://graph.facebook.com/${resolvedConfig.graphVersion}/${resolvedConfig.pixelId}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resolvedConfig.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      logger.warn(
        { status: response.status, eventName: serverEvent.event_name, eventId: input.eventId },
        "Meta conversion delivery failed",
      );
      return false;
    }
    return true;
  } catch (error) {
    logger.warn(
      { err: error, eventName: serverEvent.event_name, eventId: input.eventId },
      "Meta conversion delivery failed",
    );
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
