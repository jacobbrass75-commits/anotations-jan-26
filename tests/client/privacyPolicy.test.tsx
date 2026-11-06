// @vitest-environment jsdom

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const IOS_ROOT = join(__dirname, "..", "..", "ios");

function swiftFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "Tests" ? [] : swiftFiles(path);
    return name.endsWith(".swift") ? [path] : [];
  });
}

describe("Privacy page", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    // Vitest compiles page JSX with the classic runtime, which expects a global React.
    (globalThis as { React?: typeof React }).React = React;
    const { default: Privacy } = await import("../../client/src/pages/Privacy");
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(Privacy));
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps the existing web, extension, and connector sections", () => {
    const headings = Array.from(container.querySelectorAll("h2")).map((h) => h.textContent);
    expect(headings).toEqual([
      "What ScholarMark Collects",
      "How Data Is Used",
      "Chrome Extension Permissions",
      "Claude, ChatGPT, And Codex Connector",
      "ScholarMark For iPhone And iPad",
      "Service Providers",
      "Your Controls",
      "Students And Schools",
      "Contact",
      "Advertising Privacy Choice",
    ]);
  });

  it("gives the iOS section a stable anchor and separates it from the web service", () => {
    const section = container.querySelector("section#ios");
    expect(section?.querySelector("h2")?.textContent).toBe("ScholarMark For iPhone And iPad");
    const text = section?.textContent ?? "";
    expect(text).toContain("does not connect to or sync with the ScholarMark web service");
    expect(text).toContain("ScholarMark does not receive them");
    expect(text).toContain("only when you tap Look up details");
    expect(text).toContain("doi.org");
    expect(text).toContain("ScholarMark does not control what they log or keep");
    expect(container.textContent).toContain("ScholarMark app for iPhone and iPad");
  });

  it("names only iOS controls that exist in the app", () => {
    const swift = swiftFiles(join(IOS_ROOT, "ScholarMark"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    for (const label of [
      "Look up details",
      "Open source",
      "Share citation",
      "Export full library backup",
      "Delete all projects and sources",
      'Tab("Settings"',
    ]) {
      expect(swift, label).toContain(label);
    }
  });

  it("matches the app's single network path and empty privacy manifest", () => {
    const users = swiftFiles(IOS_ROOT).filter((path) =>
      /\bURLSession\b/.test(readFileSync(path, "utf8")),
    );
    expect(users.map((path) => path.split("/").pop())).toEqual(["MetadataLookup.swift"]);

    const manifest = readFileSync(join(IOS_ROOT, "ScholarMark", "PrivacyInfo.xcprivacy"), "utf8");
    expect(manifest).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
    expect(manifest).toMatch(/<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\/>/);
  });
});
