import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildMetaServerEvent,
  isMetaConversionsConfigured,
  isRecentMetaRegistration,
  sendMetaConversion,
} from "../../server/metaConversions";

const enabledEnv = {
  META_TRACKING_ENABLED: "true",
  META_PIXEL_ID: "1234567890",
  META_CONVERSIONS_API_TOKEN: "server-secret-token",
  META_GRAPH_API_VERSION: "v25.0",
  META_ALLOWED_EVENT_ORIGINS: "https://scholarmark.ai,https://app.scholarmark.ai",
  META_TEST_EVENT_CODE: "TEST123",
} as NodeJS.ProcessEnv;

const input = {
  siteEventName: "signup_completed",
  eventId: "registration-event-123",
  eventTimeMs: Date.now(),
  eventSourceUrl: "https://scholarmark.ai/sign-up?private=query#fragment",
  visitorId: "visitor-12345678",
  email: " Student@Example.com ",
  clientIpAddress: "203.0.113.10",
  clientUserAgent: "ScholarMark Test Browser",
  fbp: "fb.1.123.abc",
  fbc: "fb.1.123.click",
  ctaOrFeature: "clerk_signup",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Meta Conversions API", () => {
  it("accepts only a recently created authenticated user as a registration", () => {
    const now = Date.parse("2026-07-16T18:00:00.000Z");
    expect(isRecentMetaRegistration(Date.parse("2026-07-16T17:45:00.000Z"), now)).toBe(true);
    expect(isRecentMetaRegistration(Date.parse("2026-07-16T16:00:00.000Z"), now)).toBe(false);
    expect(isRecentMetaRegistration(undefined, now)).toBe(false);
  });

  it("is disabled unless explicitly configured", () => {
    expect(isMetaConversionsConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(buildMetaServerEvent(input, {} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("builds a deduplicated, sanitized, hashed registration event", () => {
    const event = buildMetaServerEvent(input, enabledEnv) as any;
    expect(event).toMatchObject({
      event_name: "CompleteRegistration",
      event_id: "registration-event-123",
      event_source_url: "https://scholarmark.ai/sign-up",
      action_source: "website",
      custom_data: { content_name: "clerk_signup" },
    });
    expect(event.user_data.em).toEqual([
      createHash("sha256").update("student@example.com").digest("hex"),
    ]);
    expect(event.user_data.external_id).toEqual([
      createHash("sha256").update("visitor-12345678").digest("hex"),
    ]);
    expect(JSON.stringify(event)).not.toContain("Student@Example.com");
    expect(JSON.stringify(event)).not.toContain("private=query");
  });

  it("rejects event source URLs outside the configured ScholarMark origins", () => {
    expect(
      buildMetaServerEvent(
        { ...input, eventSourceUrl: "https://evil.example/sign-up" },
        enabledEnv,
      ),
    ).toBeNull();
  });

  it("delivers without putting the access token in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendMetaConversion(input, enabledEnv)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v25.0/1234567890/events");
    expect(url).not.toContain("server-secret-token");
    expect(options.headers.Authorization).toBe("Bearer server-secret-token");
    expect(JSON.parse(options.body)).toMatchObject({
      test_event_code: "TEST123",
      data: [{ event_id: "registration-event-123" }],
    });
  });
});
