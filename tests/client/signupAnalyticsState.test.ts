import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeSignupInProgress,
  markSignupInProgress,
} from "../../client/src/lib/signupAnalyticsState";

function stubCookieDocument() {
  let cookie = "";
  vi.stubGlobal("document", {
    get cookie() {
      return cookie;
    },
    set cookie(value: string) {
      cookie = value.includes("Max-Age=0") ? "" : (value.split(";")[0] ?? "");
    },
  });
  vi.stubGlobal("location", { protocol: "https:" });
  return () => cookie;
}

describe("signup analytics state", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("marks once and consumes the signup state from session storage", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    stubCookieDocument();

    expect(markSignupInProgress()).toBe(true);
    expect(markSignupInProgress()).toBe(false);
    expect(consumeSignupInProgress()).toBe(true);
    expect(consumeSignupInProgress()).toBe(false);
  });

  it("uses the short-lived first-party cookie when session storage is unavailable", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    const cookie = stubCookieDocument();

    expect(markSignupInProgress()).toBe(true);
    expect(cookie()).toBe("scholarmark_signup_in_progress=1");
    expect(markSignupInProgress()).toBe(false);
    expect(consumeSignupInProgress()).toBe(true);
    expect(cookie()).toBe("");
  });
});
