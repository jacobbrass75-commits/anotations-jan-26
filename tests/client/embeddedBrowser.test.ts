import { describe, expect, it } from "vitest";
import { detectEmbeddedBrowser } from "../../client/src/lib/embeddedBrowser";

describe("detectEmbeddedBrowser", () => {
  it("detects Instagram's iOS browser", () => {
    expect(
      detectEmbeddedBrowser(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Instagram 388.0.0.16.84",
      ),
    ).toBe("instagram");
  });

  it("detects Facebook embedded browsers", () => {
    expect(detectEmbeddedBrowser("Mozilla/5.0 [FBAN/FBIOS;FBAV/518.0.0.44.90;]")).toBe("facebook");
  });

  it("does not flag ordinary Safari", () => {
    expect(
      detectEmbeddedBrowser(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1",
      ),
    ).toBeNull();
  });

  it("supports the explicit browser-test override", () => {
    expect(detectEmbeddedBrowser("ordinary browser", "?embedded_auth=1")).toBe("other");
  });

  it("keeps the Instagram identity when embedded auth is explicitly requested", () => {
    expect(detectEmbeddedBrowser("Instagram 380.0.0", "?embedded_auth=1")).toBe("instagram");
  });
});
