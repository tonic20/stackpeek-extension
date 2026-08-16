import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { installChromeShim, harnessProps } from "../shots/main";

// @wxt-dev/browser reads globalThis.browser exactly once, the moment its own
// module body runs, and freezes the result -- so shots/i18n_shim.ts (which
// installs globalThis.browser) has to be imported before ANY import that
// transitively reaches #i18n, not merely before App.svelte specifically.
// lib/format.ts is one such import (it calls i18n.t for formatLocale), and
// nothing stops a future edit from adding `import { money } from
// "../lib/format"` above the shim -- that would re-break the harness at
// runtime while an App.svelte-relative check stayed green. ES modules
// evaluate sibling imports in declaration order, so the shim being the
// file's FIRST import is the actual ordering guarantee: everything else in
// the file, whatever it imports, necessarily comes after.
//
// This cannot be turned into a behavioral test in this suite: test/setup.ts
// is a setupFile, and Vitest runs setupFiles before a test file's own
// imports are evaluated, so globalThis.browser is already correctly
// installed before shots/main.ts's import chain ever runs here -- the exact
// ordering guarantee this file has to provide for itself in a real browser
// comes for free in Vitest, which is why the browser-runtime crash this
// guarded against was invisible to `npm test` in the first place. Checking
// the source order is what is left to catch a regression short of loading
// the harness in an actual browser.
it("keeps the i18n shim as the first import in main.ts", () => {
  const source = readFileSync(resolve(__dirname, "../shots/main.ts"), "utf8");
  const shimImport = source.indexOf('import "./i18n_shim"');
  // Anchored to line start so this matches only actual import statements, not
  // the word "import" inside the comment explaining why the shim must be
  // first (e.g. "This import MUST be first...").
  const firstImport = source.match(/^import /m)?.index;

  expect(shimImport).toBeGreaterThan(-1);
  expect(firstImport).toBeDefined();
  expect(shimImport).toBe(firstImport);
});

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
