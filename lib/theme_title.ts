import { i18n } from "#i18n";

// The name the panel gives a detected theme. Shared by ThemeCard and the
// Markdown report so a pasted report names the theme the way the screen it
// came from did: the report used to fall back to the API's raw origin enum,
// printing an English "headless" or "custom" where the panel said "Headless
// storefront" or "Custom theme" in the reader's language.
//
// Unlike the design bundle's reference component, a custom theme keeps the
// name the merchant gave it: our detector returns it, and dropping data we
// hold to render a generic label is a regression. The origin chip says
// "custom", so nothing here claims a catalog match. headless is different in
// kind, not in policy: the service returns no name for it at all, so the
// label is the only thing there is to show.
export function themeTitle(theme: { name?: unknown; origin?: unknown }): string {
  if (theme.origin === "headless") return i18n.t("theme.headless");
  if (typeof theme.name === "string" && theme.name) return theme.name;
  return theme.origin === "custom" ? i18n.t("theme.custom") : i18n.t("theme.unknown");
}

// catalog and forked are the two origins that name a real catalog theme, so
// they are the two that can carry a version and link to a listing. custom and
// headless are deliberate non-answers -- there is nothing to link to.
export function isCatalogMatch(theme: { origin?: unknown }): boolean {
  return theme.origin === "catalog" || theme.origin === "forked";
}
