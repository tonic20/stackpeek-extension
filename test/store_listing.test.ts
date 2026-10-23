// @vitest-environment node
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMessagesText, generateChromeMessages } from "@wxt-dev/i18n/build";

// The Chrome Web Store copy of every language lives in
// docs/store-listing/_locales/<code>/messages.json (appName, shortDesc,
// storeDesc), and scripts/build-extension-locales.ts copies the name and short
// description into locales/<code>.yml, because those two ship in the package.
// This catches an edit made to one side and never carried to the other -- a
// hand-tuned summary in a catalog, or a retranslation nobody rebuilt -- which
// would otherwise surface as a store page whose summary disagrees with the
// one Chrome shows on install.
const STORE = resolve(__dirname, "../../docs/store-listing/_locales");
const CATALOGS = resolve(__dirname, "../locales");

// docs/ does not exist in the public mirror (github.com/tonic20/stackpeek-
// extension, an export of extension/ alone), so this skips there rather than
// failing; scripts/publish_extension.sh --check expects exactly this skip.
// Every read sits inside an `it`: a describe body runs at collection time even
// when the describe is skipped, and an ENOENT there would take the whole file
// down in the mirror instead of skipping it.
describe.skipIf(!existsSync(STORE))("store listing copy in the catalogs", () => {
  const storeLocales = () =>
    readdirSync(STORE).filter((code) => existsSync(resolve(STORE, code, "messages.json"))).sort();
  const store = (code: string) =>
    JSON.parse(readFileSync(resolve(STORE, code, "messages.json"), "utf8"));
  const catalog = (code: string) =>
    generateChromeMessages(
      parseMessagesText(readFileSync(resolve(CATALOGS, `${code}.yml`), "utf8"), "YAML"),
    );

  // Both directions matter. A store language with no catalog has a listing
  // whose name and summary the package does not carry, so Chrome shows the
  // English ones after install; a catalog with no store language ships a name
  // and summary nobody reviews as listing copy.
  it("has a catalog for every store language, and a store language for every catalog", () => {
    const catalogs = readdirSync(CATALOGS)
      .filter((f) => f.endsWith(".yml"))
      .map((f) => f.replace(/\.yml$/, ""))
      .sort();

    expect(catalogs).toEqual(storeLocales());
  });

  it("carries the store appName and shortDesc as extName and extDescription", () => {
    for (const code of storeLocales()) {
      const messages = catalog(code);
      const listing = store(code);

      expect(messages.extName?.message, code).toBe(listing.appName.message);
      expect(messages.extDescription?.message, code).toBe(listing.shortDesc.message);
    }
  });

  // English is the source every translation is made from; package.json keeps
  // a copy of it as the package description, and this keeps that copy from
  // going stale the next time the summary is rewritten.
  it("uses the English short description as the package description", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8"));

    expect(store("en").shortDesc.message).toBe(pkg.description);
  });
});
