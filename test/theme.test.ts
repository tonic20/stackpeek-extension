import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { systemTheme, storedTheme, applyTheme, saveTheme } from "../lib/theme";

let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
  globalThis.chrome = {
    storage: { local: {
      get: vi.fn(async (k: string) => ({ [k]: store[k] })),
      set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(store, obj); }),
    } },
  } as unknown as typeof chrome;
});

afterEach(() => {
  document.documentElement.removeAttribute("data-sp-theme");
  // @ts-expect-error `chrome` only exists inside the extension.
  delete globalThis.chrome;
  // @ts-expect-error matchMedia is installed per-case below.
  delete globalThis.matchMedia;
});

describe("systemTheme", () => {
  it("reads the OS preference", () => {
    globalThis.matchMedia = ((q: string) => ({ matches: q.includes("dark") })) as unknown as typeof matchMedia;
    expect(systemTheme()).toBe("dark");
  });

  it("falls back to light where matchMedia does not exist", () => {
    // jsdom ships no matchMedia. Without a guard this throws and takes down
    // every panel rendering test, not just this behaviour.
    expect(systemTheme()).toBe("light");
  });
});

describe("storedTheme", () => {
  it("returns nothing when the user has never chosen", async () => {
    expect(await storedTheme()).toBeUndefined();
  });

  it("returns a stored preference", async () => {
    store.theme = "dark";
    expect(await storedTheme()).toBe("dark");
  });

  // storage is shared with install_id and survives upgrades, so a value we no
  // longer recognise must read as "no preference" rather than reach the DOM.
  it("ignores a value that is not a scheme", async () => {
    store.theme = "solarized";
    expect(await storedTheme()).toBeUndefined();
  });

  it("returns nothing where no extension APIs exist", async () => {
    // @ts-expect-error exercising the no-chrome path
    delete globalThis.chrome;
    expect(await storedTheme()).toBeUndefined();
  });
});

describe("applyTheme", () => {
  it("sets the attribute panel.css keys on", () => {
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-sp-theme")).toBe("dark");
  });

  // Absent is a third state, not a missing one: panel.css's dark media query is
  // scoped :root:not([data-sp-theme="light"]), so no attribute means "follow
  // the system". Writing an empty value instead would break that.
  it("removes the attribute when there is no preference", () => {
    applyTheme("dark");
    applyTheme(undefined);
    expect(document.documentElement.hasAttribute("data-sp-theme")).toBe(false);
  });
});

describe("saveTheme", () => {
  it("persists the choice", async () => {
    await saveTheme("light");
    expect(store.theme).toBe("light");
    expect(await storedTheme()).toBe("light");
  });
});
