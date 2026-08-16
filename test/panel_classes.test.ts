import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/svelte";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import App from "../entrypoints/sidepanel/App.svelte";
import * as api from "../lib/api";
import type { DetectResponse } from "../lib/api";
import * as ident from "../lib/install_id";
import { InjectionDeniedError } from "../lib/errors";

// The panel names classes it does not define -- panel.css is byte-locked to the
// design bundle, and every component test asserts by querying the class it just
// wrote, so a typo renders an unstyled element that nothing catches. This walks
// what the panel actually emits, in every state, and checks each sp- class
// against the stylesheet. Deliberately not a scan of the .svelte source: what
// matters is the rendered DOM, and a scan cannot tell a class from an attribute
// value like data-sp-cat.
const PANEL_CSS = readFileSync(resolve(__dirname, "../entrypoints/sidepanel/panel.css"), "utf8");

// (?![\w-]) so that `.sp-theme` does not vouch for a typo'd `.sp-them`, which a
// bare substring check would happily accept.
function definedInPanelCss(token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\.${escaped}(?![\\w-])`).test(PANEL_CSS);
}

function spClassesIn(root: ParentNode): string[] {
  return [...root.querySelectorAll<HTMLElement>("[class]")]
    .flatMap((el) => [...el.classList])
    .filter((c) => c.startsWith("sp-"));
}

const signals = {
  shopify: { shop: "demo.myshopify.com", theme: { theme_store_id: 887, name: "Dawn" } },
  script_urls: ["https://cdn.shopify.com/a.js"], window_globals: [], meta_tags: [],
};
const fakeRunner = async () => ({ signals, url: "https://demo.example/" });
const emptyRunner = async () => ({ signals: null, url: undefined });

// Covers every branch that emits markup: linked and unlinked names, the forked
// theme variant, a flagged app, a populated Trackers section and Infrastructure.
const RESULT = {
  is_shopify: true,
  theme: { name: "Dawn", origin: "forked", version: "15.1.0", price: "Free",
           theme_url: "https://themes.shopify.com/themes/dawn" },
  apps: [
    { name: "Klaviyo", category: "Email & SMS", category_slug: "email-sms",
      app_store_url: "https://apps.shopify.com/klaviyo", verified: true },
    { name: "Mystery", category: "Localization", category_slug: "localization",
      app_store_url: "", verified: false },
  ],
  pixels: [{ name: "Meta Pixel" }],
  infrastructure: [{ name: "Shopify Payments" }],
  unknown_domain_count: 2,
} as unknown as DetectResponse;

beforeEach(() => {
  vi.spyOn(ident, "getInstallId").mockResolvedValue("k1");
  globalThis.chrome = {
    ...(globalThis.chrome ?? {}),
    runtime: { getManifest: () => ({ version: "0.0.0" }) },
    // The footer's theme toggle reads and writes its preference.
    storage: { local: { get: async () => ({}), set: async () => {} } },
  } as unknown as typeof chrome;
});

describe("every sp- class the panel emits is defined in panel.css", () => {
  it("across the result, loading and terminal states", async () => {
    const emitted = new Set<string>();

    // Result: the full body, plus the settled header and the footer.
    vi.spyOn(api, "postDetect").mockResolvedValue(RESULT);
    const result = render(App, {
      props: {
        runner: fakeRunner, autostart: true, delays: [0],
        catalogue: async () => ({
          available: true, reason: null, count: 2, variants: 3, priceMin: 10, priceMax: 40,
          newest: "2026-08-01T00:00:00Z", currency: "USD",
          index: [
            { handle: "a", title: "Runner up", price: "10.00" },
            { handle: "b", title: "Bestseller", price: "20.00" },
          ],
        }),
        collectionPages: async () => {
          const grid = (hs: string[]) =>
            `<html><body><ul>${hs.map((h) => `<li><a href="/products/${h}">${h}</a></li>`).join("")}</ul></body></html>`;
          return { bestSelling: grid(["b", "a"]), alphabetical: grid(["a", "b"]) };
        },
      },
    });
    await vi.waitFor(() => expect(result.container.querySelector(".sp-theme")).toBeTruthy());
    spClassesIn(result.container).forEach((c) => emitted.add(c));
    result.unmount();

    // Held: the same result, with the notice that the tab in front of the user
    // is a listing the panel opened rather than the store below.
    let hold!: (holding: boolean) => void;
    const held = render(App, {
      props: {
        runner: fakeRunner, autostart: true, delays: [0],
        watch: (_c: () => void, opts?: { onHold?: (h: boolean) => void }) => {
          hold = opts!.onHold!;
          return { stop: () => {} };
        },
      },
    });
    await vi.waitFor(() => expect(held.container.querySelector(".sp-theme")).toBeTruthy());
    hold(true);
    await vi.waitFor(() => expect(held.container.querySelector("[role=status]")).toBeTruthy());
    spClassesIn(held.container).forEach((c) => emitted.add(c));
    held.unmount();

    // Loading: the skeleton, and the header's scan indicator.
    vi.spyOn(api, "postDetect").mockImplementation(() => new Promise<DetectResponse>(() => {}));
    const loading = render(App, { props: { runner: fakeRunner, autostart: true } });
    await vi.waitFor(() => expect(loading.container.querySelector(".sp-skel")).toBeTruthy());
    spClassesIn(loading.container).forEach((c) => emitted.add(c));
    loading.unmount();

    // not_shopify: quiet action.
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: false, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    } as unknown as DetectResponse);
    const notShopify = render(App, { props: { runner: fakeRunner, autostart: true, delays: [0] } });
    await vi.waitFor(() => expect(notShopify.container.querySelector(".sp-state")).toBeTruthy());
    spClassesIn(notShopify.container).forEach((c) => emitted.add(c));
    notShopify.unmount();

    // cant_scan: no action, and no rescan button in the header.
    const cantScan = render(App, { props: { runner: emptyRunner, autostart: true, delays: [0] } });
    await vi.waitFor(() => expect(cantScan.container.querySelector(".sp-state")).toBeTruthy());
    spClassesIn(cantScan.container).forEach((c) => emitted.add(c));
    cantScan.unmount();

    // error and rate_limited: primary action.
    for (const error of [new api.ApiError("boom"), new api.RateLimitError()]) {
      vi.spyOn(api, "postDetect").mockRejectedValue(error);
      const failed = render(App, { props: { runner: fakeRunner, autostart: true, delays: [0] } });
      await vi.waitFor(() => expect(failed.container.querySelector(".sp-state")).toBeTruthy());
      spClassesIn(failed.container).forEach((c) => emitted.add(c));
      failed.unmount();
    }

    // needs_permission: no action, and no rescan button in the header.
    const denied = render(App, {
      props: {
        runner: async () => { throw new InjectionDeniedError("denied"); },
        autostart: true, delays: [0],
      },
    });
    await vi.waitFor(() => expect(denied.container.querySelector(".sp-state")).toBeTruthy());
    spClassesIn(denied.container).forEach((c) => emitted.add(c));
    denied.unmount();

    // A guard that walked an empty DOM would pass silently. Pin that it saw the
    // panel it thinks it saw.
    expect(emitted.size).toBeGreaterThan(25);
    expect(emitted.has("sp-panel")).toBe(true);

    const undefinedClasses = [...emitted].filter((c) => !definedInPanelCss(c)).sort();
    expect(undefinedClasses, "these classes are emitted but panel.css defines none of them").toEqual([]);
  });
});
