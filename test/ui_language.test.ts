import { describe, it, expect, afterEach } from "vitest";
import { stubBrowser } from "./setup";
import { uiLanguage } from "../lib/ui_language";

afterEach(() => stubBrowser({}));

describe("uiLanguage", () => {
  it("reports the browser's UI language", () => {
    stubBrowser({ i18n: { getUILanguage: () => "pt-BR" } });
    expect(uiLanguage()).toBe("pt-BR");
  });

  // The point of sending this is to see demand for locales we do NOT ship, so
  // it must report what the browser is actually set to rather than which of our
  // fifteen message files Chrome resolved. A Polish user reading the English
  // panel is the single most useful row in that table.
  it("reports a language the extension does not ship", () => {
    stubBrowser({ i18n: { getUILanguage: () => "pl" } });
    expect(uiLanguage()).toBe("pl");
  });

  // shots/i18n_shim.ts installs a browser object carrying only getMessage, and
  // test/setup.ts's DEFAULTS do the same. An unguarded call would throw during
  // the panel's first detect round -- taking down every screenshot render, not
  // just this field.
  it("returns undefined when the API is absent", () => {
    stubBrowser({ i18n: { getMessage: () => "" } });
    expect(uiLanguage()).toBeUndefined();
  });

  it("returns undefined when there is no extension API at all", () => {
    stubBrowser({});
    expect(uiLanguage()).toBeUndefined();
  });

  // Chrome returns "" before the API is ready in some contexts. Sending an
  // empty string would give the analytics column its own meaningless bucket,
  // which the server would reject anyway -- omit the field instead.
  it("treats an empty language as absent", () => {
    stubBrowser({ i18n: { getUILanguage: () => "" } });
    expect(uiLanguage()).toBeUndefined();
  });

  it("survives an API that throws", () => {
    stubBrowser({ i18n: { getUILanguage: () => { throw new Error("nope"); } } });
    expect(uiLanguage()).toBeUndefined();
  });
});
