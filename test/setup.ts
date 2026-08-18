// Vitest setup for @testing-library/svelte under Svelte 5.
// globals:true disables svelteTesting()'s auto-cleanup, so register it here.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/svelte";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMessagesText, generateChromeMessages } from "@wxt-dev/i18n/build";
import { makeGetMessage } from "../lib/chrome_messages";

// The panel's tests assert on visible English copy, so they need the real
// messages rather than key names (design D7). The table is built by the
// library's OWN build code -- the same functions the WXT module calls to emit
// _locales/en/messages.json -- so the nested-key flattening cannot drift from
// what ships. What is reimplemented here is only raw lookup and $n
// substitution, which is all browser.i18n.getMessage does.
const MESSAGES = generateChromeMessages(
  parseMessagesText(readFileSync(resolve(__dirname, "../locales/en.yml"), "utf8"), "YAML"),
);

// ONE object, reachable under both names.
//
// @wxt-dev/browser resolves `globalThis.browser?.runtime?.id ? globalThis.browser
// : globalThis.chrome` ONCE, at import — so a test that reassigns either global
// after that point is writing somewhere the captured binding will never read.
// Making the two names the same object removes the question: `browser` from
// wxt/browser, `globalThis.browser` and `globalThis.chrome` are three views of
// this record, and stubBrowser edits it in place rather than replacing it.
//
// runtime.id must survive every stub, because it is what makes the alias pick
// this object over an empty `chrome`. i18n must survive because the panel's
// tests assert on real English copy.
//
// Kept as a snapshot, not just a set of protected key names: a test that
// passes its own `runtime` (test/version.test.ts's manifest case) replaces
// the whole key, and a PRESERVED list that only skips deletion would let that
// replacement leak into every test after it, forever, since nothing would
// ever put the original id/getMessage back. Rebuilding from DEFAULTS on every
// call is what makes `stubBrowser({})` actually mean "back to nothing but the
// two required keys" rather than "whatever the previous test last left here."
const DEFAULTS: Record<string, unknown> = {
  runtime: { id: "vitest" },
  i18n: {
    // Chrome returns "" for a message it does not have, which is how a
    // mistyped key ships as a label that quietly disappears. Throwing is the
    // second guard this scaffolding exists to add: it turns that into a test
    // failure, and it is what will make the next locale's key extraction
    // verifiable. (shots/i18n_shim.ts shares this lookup but deliberately
    // passes a non-throwing onMissing -- see lib/chrome_messages.ts.)
    getMessage: makeGetMessage(MESSAGES, (name) => {
      throw new Error(`[i18n] no message named "${name}" in locales/en.yml`);
    }),
  },
};

const EXTENSION_API: Record<string, unknown> = { ...DEFAULTS };

(globalThis as Record<string, unknown>).browser = EXTENSION_API;
(globalThis as Record<string, unknown>).chrome = EXTENSION_API;

/**
 * Replace the stubbed extension API surface in place.
 *
 * `stubBrowser({})` is the "no extension APIs available" case — the one tests
 * used to write as `delete globalThis.chrome`, which no longer works now that
 * the binding is captured. Production code guards these paths with optional
 * chaining (`browser?.storage?.local?.get`), so an absent key is the same
 * signal an absent global used to be.
 */
export function stubBrowser(api: object): void {
  for (const key of Object.keys(EXTENSION_API)) delete EXTENSION_API[key];
  Object.assign(EXTENSION_API, DEFAULTS, api);
}

afterEach(() => {
  cleanup();
});
