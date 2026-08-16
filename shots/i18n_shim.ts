import { makeGetMessage } from "../lib/chrome_messages";

// Installs globalThis.browser -- with i18n.getMessage backed by the parsed
// locale messages -- as a side effect of import. This file has no exports;
// it exists only to be imported first, from main.ts, and nowhere else.
//
// @wxt-dev/browser (github.com/wxt-dev/wxt, packages/browser) reads
// globalThis.browser/chrome exactly once, the moment its own module body
// runs, and freezes the result into a module-level `export const browser =
// ...`. #i18n's every later call to `browser.i18n.getMessage` reads that
// frozen reference, not the live global -- so the global has to be in place
// before @wxt-dev/browser's module body executes, not before App.svelte
// renders.
//
// ES module imports are hoisted and evaluated in declaration order: each
// sibling import's whole dependency subtree finishes evaluating before the
// next sibling import in the same file begins. So as long as this file is
// main.ts's FIRST import, its side effect completes before
// "../entrypoints/sidepanel/App.svelte" is evaluated, and therefore before
// that import's own subtree pulls in #i18n -> @wxt-dev/i18n ->
// @wxt-dev/browser and captures the global. Moving this import below the App
// import -- or folding it back into installChromeShim(), which runs from
// main.ts's own module body, after every import has already resolved --
// silently reintroduces "Cannot read properties of undefined (reading
// 'getMessage')" at runtime. Vite still transforms every module cleanly and
// a curl of the harness still returns 200 either way: the failure only shows
// up as a thrown exception when the mounted panel actually calls t().
//
// Guarded on SP_MESSAGES because Vitest also walks this import chain (for
// harnessProps/installChromeShim in test/shots_harness.test.ts), and
// SP_MESSAGES is a define only vite.harness.config.ts sets. An unguarded
// assignment here would stomp test/setup.ts's already-populated i18n stub
// for the rest of that test file.
const messages = import.meta.env.SP_MESSAGES;

if (messages && Object.keys(messages).length > 0) {
  (globalThis as Record<string, unknown>).browser = {
    runtime: { id: "shots" },
    i18n: {
      // "" for a missing key, matching real Chrome -- see
      // lib/chrome_messages.ts for why this onMissing has to differ from
      // test/setup.ts's throwing one.
      getMessage: makeGetMessage(messages, () => ""),
    },
  };
}
