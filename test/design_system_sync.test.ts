// @vitest-environment node
//
// Nothing here touches the DOM: this file reads files off disk and inspects the
// WXT config object. jsdom is not merely unnecessary, it is actively hostile --
// importing wxt.config pulls in esbuild, whose startup invariant check
// (`new TextEncoder().encode("") instanceof Uint8Array`) fails against jsdom's
// substituted globals and takes the whole file down with it.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import config from "../wxt.config";

// The design bundle is the source of truth for both applications. check.py
// guards the bundle's own internal consistency and knows nothing about these
// copies, so without this test the extension's assets could drift from the
// site's -- and from the design note that specifies them -- unnoticed.
const BUNDLE = resolve(__dirname, "../../docs/stackpeek-design-system-files/project");

// The bundle lives in the stackpeek monorepo. This directory is also published
// on its own as github.com/tonic20/stackpeek-extension, a mirror holding
// extension/ and nothing above it, where ../../docs does not exist and there is
// no source of truth to compare against.
//
// ONLY this describe may be guarded. The four below read nothing outside
// extension/, so they are meaningful in the mirror and must keep running there
// -- host_permissions above all, which is the only test standing between a
// Chrome Web Store build and a shipped localhost grant. Guarding the file
// would drop it silently, which is worse than the drift this block catches.
const IN_MONOREPO = existsSync(BUNDLE);

const COPIES: [string, string][] = [
  ["public/icon-16.png", "assets/icon-16.png"],
  ["public/icon-32.png", "assets/icon-32.png"],
  ["public/icon-48.png", "assets/icon-48.png"],
  ["public/icon-128.png", "assets/icon-128.png"],
  ["entrypoints/sidepanel/panel.css", "extension/panel.css"],
];

// A missing bundle means "not the monorepo" and skips. A bundle that is
// present but missing a file is drift, and the existsSync assertions inside
// still fail on it.
describe.skipIf(!IN_MONOREPO)("design system sync", () => {
  it.each(COPIES)("%s matches the design bundle byte for byte", (installed, source) => {
    const from = resolve(BUNDLE, source);
    const to = resolve(__dirname, "..", installed);

    expect(existsSync(from), `design bundle missing at ${from}`).toBe(true);
    expect(existsSync(to), `${installed} is not installed`).toBe(true);
    expect(
      readFileSync(to).equals(readFileSync(from)),
      `${installed} has diverged from the design bundle. Re-copy it from ${source} rather than editing it.`,
    ).toBe(true);
  });
});

// Without an icons key Chrome renders the default puzzle piece in the toolbar
// and the extensions list -- the most visible possible "unfinished" signal.
// The four sizes are the ones Job 1 rasterised.
const EXPECTED_ICONS = {
  16: "icon-16.png",
  32: "icon-32.png",
  48: "icon-48.png",
  128: "icon-128.png",
};

// The byte-identity check above proves panel.css's contents match the design
// bundle, but nothing proves it is actually loaded -- every rendering test
// imports App.svelte directly, so the stylesheet never loads under Vitest.
// Deleting the import in main.ts would break nothing in that suite.
describe("panel.css is wired up", () => {
  it("is imported by the sidepanel entrypoint", () => {
    const mainTs = readFileSync(resolve(__dirname, "../entrypoints/sidepanel/main.ts"), "utf8");
    expect(mainTs).toContain('import "./panel.css"');
  });
});

// D2: the stored scheme must reach <html> BEFORE the panel mounts. Mounting
// first paints the system scheme and then repaints the chosen one. No rendering
// test can catch a regression here -- jsdom computes no styles, so both
// orderings produce an identical DOM -- which is why the ordering is pinned in
// the source.
describe("the theme is applied before the panel mounts", () => {
  const mainTs = readFileSync(resolve(__dirname, "../entrypoints/sidepanel/main.ts"), "utf8");

  it("applies the stored preference", () => {
    expect(mainTs).toContain("applyTheme(await storedTheme())");
  });

  // Matches the CALL, not the bare identifier: `applyTheme` also appears in the
  // import line at the top of the file, which precedes mount() no matter where
  // the call sits, so asserting on the identifier would pass for a file that
  // applies the theme after mounting -- exactly the regression this exists to
  // catch.
  it("does so before mount(), not after", () => {
    expect(mainTs.indexOf("applyTheme(await storedTheme())")).toBeLessThan(mainTs.indexOf("mount(App"));
  });
});

describe("manifest icons", () => {
  // manifest is a function of the build env (see wxt.config.ts) so the
  // localhost host permission can be dropped from non-development builds.
  // Icons and the action are env-independent, so any env works here.
  const manifestOption = (config as { manifest?: unknown }).manifest;
  const manifest =
    (typeof manifestOption === "function"
      ? manifestOption({ mode: "production", command: "build", browser: "chrome", manifestVersion: 3 })
      : manifestOption) ?? {};

  it("declares every rasterised size", () => {
    expect(manifest.icons).toEqual(EXPECTED_ICONS);
  });

  it("gives the toolbar action the same icon, keeping its existing title", () => {
    expect(manifest.action?.default_icon).toEqual(EXPECTED_ICONS);
    expect(manifest.action?.default_title).toBe("Detect this store's theme & apps");
  });
});

// The Chrome Web Store build must not ask for access to the user's own
// machine, and /privacy discloses only https://api.stackpeek.app -- it says
// nothing about localhost. This is the only test on the branch that closes
// that prior finding, so it checks both directions: an inverted conditional
// would ship the localhost grant to the store, which is worse than the
// defect it was meant to fix.
describe("host_permissions is scoped to build mode", () => {
  const manifestOption = (config as { manifest?: unknown }).manifest;
  const buildManifest = (mode: string) =>
    typeof manifestOption === "function"
      ? manifestOption({ mode, command: "build", browser: "chrome", manifestVersion: 3 })
      : manifestOption;

  it("grants only the production API host in a production build", () => {
    const manifest = buildManifest("production");
    expect(manifest.host_permissions).toEqual(["https://api.stackpeek.app/*"]);
  });

  it("also grants localhost in a development build", () => {
    const manifest = buildManifest("development");
    expect(manifest.host_permissions).toContain("http://localhost:3070/*");
    expect(manifest.host_permissions).toContain("https://api.stackpeek.app/*");
  });
});
