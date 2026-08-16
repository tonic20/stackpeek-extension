import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The module keeps a Set of tab ids for the life of the panel, which is right
// for the panel and wrong for a test file. Re-importing per test is what gives
// each one a clean set; there is no reset export, because production has no
// reason to reset.
let mod: typeof import("../lib/held_tabs");
let created: { url?: string }[];
let resolveCreate: (tab: { id?: number }) => void;

beforeEach(async () => {
  created = [];
  globalThis.chrome = {
    tabs: {
      create: vi.fn((info: { url?: string }) => {
        created.push(info);
        return new Promise((r) => { resolveCreate = r; });
      }),
    },
  } as unknown as typeof chrome;
  vi.resetModules();
  mod = await import("../lib/held_tabs");
});

afterEach(() => {
  // @ts-expect-error `chrome` only exists inside the extension.
  delete globalThis.chrome;
});

// A left click on an <a href> inside the panel, with no modifier held.
// Returns whether the handler took the navigation.
//
// The second listener runs after heldLinkClick -- listeners fire in
// registration order -- so it reads the verdict before cancelling the click
// itself. Without that cancel jsdom tries to follow the href and prints "Not
// implemented: navigation to another Document" over the run.
function clickLink(href: string, init: MouseEventInit = {}): boolean {
  const a = document.createElement("a");
  a.href = href;
  document.body.append(a);
  let prevented = false;
  a.addEventListener("click", mod.heldLinkClick as EventListener);
  a.addEventListener("click", (e) => { prevented = e.defaultPrevented; e.preventDefault(); });
  a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }));
  a.remove();
  return prevented;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("heldLinkClick", () => {
  it("opens the link itself so the panel knows which tab it is", () => {
    const prevented = clickLink("https://apps.shopify.com/pagefly");

    expect(created).toEqual([{ url: "https://apps.shopify.com/pagefly", active: true }]);
    expect(prevented).toBe(true);
  });

  // Cmd-click and its friends mean "background tab", which never becomes
  // active -- so there is no activation to claim and nothing to hold.
  it("leaves a modified click to the browser", () => {
    const prevented = clickLink("https://apps.shopify.com/pagefly", { metaKey: true });

    expect(created).toEqual([]);
    expect(prevented).toBe(false);
  });

  // The site renders this same panel markup as a static demo, where there is
  // no extension API and the anchor must simply be an anchor.
  it("lets the anchor navigate where no extension APIs exist", () => {
    // @ts-expect-error exercising the no-chrome path
    delete globalThis.chrome;

    const prevented = clickLink("https://apps.shopify.com/pagefly");

    expect(prevented).toBe(false);
  });
});

describe("claimActivation", () => {
  it("claims the tab the panel opened", async () => {
    clickLink("https://apps.shopify.com/pagefly");
    resolveCreate({ id: 42 });
    await settle();

    expect(mod.claimActivation(42)).toBe(true);
  });

  // chrome.tabs.onActivated for the new tab can reach the panel before
  // tabs.create's promise resolves, so the id is not always known in time.
  // The click itself is the claim; the id only records it for later visits.
  it("claims an activation that arrives before the new tab's id does", async () => {
    clickLink("https://apps.shopify.com/pagefly");

    expect(mod.claimActivation(42)).toBe(true);

    resolveCreate({ id: 42 });
    await settle();
    expect(mod.claimActivation(42)).toBe(true);
  });

  it("keeps claiming that tab every time the user goes back to it", async () => {
    clickLink("https://apps.shopify.com/pagefly");
    resolveCreate({ id: 42 });
    await settle();

    expect(mod.claimActivation(42)).toBe(true);
    expect(mod.claimActivation(42)).toBe(true);
  });

  // One click is one tab. Claiming further activations would hold the panel on
  // whatever the user browsed to next, which is the stale result D4 forbids.
  it("claims only one activation per click", () => {
    clickLink("https://apps.shopify.com/pagefly");

    expect(mod.claimActivation(42)).toBe(true);
    expect(mod.claimActivation(43)).toBe(false);
  });

  it("claims nothing when no link was clicked", () => {
    expect(mod.claimActivation(9)).toBe(false);
  });
});
