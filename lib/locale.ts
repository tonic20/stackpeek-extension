import { formatLocale } from "./format";

export function canonicalFormatLocale(): string {
  const configured = formatLocale();

  try {
    const locales = Intl.getCanonicalLocales(configured);
    if (locales.length !== 1) throw new RangeError("expected one locale");
    return locales[0]!;
  } catch (error) {
    throw new RangeError(`Invalid formatLocale message: ${configured}`, {
      cause: error,
    });
  }
}

export function applyDocumentLocale(
  root: HTMLElement = document.documentElement,
): string {
  const locale = canonicalFormatLocale();
  root.lang = locale;
  return locale;
}
