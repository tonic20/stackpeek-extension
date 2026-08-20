import { browser } from "wxt/browser";

/** The browser's own UI language ("de", "pt-BR", "pl"), or undefined when the
 *  API is unavailable or unhelpful.
 *
 *  Deliberately NOT formatLocale(): that is the tag bound to whichever of our
 *  fifteen message files Chrome resolved, so a Polish user reading the English
 *  panel would report "en-US" and the one row worth having -- demand for a
 *  locale we do not ship -- could never appear.
 *
 *  Guarded rather than called straight through. shots/i18n_shim.ts installs a
 *  browser object carrying only getMessage, so an unguarded call throws inside
 *  the panel's first detect round and takes down every screenshot render; the
 *  same shape is what test/setup.ts hands most tests. Returning undefined lets
 *  the caller omit the field, which is what the server already treats as "not
 *  reported". */
export function uiLanguage(): string | undefined {
  try {
    const language = browser?.i18n?.getUILanguage?.();
    return language ? language : undefined;
  } catch {
    return undefined;
  }
}
