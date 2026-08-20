import { i18n } from "#i18n";
import { formatLocale } from "./format";

export type MessagePluralCategory = "one" | "few" | "many" | "other";

const MESSAGE_CATEGORIES = new Set<MessagePluralCategory>([
  "one",
  "few",
  "many",
  "other",
]);

export function pluralCategory(
  count: number,
  locale: string = formatLocale(),
): MessagePluralCategory {
  const category = new Intl.PluralRules(locale).select(count);
  return MESSAGE_CATEGORIES.has(category as MessagePluralCategory)
    ? category as MessagePluralCategory
    : "other";
}

export function unidentifiedTrackers(count: number): string {
  const substitutions: [string] = [String(count)];

  switch (pluralCategory(count)) {
    case "one":
      return i18n.t("trackers.unidentified.one", substitutions);
    case "few":
      return i18n.t("trackers.unidentified.few", substitutions);
    case "many":
      return i18n.t("trackers.unidentified.many", substitutions);
    case "other":
      return i18n.t("trackers.unidentified.other", substitutions);
  }
}
