import { describe, it, expect, afterEach } from "vitest";
import { extensionVersion } from "../lib/version";

afterEach(() => {
  // @ts-expect-error `chrome` only exists inside the extension; tests install
  // and remove it per case.
  delete globalThis.chrome;
});

describe("extensionVersion", () => {
  it("reads the version from the manifest", () => {
    globalThis.chrome = {
      runtime: { getManifest: () => ({ version: "9.9.9" }) },
    } as unknown as typeof chrome;

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
