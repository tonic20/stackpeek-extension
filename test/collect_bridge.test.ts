import { describe, it, expect, beforeEach, vi } from "vitest";
import { collectFromActiveTab } from "../lib/collect_bridge";
import { InjectionDeniedError } from "../lib/errors";
import { WINDOW_GLOBALS } from "../lib/window_globals";
import { stubBrowser } from "./setup";

beforeEach(() => {
  stubBrowser({
    tabs: { query: vi.fn(async () => [{ id: 7, url: "https://demo.example/" }]) },
    scripting: {
      executeScript: vi.fn(async () => [
        { result: { shopify: null, script_urls: ["https://cdn.shopify.com/a.js"], window_globals: [], meta_tags: [] } },
      ]),
    },
    // resolveProbeList (lib/window_globals_config) reads/writes this; no
    // cached entry and no fetch mock here means it falls back to the bundled
    // WINDOW_GLOBALS list, which is all these tests care about.
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
      },
    },
  });
  globalThis.fetch = vi.fn().mockRejectedValue(new Error("no network in this test")) as unknown as typeof fetch;
});

describe("collectFromActiveTab", () => {
  it("returns signals + url from the active tab", async () => {
    const { signals, url } = await collectFromActiveTab();
    // The bundled mock tab has no path or query (see beforeEach), so origin
    // truncation is a no-op here beyond dropping the trailing slash that
    // `new URL(...).origin` never includes. The truncation itself -- a tab
    // whose URL actually carries a path and query string -- is covered by
    // "truncates the tab URL to its origin" below.
    expect(url).toBe("https://demo.example");
    expect((signals as { script_urls: string[] }).script_urls).toContain("https://cdn.shopify.com/a.js");
  });

  // The privacy-relevant case: a tab URL routinely carries search terms,
  // discount codes, UTM parameters and cart tokens in its path and query
  // string. /privacy promises only "the store's domain" leaves the browser,
  // so everything past the origin must be dropped before this function
  // returns -- not later, at whichever call site happens to use it.
  it("truncates the tab URL to its origin, dropping path, query and fragment", async () => {
    (chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 7, url: "https://demo.example:8443/products/foo?discount=SAVE10&utm_source=x#reviews" },
    ]);

    const { url } = await collectFromActiveTab();

    expect(url).toBe("https://demo.example:8443");
  });

  // tab.url is typed string | undefined, and `new URL(undefined as any)`
  // throws. Undefined in must stay undefined out rather than becoming the
  // string "undefined" or crashing the scan.
  it("returns undefined when the active tab has no url", async () => {
    (chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 7, url: undefined }]);

    const { url } = await collectFromActiveTab();

    expect(url).toBeUndefined();
  });

  // A detect round already survives a missing URL (the no-active-tab and
  // no-url cases above); it must survive a malformed one the same way. A
  // crash here would turn a cosmetic problem into a failed scan on a page
  // the user is looking at.
  it("returns undefined for an unparseable tab url instead of throwing", async () => {
    (chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 7, url: "not-a-valid-url" },
    ]);

    const { url } = await collectFromActiveTab();

    expect(url).toBeUndefined();
  });

  it("returns null signals when injection throws (restricted tab)", async () => {
    (chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Cannot access chrome:// URL"),
    );
    const { signals } = await collectFromActiveTab();
    expect(signals).toBeNull();
  });

  // A refusal and a restricted page are different facts and must not collapse
  // into one. "Can't scan this page" is false about a storefront the user can
  // scan in one click from the toolbar.
  it("throws when the injection is refused for want of permission", async () => {
    (chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Cannot access contents of the page. Extension manifest must request permission to access the respective host."),
    );

    await expect(collectFromActiveTab()).rejects.toBeInstanceOf(InjectionDeniedError);
  });

  // Firefox words the same refusal differently, and the wording is the only
  // thing there is to classify on. Observed on Firefox 153 (2026-08-18) on a
  // real storefront: the panel auto-rescans when the active tab changes, that
  // rescan carries no user gesture, and Firefox has already revoked the
  // activeTab grant the toolbar click gave us -- so every scan after a
  // navigation threw this, fell past the Chrome-only patterns, and rendered
  // "Can't scan this page" on a storefront one click away from scanning.
  it("throws when Firefox refuses the injection for want of permission", async () => {
    (chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Missing host permission for the tab"),
    );

    await expect(collectFromActiveTab()).rejects.toBeInstanceOf(InjectionDeniedError);
  });

  // Firefox's frame variant of the same refusal (bugzilla 1448129).
  it("throws when Firefox refuses the injection for a frame", async () => {
    (chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Frame not found, or missing host permission"),
    );

    await expect(collectFromActiveTab()).rejects.toBeInstanceOf(InjectionDeniedError);
  });

  it("still returns null signals for a genuinely restricted page", async () => {
    (chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Cannot access a chrome:// URL"),
    );

    const { signals } = await collectFromActiveTab();
    expect(signals).toBeNull();
  });

  // An empty tabs.query result is not an error: it degrades to the same
  // "nothing to scan" answer a restricted page gives, without ever reaching
  // the injection.
  it("returns null signals when there is no active tab", async () => {
    (chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { signals, url } = await collectFromActiveTab();

    expect(signals).toBeNull();
    expect(url).toBeUndefined();
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("resolves the probe list and passes it to the injected collector", async () => {
    await collectFromActiveTab();
    const call = (chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.args[0]).toEqual(expect.arrayContaining([...WINDOW_GLOBALS]));
  });

  it("injects immediately instead of waiting for document_idle", async () => {
    await collectFromActiveTab();
    const call = (chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.injectImmediately).toBe(true);
    expect(call.args[1]).toBe(1500);
  });
});
