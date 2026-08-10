import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "node:path";

// Serves the screenshot harness only. Separate from wxt.config.ts on purpose:
// nothing here may influence the shipped extension build.
export default defineConfig({
  root: resolve(__dirname),
  // The panel header renders <img src="/icon-32.png"> (App.svelte:193). In the
  // shipped extension WXT copies public/ to the build root so that resolves;
  // here Vite's root is shots/, so publicDir would default to shots/public and
  // the icon 404s -- silently, because the img has alt="". Point it at the
  // extension's real public dir so the panel renders its own mark.
  publicDir: resolve(__dirname, "../public"),
  plugins: [svelte()],
  // postDetect (lib/api.ts:14) reads import.meta.env.WXT_API_BASE and falls back
  // to http://localhost:3070. From a page served on :5199 that is cross-origin,
  // and the browser blocks it -- an extension page has no such barrier, a plain
  // page does. Setting the base to "" makes postDetect fetch a same-origin
  // relative URL, and the proxy below forwards it to Rails.
  //
  // postDetect itself stays unstubbed, which is the point: the request still
  // reaches the real API and the real fingerprint database.
  define: { "import.meta.env.WXT_API_BASE": JSON.stringify("") },
  server: {
    port: 5199,
    strictPort: true,
    proxy: { "/api": "http://localhost:3070" },
  },
});
