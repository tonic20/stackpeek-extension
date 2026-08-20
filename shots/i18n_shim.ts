import { makeGetMessage } from "../lib/chrome_messages";

type HarnessMessages = Record<string, { message: string }>;

export function makeStorageLocal(store: Record<string, unknown> = {}) {
  return {
    async get(key: string) {
      return key in store ? { [key]: store[key] } : {};
    },
    async set(values: Record<string, unknown>) {
      Object.assign(store, values);
    },
  };
}

export function selectHarnessLocale(
  requested: string | null,
  messagesByLocale: Record<string, HarnessMessages | undefined>,
  localeTags: Record<string, string | undefined>,
): { code: string; messages: HarnessMessages; tag: string } {
  const code = requested ?? "en";
  if (!/^[a-z]{2}(?:_[A-Z]{2})?$/.test(code)) {
    throw new Error(`[shots] unsafe locale code: ${code}`);
  }

  const messages = messagesByLocale[code];
  const tag = localeTags[code];
  if (!messages || !tag) {
    throw new Error(`[shots] locale ${code} was not compiled into the harness`);
  }
  return { code, messages, tag };
}

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
// Guarded on SP_MESSAGES_BY_LOCALE because Vitest also walks this import chain (for
// harnessProps/installChromeShim in test/shots_harness.test.ts), and
// the locale map is a define only vite.harness.config.ts sets. An unguarded
// assignment here would stomp test/setup.ts's already-populated i18n stub
// for the rest of that test file.
const messagesByLocale = import.meta.env.SP_MESSAGES_BY_LOCALE;
const localeTags = import.meta.env.SP_LOCALE_TAGS;

if (messagesByLocale && localeTags && Object.keys(messagesByLocale).length > 0) {
  const selected = selectHarnessLocale(
    new URLSearchParams(globalThis.location?.search ?? "").get("locale"),
    messagesByLocale,
    localeTags,
  );
  document.documentElement.lang = selected.tag;
  const local = makeStorageLocal();
  (globalThis as Record<string, unknown>).browser = {
    runtime: { id: "shots" },
    // getInstallId() runs through wxt/browser before the first API request.
    // This has to live on the same early browser object as i18n because WXT
    // freezes that object when its module is evaluated.
    storage: { local },
    i18n: {
      // "" for a missing key, matching real Chrome -- see
      // lib/chrome_messages.ts for why this onMissing has to differ from
      // test/setup.ts's throwing one.
      getMessage: makeGetMessage(selected.messages, () => ""),
    },
  };
}
