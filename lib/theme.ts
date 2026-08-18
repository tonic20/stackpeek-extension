// The panel's scheme preference. panel.css already expresses all three states
// and needs no edit to support a control:
//
//   :root, [data-sp-theme]               -> light tokens
//   [data-sp-theme="dark"]               -> dark tokens
//   @media (prefers-color-scheme: dark)
//     :root:not([data-sp-theme="light"]) -> dark tokens
//
// That last rule is the load-bearing one. It excludes only the explicit
// "light" value, so an ABSENT attribute means "follow the system" and an
// explicit one overrides it. The whole feature is therefore setting or
// removing one attribute.
import { browser } from "wxt/browser";

export type ThemePreference = "light" | "dark";

const KEY = "theme";

// The synchronous mirror public/theme-boot.js reads before first paint. Named
// to match the marketing site's own localStorage key, which does the same job
// there — the two never share an origin, so this is a naming convention, not
// shared state.
const CACHE_KEY = "sp-theme";

// Optional-chained twice on purpose: jsdom ships no matchMedia at all, so
// `globalThis.matchMedia(...)` is a TypeError and `globalThis.matchMedia?.(...)`
// still returns undefined whose `.matches` would throw.
export function systemTheme(): ThemePreference {
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

// Undefined means "never chosen", which is a real state (follow the system) and
// not an error. An unrecognised stored value is treated the same way rather
// than reaching the DOM: this key shares storage with install_id and outlives
// upgrades.
export async function storedTheme(): Promise<ThemePreference | undefined> {
  const result = await browser?.storage?.local?.get(KEY);
  const value = result?.[KEY];
  return value === "light" || value === "dark" ? value : undefined;
}

export function applyTheme(pref: ThemePreference | undefined): void {
  const root = document.documentElement;
  if (pref) root.setAttribute("data-sp-theme", pref);
  else root.removeAttribute("data-sp-theme");
}

// Written twice, to two stores that answer at different times.
//
// chrome.storage.local is the source of truth, and it is async -- which means
// nothing can read it before the panel's first paint. public/theme-boot.js runs
// synchronously in <head> and needs an answer right then, so the same value is
// mirrored into localStorage for it. A refused mirror is not an error: the
// preference is still saved, the panel just briefly opens in the system scheme
// before main.ts corrects it, which is the behaviour this mirror exists to
// improve on rather than depend on.
export async function saveTheme(pref: ThemePreference): Promise<void> {
  try {
    localStorage.setItem(CACHE_KEY, pref);
  } catch {
    // Storage denied. chrome.storage.local below still records the choice.
  }
  await browser?.storage?.local?.set({ [KEY]: pref });
}
