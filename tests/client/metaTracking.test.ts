import { describe, expect, it } from "vitest";
import {
  isMetaMarketingPath,
  isMetaPixelConfigValid,
  metaEventNameForSiteEvent,
} from "../../client/src/lib/metaTracking";

describe("Meta browser tracking", () => {
  it("requires both the browser feature flag and a numeric Pixel ID", () => {
    expect(isMetaPixelConfigValid(false, "1234567890")).toBe(false);
    expect(isMetaPixelConfigValid(true, "not-a-pixel")).toBe(false);
    expect(isMetaPixelConfigValid(true, "1234567890")).toBe(true);
  });

  it("maps only the registration funnel to Meta events", () => {
    expect(metaEventNameForSiteEvent("landing_view")).toEqual({
      name: "PageView",
      custom: false,
    });
    expect(metaEventNameForSiteEvent("signup_started")).toEqual({
      name: "SignupStarted",
      custom: true,
    });
    expect(metaEventNameForSiteEvent("signup_completed")).toEqual({
      name: "CompleteRegistration",
      custom: false,
    });
    expect(metaEventNameForSiteEvent("purchase_completed")).toBeNull();
    expect(metaEventNameForSiteEvent("first_project_created")).toBeNull();
  });

  it("keeps the Pixel off authenticated research routes", () => {
    expect(isMetaMarketingPath("/")).toBe(true);
    expect(isMetaMarketingPath("/start")).toBe(true);
    expect(isMetaMarketingPath("/sign-up")).toBe(true);
    expect(isMetaMarketingPath("/summer/onboarding")).toBe(true);
    expect(isMetaMarketingPath("/projects/project-1")).toBe(false);
    expect(isMetaMarketingPath("/chat/conversation-1")).toBe(false);
  });
});
