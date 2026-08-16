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

// Stubbed as `browser` with a runtime.id rather than as `chrome`, because
// @wxt-dev/browser prefers `globalThis.browser?.runtime?.id ? globalThis.browser
// : globalThis.chrome` and captures the winner once, at import. A dozen test
// files assign and delete globalThis.chrome for their own reasons; routing i18n
// through globalThis.browser keeps it out of their way entirely.
(globalThis as Record<string, unknown>).browser = {
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

afterEach(() => {
  cleanup();
});
