import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/svelte";
import App from "../entrypoints/sidepanel/App.svelte";
import * as api from "../lib/api";
import * as ident from "../lib/install_id";
import { loadSections } from "../lib/sections.svelte";

// The panel's section ids are storage keys AND DOM ids, and every id must be
// unique across the assembled panel -- a collision would weld two sections to
// one collapse preference and put a duplicate id in the document.
//
// This file exists because it is the only one that renders the whole panel.
// Each component test renders one section in isolation, so none of them can
// see a collision between two of them; collapsible.test.ts proves Section
// derives a label from an id, not that the assembled panel's ids are distinct.
//
// It also pins that rendering the panel writes nothing to storage, which is
// the panel-level statement of design D3.

const signals = { shopify: { shop: "demo.myshopify.com", theme: { theme_store_id: null, name: "T" } },
  script_urls: [], window_globals: [], meta_tags: [] };
const fakeRunner = async () => ({ signals, url: "https://demo.example/" });
const tick = () => new Promise((r) => setTimeout(r, 0));

let store: Record<string, unknown>;

beforeEach(async () => {
  vi.spyOn(ident, "getInstallId").mockResolvedValue("k1");
  vi.spyOn(api, "postDetect").mockResolvedValue({
    is_shopify: true,
    theme: { name: "T", origin: "custom", version: null, price: null, creator: null },
    apps: [{ name: "Judge.me", category: "Reviews", category_slug: "reviews", slug: "j", app_store_url: "", matched_on: [], verified: true }],
    pixels: [{ name: "Meta Pixel", category: "Pixel", slug: "m" }],
    infrastructure: [{ name: "Shopify Payments", category: "Payments", slug: "sp" }],
    unknown_domain_count: 0,
  } as never);
  store = {};
  globalThis.chrome = { storage: { local: {
    get: vi.fn(async (k: string) => ({ [k]: store[k] })),
    set: vi.fn(async (o: Record<string, unknown>) => { Object.assign(store, o); }),
  } } } as unknown as typeof chrome;
  await loadSections();
});

afterEach(() => {
  // @ts-expect-error `chrome` only exists inside the extension.
  delete globalThis.chrome;
});

const openMap = (c: HTMLElement) => Object.fromEntries(
  [...c.querySelectorAll("section.sp-sec")].map((s) => [
    s.getAttribute("aria-labelledby"), s.querySelector("details")!.hasAttribute("open"),
  ]));

describe("the panel's sections", () => {
  it("gives every section its own id, so no two share a label or a preference", async () => {
    const { container } = render(App, { props: { runner: fakeRunner, autostart: true } });
    await screen.findByText("Judge.me");
    await tick();

    const ids = [...container.querySelectorAll("section.sp-sec")].map((s) => s.getAttribute("aria-labelledby"));
    expect(ids).toEqual([...new Set(ids)]);
    expect(ids).toContain("sp-trackers-label");
    expect(ids).toContain("sp-infrastructure-label");
  });

  it("restores each section independently from the stored record", async () => {
    store.sections = { trackers: false, infrastructure: false, products: false };
    await loadSections();

    const { container } = render(App, { props: { runner: fakeRunner, autostart: true } });
    await screen.findByText("Judge.me");
    await tick();

    expect(openMap(container)).toEqual({
      "sp-theme-label": true,
      "sp-apps-label": true,
      "sp-trackers-label": false,
      "sp-infrastructure-label": false,
      "sp-products-label": false,
    });
  });

  // Design D3: an absent entry means "no opinion". A <details> starts closed
  // natively, so Svelte setting open={true} after insertion queues a real
  // toggle -- and writing that back would record a preference for all six
  // sections before the user touched anything.
  it("writes nothing to storage merely by rendering", async () => {
    render(App, { props: { runner: fakeRunner, autostart: true } });
    await screen.findByText("Judge.me");
    await tick();

    expect(store).toEqual({});
  });
});
