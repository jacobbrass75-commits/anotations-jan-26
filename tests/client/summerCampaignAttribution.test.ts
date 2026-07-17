import { describe, expect, it } from "vitest";
import {
  buildCampaignAttributionSearch,
  mergeCampaignAttribution,
} from "../../client/src/pages/SummerCampaign";

describe("summer campaign attribution", () => {
  it("does not erase saved campaign values when the next URL omits them", () => {
    expect(
      mergeCampaignAttribution(
        { utmSource: "ig", utmMedium: "paid", utmCampaign: "campaign-123" },
        { utmSource: undefined, utmMedium: undefined, utmCampaign: undefined },
      ),
    ).toEqual({ utmSource: "ig", utmMedium: "paid", utmCampaign: "campaign-123" });
  });

  it("restores saved campaign values into the signup query without dropping fbclid", () => {
    expect(
      buildCampaignAttributionSearch("?fbclid=click-123", {
        utmSource: "ig",
        utmMedium: "paid",
        utmCampaign: "campaign-123",
        utmContent: "reel-4",
      }),
    ).toBe(
      "fbclid=click-123&utm_source=ig&utm_medium=paid&utm_campaign=campaign-123&utm_content=reel-4",
    );
  });
});
