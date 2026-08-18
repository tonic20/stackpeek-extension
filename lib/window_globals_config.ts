// Resolves the full probe list the collector should use: the bundled
// WINDOW_GLOBALS constant unioned with whatever Api::V1::ConfigController
// currently reports (see backend/app/services/window_globals_catalog.rb),
// cached client-side so this doesn't hit the network on every detect.
//
// This is phase 1 of issue #21: the backend can now push new probe names
// without an extension release. See lib/window_globals.ts for why the
// bundled list still exists and is never dropped.
import { browser } from "wxt/browser";
import { WINDOW_GLOBALS } from "./window_globals";
import { fetchConfig } from "./api";

const STORAGE_KEY = "window_globals_config_cache";

// The corpus this list is derived from (App.window_globals) is curated by
// hand and changes on the order of days, not minutes — a day-long TTL means
// ordinary use (many detects across many tabs in a session) costs at most
// one fetch a day, while a newly-added probe still reaches every install
// within the same day it lands in the corpus.
export const CONFIG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedProbeList {
  globals: string[];
  fetchedAt: number;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isFreshCacheEntry(value: unknown): value is CachedProbeList {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<CachedProbeList>;
  if (typeof entry.fetchedAt !== "number") return false;
  if (!isStringArray(entry.globals)) return false;
  return Date.now() - entry.fetchedAt < CONFIG_CACHE_TTL_MS;
}

async function readCachedGlobals(): Promise<string[] | null> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const entry = stored[STORAGE_KEY];
  return isFreshCacheEntry(entry) ? entry.globals : null;
}

async function refreshCachedGlobals(): Promise<string[] | null> {
  const { window_globals } = await fetchConfig();
  if (!isStringArray(window_globals)) return null;
  const entry: CachedProbeList = { globals: window_globals, fetchedAt: Date.now() };
  await browser.storage.local.set({ [STORAGE_KEY]: entry });
  return window_globals;
}

// Union, not replace: the backend's corpus-derived list can legitimately be
// *smaller* than the bundled one (today: 37 distinct globals server-side vs.
// 48 compiled into the extension — see window_globals.ts), and replacing
// would silently drop probes the extension has always sent for zero
// benefit. An extra probe name costs one cheap `typeof window[name]` check;
// losing one loses a signal outright. The bundled list is therefore a floor
// that can only ever be added to, never narrowed.
//
// Never throws: a network failure, a timeout, a non-2xx response, or a
// malformed body must never prevent collection, so every failure mode here
// degrades to the bundled list alone.
export async function resolveProbeList(): Promise<string[]> {
  try {
    let globals = await readCachedGlobals();
    if (globals === null) {
      globals = await refreshCachedGlobals().catch(() => null);
    }
    if (globals === null) return [...WINDOW_GLOBALS];
    return Array.from(new Set([...WINDOW_GLOBALS, ...globals])).sort();
  } catch {
    return [...WINDOW_GLOBALS];
  }
}
