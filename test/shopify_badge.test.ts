import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installShopifyBadge, probeShopify, BADGE_TEXT, BADGE_COLOR } from "../lib/shopify_badge";
import type { HostAccess } from "../lib/host_access";
import { stubBrowser } from "./setup";

type Listener = (...args: any[]) => void;
const listeners = () => ({
  fns: [] as Listener[],
  get api() {
    return {
      addListener: (fn: Listener) => this.fns.push(fn),
      removeListener: (fn: Listener) => { this.fns = this.fns.filter((f) => f !== fn); },
    };
  },
  fire(...args: unknown[]) { this.fns.forEach((fn) => fn(...args)); },
});

let onUpdated: ReturnType<typeof listeners>;
let onActivated: ReturnType<typeof listeners>;
let onAdded: ReturnType<typeof listeners>;
let onRemoved: ReturnType<typeof listeners>;
let badges: Map<number, string>;
let pages: Map<number, boolean | "restricted">;
let executeScript: ReturnType<typeof vi.fn>;
let granted: boolean;

const access: HostAccess = {
  has: async () => granted,
  request: async () => true,
  remove: async () => true,
  watch: () => ({ stop: () => {} }),
  blocksAutoScan: async () => false,
};

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  onUpdated = listeners(); onActivated = listeners(); onAdded = listeners(); onRemoved = listeners();
  badges = new Map();
  pages = new Map<number, boolean | "restricted">([[1, true], [2, false], [3, "restricted"]]);
  granted = true;
  executeScript = vi.fn(async ({ target }: { target: { tabId: number } }) => {
    const page = pages.get(target.tabId);
    if (page === "restricted") throw new Error("Cannot access a chrome:// URL");
    return [{ result: page }];
  });
  stubBrowser({
    tabs: {
      onUpdated: onUpdated.api,
      onActivated: onActivated.api,
      query: vi.fn(async (q: { active?: boolean }) =>
        q.active ? [{ id: 1 }] : [{ id: 1 }, { id: 2 }, { id: 3 }]),
    },
    scripting: { executeScript },
    action: {
      setBadgeText: vi.fn(async ({ tabId, text }: { tabId: number; text: string }) => { badges.set(tabId, text); }),
      setBadgeBackgroundColor: vi.fn(async () => {}),
      setBadgeTextColor: vi.fn(async () => {}),
    },
    permissions: { onAdded: onAdded.api, onRemoved: onRemoved.api },
  });
});

afterEach(() => {
  stubBrowser({});
  delete (globalThis as any).Shopify;
});

describe("probeShopify", () => {
  // Injected, so it has to run on its own source alone.
  const injected = () => new Function(`return (${probeShopify.toString()})`)() as typeof probeShopify;

  it("recognises a storefront by window.Shopify.shop", () => {
    (globalThis as any).Shopify = { shop: "demo.myshopify.com", theme: {} };
    expect(injected()()).toBe(true);
  });

  // Some other site's global that happens to share the name.
  it("ignores a Shopify global with no shop", () => {
    (globalThis as any).Shopify = { analytics: {} };
    expect(injected()()).toBe(false);
  });

  it("says no where there is no Shopify at all", () => {
    expect(injected()()).toBe(false);
  });
});

describe("installShopifyBadge", () => {
  it("dots a storefront once it has loaded, in the page's own world", async () => {
    installShopifyBadge(access);
    await settle();

    onUpdated.fire(1, { status: "complete" });
    await settle();

    expect(badges.get(1)).toBe(BADGE_TEXT);
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 1 }, world: "MAIN" }));
  });

  it("leaves other pages unmarked, and restricted ones quietly so", async () => {
    installShopifyBadge(access);
    await settle();

    onUpdated.fire(2, { status: "complete" });
    onUpdated.fire(3, { status: "complete" });
    await settle();

    expect(badges.get(2)).toBe("");
    expect(badges.get(3)).toBe("");
  });

  // The dot must not sit over the next page while it loads.
  it("clears the dot the moment a navigation starts", async () => {
    installShopifyBadge(access);
    await settle();
    onUpdated.fire(1, { status: "complete" });
    await settle();

    onUpdated.fire(1, { status: "loading" });

    expect(badges.get(1)).toBe("");
  });

  // A check still in flight when the tab navigates describes the page that
  // was left, and must not put the dot back.
  it("drops a late answer for a page that has since been left", async () => {
    let release!: () => void;
    executeScript.mockImplementationOnce(() => new Promise((r) => { release = () => r([{ result: true }]); }));
    installShopifyBadge(access);
    await settle();

    onUpdated.fire(1, { status: "complete" });
    onUpdated.fire(1, { status: "loading" });
    release();
    await settle();

    expect(badges.get(1)).toBe("");
  });

  it("checks a tab when it is switched to", async () => {
    installShopifyBadge(access);
    await settle();

    onActivated.fire({ tabId: 1 });
    await settle();

    expect(badges.get(1)).toBe(BADGE_TEXT);
  });

  it("colours the badge with the brand accent, not Shopify's green", async () => {
    installShopifyBadge(access);
    expect((globalThis as any).browser.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: BADGE_COLOR });
  });

  // Nothing in this module may reach the API. The only network-shaped thing
  // it does is the in-page probe.
  it("sends nothing anywhere", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    installShopifyBadge(access);
    await settle();
    onUpdated.fire(1, { status: "complete" });
    onActivated.fire({ tabId: 2 });
    await settle();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe("without access", () => {
    beforeEach(() => { granted = false; });

    // Registered synchronously so a waking event is not missed, then taken
    // back out as soon as the check says there is no access.
    it("listens to no tab events", async () => {
      installShopifyBadge(access);
      await settle();

      expect(onUpdated.fns).toHaveLength(0);
      expect(onActivated.fns).toHaveLength(0);
      onUpdated.fire(1, { status: "complete" });
      expect(executeScript).not.toHaveBeenCalled();
    });

    it("starts when access is granted, marking the tabs already in front", async () => {
      installShopifyBadge(access);
      await settle();

      granted = true;
      onAdded.fire({ origins: ["https://*/*", "http://*/*"] });
      await settle(); await settle();

      expect(onUpdated.fns).toHaveLength(1);
      expect(badges.get(1)).toBe(BADGE_TEXT);
    });
  });

  it("stops, and clears every badge, when access is removed", async () => {
    installShopifyBadge(access);
    await settle();
    onUpdated.fire(1, { status: "complete" });
    await settle();

    granted = false;
    onRemoved.fire({ origins: ["https://*/*"] });
    await settle(); await settle();

    expect(onUpdated.fns).toHaveLength(0);
    expect(onActivated.fns).toHaveLength(0);
    expect([...badges.values()]).toEqual(["", "", ""]);
  });

  it("is inert where the extension APIs are missing", () => {
    stubBrowser({});
    expect(() => installShopifyBadge(access)).not.toThrow();
  });
});
