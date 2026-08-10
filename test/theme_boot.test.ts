// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { saveTheme } from "../lib/theme";

// The panel opened in the wrong scheme for a user who had chosen one.
//
// chrome.storage.local is async, and main.ts is a module script -- deferred by
// definition. So the document is parsed, and can paint, before the awaited read
// resolves. With no data-sp-theme attribute yet, panel.css's
// `:root:not([data-sp-theme="light"])` matches under a dark OS and the panel
// paints DARK, then flips to light once storage answers. On a cold browser
// start that gap is at its longest, which is exactly when it was reported.
//
// The marketing site never had this: its layout applies the stored theme in a
// synchronous inline <script> in <head>, before first paint. That fix is not
// portable as-is -- MV3 declares no CSP here, so the default `script-src 'self'`
// applies and inline scripts are blocked on extension pages. Hence a classic
// (non-module, therefore synchronous and render-blocking) script served from
// public/, which WXT copies to the output root verbatim.
//
// chrome.storage.local stays the source of truth; localStorage is the
// synchronous cache that pre-paint code can actually read.

const HTML = readFileSync(resolve(__dirname, "../entrypoints/sidepanel/index.html"), "utf8");
const BOOT = readFileSync(resolve(__dirname, "../public/theme-boot.js"), "utf8");

let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
  globalThis.chrome = {
    storage: { local: {
      get: vi.fn(async (k: string) => ({ [k]: store[k] })),
      set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(store, obj); }),
    } },
  } as unknown as typeof chrome;
  localStorage.clear();
});

afterEach(() => {
  document.documentElement.removeAttribute("data-sp-theme");
  localStorage.clear();
  // @ts-expect-error `chrome` only exists inside the extension.
  delete globalThis.chrome;
});

describe("the pre-paint theme bootstrap", () => {
  it("is loaded synchronously, before the panel's module script", () => {
    const boot = HTML.indexOf('src="/theme-boot.js"');
    const mount = HTML.indexOf("main.ts");

    expect(boot, "index.html does not load /theme-boot.js").toBeGreaterThan(-1);
    expect(boot).toBeLessThan(mount);

    // A classic script blocks parsing and runs before first paint. type=module,
    // defer or async each push it past the paint this exists to get ahead of,
    // which would leave the bug in place with the file present -- the failure
    // mode worth pinning, since nothing visual would say so.
    const tag = HTML.slice(boot - 60, boot + 60);
    expect(tag).not.toMatch(/type\s*=\s*["']module["']/);
    expect(tag).not.toMatch(/\bdefer\b/);
    expect(tag).not.toMatch(/\basync\b/);
  });

  it("applies a stored preference with no async step", () => {
    localStorage.setItem("sp-theme", "light");

    new Function(BOOT)();

    expect(document.documentElement.getAttribute("data-sp-theme")).toBe("light");
  });

  it("leaves the attribute absent when nothing was ever chosen", () => {
    new Function(BOOT)();

    // Absent is a third state -- panel.css reads it as "follow the system".
    // Writing a default here would override the OS for a user who never chose.
    expect(document.documentElement.hasAttribute("data-sp-theme")).toBe(false);
  });

  it("ignores a value that is not a scheme", () => {
    localStorage.setItem("sp-theme", "solarized");

    new Function(BOOT)();

    expect(document.documentElement.hasAttribute("data-sp-theme")).toBe(false);
  });

  it("survives storage being unavailable", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });

    // Private mode and blocked-storage policies both throw on access. Throwing
    // here would abort the parser before the panel's own script ever loads.
    expect(() => new Function(BOOT)()).not.toThrow();

    get.mockRestore();
  });
});

describe("saveTheme", () => {
  it("mirrors the choice into the synchronous cache", async () => {
    await saveTheme("light");

    expect(store.theme).toBe("light");
    expect(localStorage.getItem("sp-theme")).toBe("light");
  });

  it("does not fail when the cache write is refused", async () => {
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });

    await expect(saveTheme("dark")).resolves.toBeUndefined();
    expect(store.theme).toBe("dark");

    set.mockRestore();
  });
});
