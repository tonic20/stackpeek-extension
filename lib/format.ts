import { i18n } from "#i18n";

// Everything the panel formats -- counts, prices, relative dates -- reads its
// locale from here, and this reads it from the message file (design D5).
//
// NOT from browser.i18n.getUILanguage(). Chrome falls back to the extension's
// default locale whenever it has no messages for the user's, so with the UI
// language a French user would read English text laid out with French digit
// separators and a French currency position. Binding the format locale to the
// message file keeps words and numbers in agreement in every fallback case; the
// cost is one key per locale file.
export function formatLocale(): string {
  return i18n.t("formatLocale");
}

export function number(value: number): string {
  return value.toLocaleString(formatLocale());
}

// The feed carries no currency, so an unknown one renders bare numbers rather
// than a guessed symbol (product-catalogue design D8). The try/catch is for a
// currency code Intl refuses -- the feed's value is the merchant's, not ours.
export function money(value: number, currency: string | null): string {
  if (!currency) return value.toFixed(2);
  try {
    return new Intl.NumberFormat(formatLocale(), { style: "currency", currency }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

// null means "nothing to show" -- an absent date, or one that will not parse.
// The caller renders the em dash, keeping that glyph out of the message file
// where a translator would be invited to change it.
//
// numeric: "always" with style: "narrow" is what reproduces the panel's
// existing "5d ago" exactly below 1000 days: "short" and "long" both render
// "5 days ago", and numeric: "auto" renders "yesterday" for one day. At and
// above 1000 days RelativeTimeFormat formats the number through NumberFormat
// and groups it -- "1,000d ago", not "1000d ago" -- which is deliberate, not
// a gap in the reproduction: every other number the panel renders goes
// through number()/toLocaleString, so the grouped form is the one consistent
// with the rest of the panel, and the ungrouped one would have been the
// outlier. Same-day would be "0d ago", which is why it is a message key
// rather than a format call.
export function daysAgo(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400_000);
  if (!Number.isFinite(days)) return null;
  if (days <= 0) return i18n.t("products.newestToday");
  return new Intl.RelativeTimeFormat(formatLocale(), {
    numeric: "always",
    style: "narrow",
  }).format(-days, "day");
}
