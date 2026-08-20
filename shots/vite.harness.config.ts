import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseMessagesText, generateChromeMessages } from "@wxt-dev/i18n/build";

// The harness mounts the shipping panel on a plain page, where browser.i18n
// does not exist. WXT builds _locales/ for the real extension; here the config
// runs in Node, so it parses every locale with the library's own build code and
// hands a map to the shim. The shim selects from that map synchronously, before
// App.svelte imports #i18n. Same messages, same flattening, no second copy of
// the strings and no Node imports in the browser bundle.
export function loadHarnessMessages(localesDir: string) {
  const messages: Record<string, ReturnType<typeof generateChromeMessages>> = {};
  const tags: Record<string, string> = {};

  for (const file of readdirSync(localesDir).sort()) {
    const match = file.match(/^([a-z]{2}(?:_[A-Z]{2})?)\.yml$/);
    if (!match) continue;

    const code = match[1]!;
    const generated = generateChromeMessages(
      parseMessagesText(readFileSync(resolve(localesDir, file), "utf8"), "YAML"),
    );
    const tag = generated.formatLocale?.message;
    if (!tag) throw new Error(`${file} has no formatLocale message`);
    messages[code] = generated;
    tags[code] = tag;
  }

  return { messages, tags };
}

const HARNESS_LOCALES = loadHarnessMessages(resolve(import.meta.dirname, "../locales"));

// Serves the screenshot harness only. Separate from wxt.config.ts on purpose:
// nothing here may influence the shipped extension build.
export default defineConfig({
  root: resolve(import.meta.dirname),
  // The panel header renders <img src="/icon-32.png"> (App.svelte:193). In the
  // shipped extension WXT copies public/ to the build root so that resolves;
  // here Vite's root is shots/, so publicDir would default to shots/public and
  // the icon 404s -- silently, because the img has alt="". Point it at the
  // extension's real public dir so the panel renders its own mark.
  publicDir: resolve(import.meta.dirname, "../public"),
  // App.svelte imports strings from "#i18n". WXT registers that alias itself
  // during a real build (addAlias in @wxt-dev/i18n/module), and
  // vitest.config.ts declares it separately for the test run -- this config
  // is neither: it's a plain Vite dev server that never goes through WXT, so
  // without its own alias here Vite can't resolve the import at all and the
  // harness fails to build before the locale-message shim below is ever reached.
  // Points at the same generated module vitest.config.ts uses.
  resolve: {
    alias: { "#i18n": resolve(import.meta.dirname, "../.wxt/i18n/index.ts") },
  },
  plugins: [svelte()],
  // postDetect (lib/api.ts:14) reads import.meta.env.WXT_API_BASE and falls back
  // to http://localhost:3070. From a page served on :5199 that is cross-origin,
  // and the browser blocks it -- an extension page has no such barrier, a plain
  // page does. Setting the base to "" makes postDetect fetch a same-origin
  // relative URL, and the proxy below forwards it to Rails.
  //
  // postDetect itself stays unstubbed, which is the point: the request still
  // reaches the real API and the real fingerprint database.
  define: {
    "import.meta.env.WXT_API_BASE": JSON.stringify(""),
    "import.meta.env.SP_MESSAGES_BY_LOCALE": JSON.stringify(HARNESS_LOCALES.messages),
    "import.meta.env.SP_LOCALE_TAGS": JSON.stringify(HARNESS_LOCALES.tags),
  },
  server: {
    port: 5199,
    strictPort: true,
    // Rails binds IPv4 in the local screenshot workflow. Pinning the proxy to
    // the matching loopback address avoids an IPv6 localhost attempt delaying
    // every request past Playwright's 25-second response guard.
    proxy: { "/api": "http://127.0.0.1:3070" },
  },
});
