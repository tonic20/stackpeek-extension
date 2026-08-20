// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMessagesText, generateChromeMessages } from "@wxt-dev/i18n/build";

const LOCALES_DIR = resolve(__dirname, "../locales");
const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".yml")).sort();

// Chrome's own ceilings for the two manifest strings, from
// https://developer.chrome.com/docs/webstore/cws-dashboard-listing.
const LIMITS = { extName: 75, extDescription: 132 } as const;

const messagesOf = (file: string) =>
  generateChromeMessages(
    parseMessagesText(readFileSync(resolve(LOCALES_DIR, file), "utf8"), "YAML"),
  );

const placeholdersOf = (message: string) =>
  [...message.matchAll(/(?<!\$)\$(\d+)/g)].map((match) => match[1]).sort();

describe("locales", () => {
  it("ships at least one locale", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  // This guard exists for the locale that does not exist yet. extDescription is
  // 129 of the 132 characters Chrome allows and German runs 20-35% longer, so
  // the first German translation overflows on the first attempt. Learning that
  // from `npm test` costs a minute; learning it from a rejected upload costs a
  // release cycle.
  for (const file of files) {
    describe(file, () => {
      const messages = messagesOf(file);

      it("carries the manifest strings and a format locale", () => {
        expect(messages.extName?.message).toBeTruthy();
        expect(messages.extDescription?.message).toBeTruthy();
        expect(messages.actionTitle?.message).toBeTruthy();
        expect(messages.formatLocale?.message).toBeTruthy();
      });

      // Truthiness alone lets a malformed tag through -- an empty string, or a
      // typo with underscores or a bad subtag (e.g. "de_DE" instead of
      // "de-DE") -- and lib/format.ts calls toLocaleString(formatLocale())
      // and `new Intl.RelativeTimeFormat(formatLocale())` with no try/catch
      // (unlike money(), where the currency comes from a merchant's feed
      // rather than a locale file we control), so a malformed tag throws a
      // RangeError on the first count the panel renders and blanks the whole
      // panel, not one label. This does not catch a syntactically valid but
      // wrong tag ("german" parses as a language subtag and quietly falls
      // back to a default locale instead of throwing) -- that failure mode is
      // a mistranslation, not a crash, and is out of scope for this guard.
      it("has a formatLocale Intl recognizes as a locale", () => {
        expect(Intl.getCanonicalLocales(messages.formatLocale!.message)).toEqual([
          messages.formatLocale!.message,
        ]);
      });

      it("contains no empty generated messages", () => {
        for (const [key, message] of Object.entries(messages)) {
          expect(message.message.trim(), key).not.toBe("");
        }
      });

      it("does not use the unsupported pipe plural encoding", () => {
        for (const [key, message] of Object.entries(messages)) {
          expect(message.message, key).not.toContain(" | ");
        }
      });

      it("defines every explicit tracker plural category", () => {
        expect(Object.keys(messages)).toEqual(expect.arrayContaining([
          "trackers_unidentified_one",
          "trackers_unidentified_few",
          "trackers_unidentified_many",
          "trackers_unidentified_other",
        ]));
      });

      for (const [key, limit] of Object.entries(LIMITS)) {
        it(`keeps ${key} within Chrome's ${limit} characters`, () => {
          // No `?? ""` fallback: this guard exists to bite a future file that
          // has the key but overflows it, and `?? ""` would make an absent
          // key read as 0 characters -- passing here, silently, for the one
          // failure mode this test was written for. (A dropped key is still
          // caught above, by the truthiness check; this assertion should not
          // rely on that.)
          // Spread, not .length: a UTF-16 code-unit count would let an emoji or
          // an astral character through a limit it actually breaks.
          expect([...messages[key]!.message].length).toBeLessThanOrEqual(limit);
        });
      }
    });
  }

  // Dormant until a second locale lands, and deliberately generates NO test
  // case while `en` is the only file -- a parity assertion with nothing to
  // compare against would pass for the wrong reason, which is the failure mode
  // this file already had once (see the length guard's comment above).
  //
  // What it will catch: a key MISSING from a translation is not an error
  // anywhere. Chrome falls back to the default locale per message, by design,
  // so a half-translated de.yml renders a half-English panel and nothing --
  // not the build, not svelte-check, not the runtime -- says a word. The
  // extension has ~62 of these; noticing by eye is not a plan.
  //
  // An EXTRA key is checked too, and is the more interesting failure: it means
  // a key was renamed in en.yml without the translations following, so the
  // translated string is now dead weight and the panel is quietly showing
  // English at the new name.
  //
  // Not covered here, because it fails loudly on its own: a value containing
  // ": " makes the YAML parser throw at build time rather than mis-nest.
  const DEFAULT_LOCALE = "en.yml";
  const keysOf = (file: string) => new Set(Object.keys(messagesOf(file)));

  for (const file of files.filter((f) => f !== DEFAULT_LOCALE)) {
    it(`${file} defines exactly the keys ${DEFAULT_LOCALE} does`, () => {
      const expected = keysOf(DEFAULT_LOCALE);
      const actual = keysOf(file);

      expect([...expected].filter((k) => !actual.has(k)).sort()).toEqual([]);
      expect([...actual].filter((k) => !expected.has(k)).sort()).toEqual([]);
    });

    it(`${file} preserves every ${DEFAULT_LOCALE} placeholder`, () => {
      const expected = messagesOf(DEFAULT_LOCALE);
      const actual = messagesOf(file);

      for (const [key, english] of Object.entries(expected)) {
        expect(placeholdersOf(actual[key]!.message), key).toEqual(
          placeholdersOf(english.message),
        );
      }
    });
  }
});
