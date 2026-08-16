import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { watchActiveTab } from "../lib/tab_watcher";

type Listener = (...args: any[]) => void;
let activated: Listener[];
let updated: Listener[];

beforeEach(() => {
  activated = [];
  updated = [];
  globalThis.chrome = {
    tabs: {
      query: vi.fn(async () => [{ id: 7, url: "https://demo.example/" }]),
      onActivated: {
        addListener: (fn: Listener) => activated.push(fn),
        removeListener: (fn: Listener) => { activated = activated.filter((f) => f !== fn); },
      },
      onUpdated: {
        addListener: (fn: Listener) => updated.push(fn),
        removeListener: (fn: Listener) => { updated = updated.filter((f) => f !== fn); },
      },
    },
  } as unknown as typeof chrome;
});

afterEach(() => {
  // @ts-expect-error `chrome` only exists inside the extension.
  delete globalThis.chrome;
});

// Lets the watcher's constructor-time tabs.query() settle before events fire.
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("watchActiveTab", () => {
  it("reports a switch to a different tab", async () => {
    const onChange = vi.fn();
    watchActiveTab(onChange);
    await settle();

    activated.forEach((fn) => fn({ tabId: 9 }));

    expect(onChange).toHaveBeenCalledOnce();
  });

  it("says nothing when the activated tab is the one already being shown", async () => {
    const onChange = vi.fn();
    watchActiveTab(onChange);
    await settle();

    activated.forEach((fn) => fn({ tabId: 7 }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("reports a navigation in the tab being shown", async () => {
    const onChange = vi.fn();
    watchActiveTab(onChange);
    await settle();

    updated.forEach((fn) => fn(7, { status: "complete" }));

    expect(onChange).toHaveBeenCalledOnce();
  });

  // onUpdated fires many times through a load -- loading, favicon, title.
  // Acting on each would run a scan per event.
  it("ignores the intermediate stages of a load", async () => {
    const onChange = vi.fn();
    watchActiveTab(onChange);
    await settle();

    updated.forEach((fn) => fn(7, { status: "loading" }));
    updated.forEach((fn) => fn(7, { favIconUrl: "https://demo.example/f.ico" }));

    expect(onChange).not.toHaveBeenCalled();
  });

  // A background tab finishing its load says nothing about the page the panel
  // is describing.
  it("ignores a load completing in a tab that is not being shown", async () => {
    const onChange = vi.fn();
    watchActiveTab(onChange);
    await settle();

    updated.forEach((fn) => fn(99, { status: "complete" }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("follows the user to the new tab, then watches that one", async () => {
    const onChange = vi.fn();
    watchActiveTab(onChange);
    await settle();

    activated.forEach((fn) => fn({ tabId: 9 }));
    updated.forEach((fn) => fn(9, { status: "complete" }));

    expect(onChange).toHaveBeenCalledTimes(2);
  });

  // The panel opened this tab for the user, off one of its own theme/app
  // links. Rescanning it would replace a store the user asked for with a
  // permission error about a page they did not.
  it("does not rescan a tab the panel opened itself", async () => {
    const onChange = vi.fn();
    watchActiveTab(onChange, { claim: (id) => id === 9 });
    await settle();

    activated.forEach((fn) => fn({ tabId: 9 }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("tells the caller when it is holding, and when it stops", async () => {
    const onHold = vi.fn();
    watchActiveTab(vi.fn(), { claim: (id) => id === 9, onHold });
    await settle();

    activated.forEach((fn) => fn({ tabId: 9 }));
    expect(onHold).toHaveBeenLastCalledWith(true);

    activated.forEach((fn) => fn({ tabId: 7 }));
    expect(onHold).toHaveBeenLastCalledWith(false);
  });

  // Coming back to the scanned tab is not a change of page, so the result on
  // screen still stands and rescanning it would be waste.
  it("does not rescan when the user returns to the tab it scanned", async () => {
    const onChange = vi.fn();
    watchActiveTab(onChange, { claim: (id) => id === 9 });
    await settle();

    activated.forEach((fn) => fn({ tabId: 9 }));
    activated.forEach((fn) => fn({ tabId: 7 }));

    expect(onChange).not.toHaveBeenCalled();
  });

  // A scan reads whichever tab is active, so acting on the scanned tab
  // finishing a background reload would scan the held tab instead -- the exact
  // permission error the hold exists to prevent.
  it("ignores a background reload of the scanned tab while holding", async () => {
    const onChange = vi.fn();
    watchActiveTab(onChange, { claim: (id) => id === 9 });
    await settle();

    activated.forEach((fn) => fn({ tabId: 9 }));
    updated.forEach((fn) => fn(7, { status: "complete" }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("watches the scanned tab again once the user is back on it", async () => {
    const onChange = vi.fn();
    watchActiveTab(onChange, { claim: (id) => id === 9 });
    await settle();

    activated.forEach((fn) => fn({ tabId: 9 }));
    activated.forEach((fn) => fn({ tabId: 7 }));
    updated.forEach((fn) => fn(7, { status: "complete" }));

    expect(onChange).toHaveBeenCalledOnce();
  });

  // Holding is for the tabs the panel opened. Anywhere else the user goes is
  // an ordinary page change and gets an ordinary rescan.
  it("still follows the user to a tab it did not open", async () => {
    const onChange = vi.fn();
    watchActiveTab(onChange, { claim: (id) => id === 9 });
    await settle();

    activated.forEach((fn) => fn({ tabId: 9 }));
    activated.forEach((fn) => fn({ tabId: 12 }));

    expect(onChange).toHaveBeenCalledOnce();
  });

  it("stops listening when stopped", async () => {
    const onChange = vi.fn();
    const watcher = watchActiveTab(onChange);
    await settle();

    watcher.stop();
    activated.forEach((fn) => fn({ tabId: 9 }));

    expect(onChange).not.toHaveBeenCalled();
    expect(activated).toHaveLength(0);
    expect(updated).toHaveLength(0);
  });

  // Every panel rendering test mounts App outside an extension.
  it("is inert where no extension APIs exist", () => {
    // @ts-expect-error exercising the no-chrome path
    delete globalThis.chrome;

    expect(() => watchActiveTab(() => {}).stop()).not.toThrow();
  });
});
