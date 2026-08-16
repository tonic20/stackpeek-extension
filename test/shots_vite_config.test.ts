// @vitest-environment node
//
// jsdom's environment breaks esbuild's TextEncoder invariant, and importing
// vite.harness.config.ts pulls in the svelte plugin's esbuild-based transform
// even though this test never renders anything -- so this file needs the
// plain node environment rather than the suite's jsdom default.
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import config from "../shots/vite.harness.config";

// App.svelte's panel header renders <img src="/icon-32.png">, and the img
// has alt="" -- a 404 there renders as nothing, silently. The fix is
// publicDir: resolve(__dirname, "../public") in shots/vite.harness.config.ts,
// and nothing else holds that line in place. Asserting the resolved path
// actually contains icon-32.png (rather than just grepping the config file
// for the publicDir string) catches a renamed icon or a restructured
// extension/public/ too, not only a deleted config line.
describe("shots vite config", () => {
  it("resolves publicDir to the extension's public/ directory, which carries icon-32.png", () => {
    expect(typeof config.publicDir).toBe("string");
    expect(existsSync(join(config.publicDir as string, "icon-32.png"))).toBe(true);
  });

  // App.svelte imports strings from "#i18n". WXT registers that alias for the
  // real extension build, and vitest.config.ts registers it separately for
  // the test run, but this harness config is a plain Vite server that goes
  // through neither -- without its own alias entry, Vite can't resolve the
  // import at all and the harness fails to build before it ever reaches the
  // SP_MESSAGES define below. Asserting the resolved target file actually
  // exists on disk (rather than just grepping the config for "#i18n") catches
  // a moved or renamed .wxt/i18n/index.ts too, not only a deleted alias line.
  it("resolves the #i18n alias to the generated i18n module", () => {
    const alias = (config.resolve?.alias as Record<string, string> | undefined)?.["#i18n"];
    expect(typeof alias).toBe("string");
    expect(existsSync(alias as string)).toBe(true);
  });
});

describe("shots i18n", () => {
  // shots/main.ts mounts the shipping App.svelte, and every section heading in
  // it now comes from browser.i18n. Without this define the harness renders a
  // crash rather than a panel -- and no other test mounts the harness, so this
  // is the only thing standing between a silent break and a screenshot run.
  it("injects the parsed messages into the harness bundle", () => {
    const injected = (config.define as Record<string, string>)["import.meta.env.SP_MESSAGES"];
    expect(typeof injected).toBe("string");
    const messages = JSON.parse(injected as string) as Record<string, { message: string }>;
    expect(messages.trackers_heading?.message).toBe("Trackers");
    expect(messages.extName?.message).toBe("Shopify Theme Detector & Apps — Stackpeek");
  });

  it("keeps the API base define, which the panel's fetches depend on", () => {
    expect((config.define as Record<string, string>)["import.meta.env.WXT_API_BASE"]).toBe('""');
  });
});
