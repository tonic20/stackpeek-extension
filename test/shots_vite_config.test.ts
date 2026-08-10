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
});
