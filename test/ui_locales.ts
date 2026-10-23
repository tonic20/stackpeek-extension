// The languages the panel itself is translated into, as catalog file names.
// Every other catalog in locales/ is manifest-only: scripts/build-extension-
// locales.ts writes just extName and extDescription into it from the store
// copy in docs/store-listing/_locales, so the Chrome Web Store shows a
// localized name and summary in all 52 of its languages while Chrome falls
// back to en for the whole panel. Spelled out rather than inferred from which
// files carry UI keys: inferring would let a UI catalog that lost its keys
// pass as a manifest-only one, the one mistake that split must not hide.
// test/locales.test.ts pins both kinds to their shape.
export const UI_LOCALES = [
  "de", "en", "es", "fr", "hi", "id", "it", "ja", "ko", "pt_BR", "ru", "th",
  "tr", "vi", "zh_CN",
].map((code) => `${code}.yml`);
