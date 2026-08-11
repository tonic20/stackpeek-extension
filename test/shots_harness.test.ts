import { describe, it, expect, beforeEach } from "vitest";
import { installChromeShim, harnessProps } from "../shots/main";

describe("shots harness", () => {
  beforeEach(() => {
    // @ts-expect-error deleting the shim between tests
    delete globalThis.chrome;
  });

  it("installs a chrome.storage.local that round-trips values", async () => {
    installChromeShim();

    await globalThis.chrome.storage.local.set({ install_id: "shot" });
    const got = await globalThis.chrome.storage.local.get("install_id");

    expect(got.install_id).toBe("shot");
  });

  it("returns {} for an unset key rather than throwing", async () => {
    installChromeShim();

    const got = await globalThis.chrome.storage.local.get("missing");

    expect(got).toEqual({});
  });

  it("builds a runner that resolves the injected signals", async () => {
    const signals = { shopify: { shop: "demo.myshopify.com" } };
    const props = harnessProps(signals, "https://demo.example/");

    const resolved = await (props.runner as () => Promise<{ signals: unknown; url: string }>)();

    expect(resolved.signals).toEqual(signals);
    expect(resolved.url).toBe("https://demo.example/");
  });

  // watchActiveTab needs a tab. Without a no-op stop() the panel throws on
  // teardown and Playwright photographs an error state.
  it("builds a watch that is inert and stoppable", () => {
    const props = harnessProps({}, "https://demo.example/");
    const handle = (props.watch as (cb: () => void) => { stop: () => void })(() => {});

    expect(typeof handle.stop).toBe("function");
    expect(() => handle.stop()).not.toThrow();
  });

  it("autostarts so the panel renders without a click", () => {
    expect(harnessProps({}, "https://demo.example/").autostart).toBe(true);
  });

  // Four of the five frames must not show the export section. An unavailable
  // digest is how the panel is told there is nothing to export.
  it("reports no catalogue when none is injected", async () => {
    const props = harnessProps({}, "https://demo.example/");

    const digest = await (props.catalogue as () => Promise<{ available: boolean }>)();

    expect(digest.available).toBe(false);
  });

  // Frame 4 is the export frame; it needs a real digest to render one.
  it("passes an injected digest straight through", async () => {
    const injected = {
      available: true, reason: null, count: 412, variants: 1180,
      priceMin: 12, priceMax: 240, newest: "2026-07-30", currency: "USD", index: [],
    };
    const props = harnessProps({}, "https://demo.example/", injected);

    const digest = await (props.catalogue as () => Promise<typeof injected>)();

    expect(digest).toEqual(injected);
  });
});
