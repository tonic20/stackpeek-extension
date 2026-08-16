import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMessagesText, generateChromeMessages } from "@wxt-dev/i18n/build";

// The harness mounts the shipping panel on a plain page, where browser.i18n
// does not exist. WXT builds _locales/ for the real extension; here the config
// runs in Node, so it parses locales/en.yml with the library's own build code
// and hands the result to the shim in shots/main.ts. Same messages, same
// flattening, no second copy of the strings and no Node imports in the bundle.
const MESSAGES = generateChromeMessages(
  parseMessagesText(
    readFileSync(resolve(import.meta.dirname, "../locales/en.yml"), "utf8"),
    "YAML",
  ),
);

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
  // harness fails to build before the SP_MESSAGES shim below is ever reached.
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
    "import.meta.env.SP_MESSAGES": JSON.stringify(MESSAGES),
  },
  server: {
    port: 5199,
    strictPort: true,
    proxy: { "/api": "http://localhost:3070" },
  },
});
