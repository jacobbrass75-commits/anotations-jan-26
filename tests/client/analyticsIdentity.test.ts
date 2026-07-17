import { afterEach, describe, expect, it, vi } from "vitest";
import { getAnalyticsId } from "../../client/src/lib/analyticsIdentity";

function stubCookieJar(initial: Record<string, string> = {}) {
  const cookies = new Map(Object.entries(initial));
  vi.stubGlobal("document", {
    get cookie() {
      return Array.from(cookies, ([key, value]) => `${key}=${encodeURIComponent(value)}`).join(
        "; ",
      );
    },
    set cookie(value: string) {
      const [pair] = value.split(";");
      const separator = pair?.indexOf("=") ?? -1;
      if (!pair || separator < 1) return;
      const key = pair.slice(0, separator);
      const encoded = pair.slice(separator + 1);
      if (value.includes("Max-Age=0")) cookies.delete(key);
      else cookies.set(key, decodeURIComponent(encoded));
    },
  });
  vi.stubGlobal("location", { protocol: "https:" });
  return cookies;
}

describe("analytics identity", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses a cookie-backed ID when browser storage is blocked", () => {
    const key = "scholarmark_test_visitor_id";
    const cookies = stubCookieJar({ [key]: "stable-instagram-visitor" });
    const blockedStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;

    expect(getAnalyticsId(blockedStorage, key)).toBe("stable-instagram-visitor");
    expect(cookies.get(key)).toBe("stable-instagram-visitor");
  });

  it("mirrors an existing storage ID into a first-party cookie", () => {
    const key = "scholarmark_test_session_id";
    const cookies = stubCookieJar();
    const storage = {
      getItem: () => "stable-session",
    } as unknown as Storage;

    expect(getAnalyticsId(storage, key)).toBe("stable-session");
    expect(cookies.get(key)).toBe("stable-session");
  });
});
