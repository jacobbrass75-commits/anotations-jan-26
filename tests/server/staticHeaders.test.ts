import { describe, expect, it } from "vitest";
import { HTML_CACHE_CONTROL } from "../../server/static";

describe("SPA document cache policy", () => {
  it("never serves stale HTML that can point to deleted hashed assets", () => {
    expect(HTML_CACHE_CONTROL).toContain("no-store");
    expect(HTML_CACHE_CONTROL).toContain("no-cache");
    expect(HTML_CACHE_CONTROL).not.toContain("stale-while-revalidate");
  });
});
