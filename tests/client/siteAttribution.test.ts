import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeSiteAttribution, readSiteAttribution } from "../../client/src/lib/siteAttribution";

describe("site attribution", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps campaign values when the next page has no UTM parameters", () => {
    expect(
      mergeSiteAttribution(
        {
          utmSource: "ig",
          utmMedium: "paid",
          utmCampaign: "campaign-123",
          utmContent: "reel-4",
          referrer: "https://l.instagram.com/",
        },
        {
          utmSource: null,
          utmMedium: null,
          utmCampaign: null,
          utmContent: null,
          referrer: "https://scholarmark.ai/",
        },
      ),
    ).toEqual({
      utmSource: "ig",
      utmMedium: "paid",
      utmCampaign: "campaign-123",
      utmContent: "reel-4",
      referrer: "https://l.instagram.com/",
    });
  });

  it("updates explicit campaign values without replacing the first referrer", () => {
    expect(
      mergeSiteAttribution(
        { utmSource: "newsletter", referrer: "https://mail.example/" },
        { utmSource: "ig", utmMedium: "paid", referrer: "https://l.instagram.com/" },
      ),
    ).toEqual({
      utmSource: "ig",
      utmMedium: "paid",
      referrer: "https://mail.example/",
    });
  });

  it("drops empty values from malformed stored attribution", () => {
    expect(
      mergeSiteAttribution(
        { utmSource: "", utmCampaign: null },
        { utmSource: "ig", utmMedium: "   " },
      ),
    ).toEqual({ utmSource: "ig" });
  });

  it("recovers campaign attribution from a first-party cookie when storage is blocked", () => {
    const saved = JSON.stringify({
      utmSource: "ig",
      utmMedium: "paid",
      utmCampaign: "campaign-123",
      referrer: "https://l.instagram.com/",
    });
    vi.stubGlobal("document", {
      referrer: "https://scholarmark.ai/sign-up",
      cookie: `scholarmark_site_attribution_v1=${encodeURIComponent(saved)}`,
    });
    vi.stubGlobal("location", { protocol: "https:" });
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });

    expect(readSiteAttribution(new URLSearchParams())).toEqual({
      utmSource: "ig",
      utmMedium: "paid",
      utmCampaign: "campaign-123",
      referrer: "https://l.instagram.com/",
    });
  });
});
