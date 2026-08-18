import { describe, it, expect, vi } from "vitest";
import { browser } from "wxt/browser";
import { stubBrowser } from "./setup";

describe("stubBrowser", () => {
  it("is visible through the wxt/browser binding captured at import", () => {
    const get = vi.fn(async () => ({}));
    stubBrowser({ storage: { local: { get } } });
    expect(browser.storage.local.get).toBe(get);
  });

  it("is visible through globalThis.chrome, which is the same object", () => {
    const get = vi.fn(async () => ({}));
    stubBrowser({ storage: { local: { get } } });
    expect(globalThis.chrome.storage.local.get).toBe(get);
    expect(globalThis.chrome as unknown).toBe(browser as unknown);
  });

  it("clears keys from the previous stub", () => {
    stubBrowser({ storage: { local: { get: vi.fn() } } });
    stubBrowser({ tabs: { query: vi.fn() } });
    expect(browser.storage).toBeUndefined();
  });

  it("preserves runtime and i18n so the alias and message lookup survive", () => {
    stubBrowser({});
    expect(browser.runtime.id).toBe("vitest");
    expect(typeof browser.i18n.getMessage).toBe("function");
  });
});
