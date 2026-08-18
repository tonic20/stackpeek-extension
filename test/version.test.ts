import { describe, it, expect, afterEach } from "vitest";
import { extensionVersion } from "../lib/version";
import { stubBrowser } from "./setup";

afterEach(() => {
  stubBrowser({});
});

describe("extensionVersion", () => {
  it("reads the version from the manifest", () => {
    stubBrowser({
      runtime: { getManifest: () => ({ version: "9.9.9" }) },
    });

    expect(extensionVersion()).toBe("9.9.9");
  });

  // Every panel rendering test mounts App outside a browser extension, where
  // there is no `chrome` at all. A bare `chrome.runtime` reference would be a
  // ReferenceError -- which optional chaining does NOT catch -- and would take
  // down every one of those tests rather than just this behaviour.
  it("returns an empty string where no extension APIs exist", () => {
    expect(extensionVersion()).toBe("");
  });
});
