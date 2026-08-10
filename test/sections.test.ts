import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadSections, isOpen, setOpen, SECTION_IDS } from "../lib/sections.svelte";

let store: Record<string, unknown>;

beforeEach(async () => {
  store = {};
  globalThis.chrome = {
    storage: { local: {
      get: vi.fn(async (k: string) => ({ [k]: store[k] })),
      set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(store, obj); }),
    } },
  } as unknown as typeof chrome;
  // The record is module-level state, shared by every case in this file.
  // Loading from an empty store is what resets it between them.
  await loadSections();
});

afterEach(() => {
  // @ts-expect-error `chrome` only exists inside the extension.
  delete globalThis.chrome;
});

describe("loadSections", () => {
  it("opens every section when the user has never chosen", () => {
    expect(SECTION_IDS.map(isOpen)).toEqual([true, true, true, true, true, true]);
  });

  it("remembers a collapsed section", async () => {
    store.sections = { trackers: false };
    await loadSections();

    expect(isOpen("trackers")).toBe(false);
    expect(isOpen("apps")).toBe(true);
  });

  // The key shares storage with `theme` and `install_id` and outlives
  // upgrades, so a value we no longer recognise must read as "no preference"
  // rather than reach the DOM.
  it("ignores an entry that is not a boolean", async () => {
    store.sections = { trackers: "no" };
    await loadSections();

    expect(isOpen("trackers")).toBe(true);
  });

  it("ignores a key that is not a section", async () => {
    store.sections = { bogus: false, trackers: false };
    await loadSections();

    expect(isOpen("trackers")).toBe(false);
    setOpen("apps", false);
    expect(store.sections).toEqual({ trackers: false, apps: false });
  });

  it("ignores a stored value that is not an object at all", async () => {
    store.sections = "collapsed";
    await loadSections();

    expect(SECTION_IDS.every(isOpen)).toBe(true);
  });

  it("loads clean where no extension APIs exist", async () => {
    // @ts-expect-error exercising the no-chrome path
    delete globalThis.chrome;

    await expect(loadSections()).resolves.toBeUndefined();
    expect(SECTION_IDS.every(isOpen)).toBe(true);
  });
});

describe("setOpen", () => {
  it("merges into the stored record rather than replacing it", async () => {
    store.sections = { trackers: false };
    await loadSections();

    setOpen("apps", false);

    expect(store.sections).toEqual({ trackers: false, apps: false });
  });

  it("records a re-open rather than deleting the entry", async () => {
    store.sections = { trackers: false };
    await loadSections();

    setOpen("trackers", true);

    expect(isOpen("trackers")).toBe(true);
    expect(store.sections).toEqual({ trackers: true });
  });

  // A $state proxy is not structured-cloneable, and chrome.storage clones
  // everything it is handed. Writing the proxy straight through would throw
  // in the extension while passing against a fake that only does Object.assign.
  it("writes a plain object that storage can clone", () => {
    setOpen("products", false);

    expect(Object.getPrototypeOf(store.sections)).toBe(Object.prototype);
    expect(structuredClone(store.sections)).toEqual({ products: false });
  });

  it("keeps the choice in memory when the write is refused", async () => {
    globalThis.chrome.storage.local.set = vi.fn(async () => { throw new Error("denied"); });

    expect(() => setOpen("apps", false)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));

    expect(isOpen("apps")).toBe(false);
  });

  it("does not throw where no extension APIs exist", () => {
    // @ts-expect-error exercising the no-chrome path
    delete globalThis.chrome;

    expect(() => setOpen("apps", false)).not.toThrow();
    expect(isOpen("apps")).toBe(false);
  });
});
