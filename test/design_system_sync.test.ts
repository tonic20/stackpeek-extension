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
import { parseMessagesText, generateChromeMessages } from "@wxt-dev/i18n/build";
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
    // The title moved into locales/en.yml (design D2), so the manifest carries
    // a placeholder and the guard follows the string. Both halves are needed: a
    // manifest naming a message that does not exist renders an empty tooltip,
    // and a locale file whose value drifted would sail past a placeholder-only
    // check.
    expect(manifest.action?.default_title).toBe("__MSG_actionTitle__");
    expect(
      generateChromeMessages(
        parseMessagesText(
          readFileSync(resolve(__dirname, "../locales/en.yml"), "utf8"),
          "YAML",
        ),
      ).actionTitle?.message,
    ).toBe("Detect this store's theme & apps");
  });

  // name and description carry the same __MSG_ + value split as the action
  // title above, and for the same reason, but these two are new failure modes
  // this branch introduced: before it, `name` was a literal that could not
  // fail to resolve. A renamed extName in en.yml now ships a store listing
  // titled "__MSG_extName__" with nothing here to catch it, and a dropped
  // default_locale makes Chrome refuse to load the package outright -- both
  // cost a release cycle, which is exactly what this guard is for.
  it("points name and description at locale messages that resolve, and declares the default locale", () => {
    expect(manifest.default_locale).toBe("en");
    expect(manifest.name).toBe("__MSG_extName__");
    expect(manifest.description).toBe("__MSG_extDescription__");

    const messages = generateChromeMessages(
      parseMessagesText(readFileSync(resolve(__dirname, "../locales/en.yml"), "utf8"), "YAML"),
    );
    expect(messages.extName?.message).toBe("Shopify Theme Detector & Apps — Stackpeek");
    expect(messages.extDescription?.message).toBe(
      "Instantly see any Shopify store's theme, apps and trackers. Export to CSV. Fast, minimal-permission, never records your browsing.",
    );
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
  const buildManifest = (mode: string, browser = "chrome") =>
    typeof manifestOption === "function"
      ? manifestOption({ mode, command: "build", browser, manifestVersion: 3 })
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

// The Firefox manifest is a different document from the Chrome one, and every
// difference below is something addons-linter rejects or Firefox ignores:
// `sidePanel` is not a Firefox permission (MANIFEST_PERMISSIONS), an MV3
// add-on without a gecko id cannot be signed (ADDON_ID_REQUIRED), and AMO has
// required data_collection_permissions of every new extension since
// 2025-11-03 (MISSING_DATA_COLLECTION_PERMISSIONS).
//
// These read wxt.config.ts and nothing outside extension/, so they run in the
// public mirror too and must NOT be guarded by IN_MONOREPO.
describe("the Firefox manifest", () => {
  const manifestOption = (config as { manifest?: unknown }).manifest;
  const forBrowser = (browser: string) =>
    (manifestOption as (env: object) => Record<string, any>)({
      mode: "production", command: "build", browser, manifestVersion: 3,
    });

  it("is built as MV3, like Chrome's", () => {
    // WXT defaults Firefox to MV2. Left alone, `wxt zip -b firefox` emits
    // firefox-mv2/, where `action` is `browser_action` and the background
    // entrypoint's browser.action.onClicked is undefined at runtime.
    expect((config as { manifestVersion?: number }).manifestVersion).toBe(3);
  });

  it("carries the permanent gecko id", () => {
    const gecko = forBrowser("firefox").browser_specific_settings.gecko;
    expect(gecko.id).toBe("stackpeek@kopylov.net");
  });

  it("floors at Firefox 140, where data_collection_permissions exists", () => {
    const gecko = forBrowser("firefox").browser_specific_settings.gecko;
    expect(gecko.strict_min_version).toBe("140.0");
  });

  it("declares websiteContent as required and technicalAndInteraction as optional", () => {
    // technicalAndInteraction is ILLEGAL in `required` — Mozilla's rule is
    // that it must be optional. Putting it in `required` fails AMO validation
    // outright, which is how reverse-image-search 0.7.0 was rejected.
    const gecko = forBrowser("firefox").browser_specific_settings.gecko;
    expect(gecko.data_collection_permissions).toEqual({
      required: ["websiteContent"],
      optional: ["technicalAndInteraction"],
    });
  });

  it("does not claim Android, which has no sidebar_action", () => {
    expect(forBrowser("firefox").browser_specific_settings.gecko_android).toBeUndefined();
  });

  it("drops sidePanel, which Firefox rejects as a permission", () => {
    expect(forBrowser("firefox").permissions).toEqual(["activeTab", "scripting", "storage"]);
  });

  it("declares the sidebar icon on the entrypoint, the only input WXT does not overwrite", () => {
    // WXT's addEntrypoints reassigns manifest.sidebar_action wholesale AFTER
    // the config's manifest object is merged (wxt/dist/core/utils/manifest.mjs),
    // reading default_icon from the sidepanel entrypoint's own options. A
    // sidebar_action key returned from wxt.config.ts is silently discarded, so
    // the meta tag in the entrypoint HTML is what actually ships the icon.
    const html = readFileSync(resolve(__dirname, "../entrypoints/sidepanel/index.html"), "utf8");
    expect(html).toContain('name="manifest.default_icon"');
    for (const size of [16, 32, 48, 128]) {
      expect(html).toContain(`"${size}":"icon-${size}.png"`);
    }
  });

  it("does not set sidebar_action itself, since WXT discards it unconditionally", () => {
    // wxt.config.ts cannot control sidebar_action at all -- addEntrypoints
    // overwrites the key regardless of what's returned here. Leaving a stale
    // sidebar_action in this object would teach the next reader that the
    // config controls something it does not.
    expect(forBrowser("firefox").sidebar_action).toBeUndefined();
  });

  it("keeps sidePanel in the Chrome manifest", () => {
    expect(forBrowser("chrome").permissions).toEqual([
      "activeTab", "scripting", "sidePanel", "storage",
    ]);
  });

  it("keeps browser_specific_settings out of the Chrome manifest", () => {
    // WXT does not strip this key on its own. Left in the shared object it
    // ships to Chrome, which logs "Unrecognized manifest key".
    expect(forBrowser("chrome").browser_specific_settings).toBeUndefined();
    expect(forBrowser("chrome").sidebar_action).toBeUndefined();
  });
});
