// Which Shopify Storefront API versions to try, newest first.
//
// The version is part of the URL (/api/<version>/graphql.json) and Shopify
// retires versions on roughly a yearly cycle, so a value baked into the bundle
// eventually 404s on every store and can only be fixed by shipping a release.
// The backend can therefore replace this list -- the same escape hatch
// window_globals has, for the same reason.
//
// REPLACES rather than unions, which is the one way this differs from
// lib/window_globals_config.ts: there, an extra probe name is harmless and a
// missing one loses a signal, so the bundled list is a floor. Here a retired
// version is actively worthless, so the server must be able to drop one.
import { browser } from "wxt/browser";
import { fetchConfig } from "./api";

export const BUNDLED_STOREFRONT_VERSIONS = ["2025-01", "2024-10"] as const;

const STORAGE_KEY = "storefront_versions_cache";
export const VERSION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedVersions { versions: string[]; fetchedAt: number }

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string");
}

function isFresh(value: unknown): value is CachedVersions {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<CachedVersions>;
  if (typeof entry.fetchedAt !== "number") return false;
  if (!isStringArray(entry.versions)) return false;
  return Date.now() - entry.fetchedAt < VERSION_CACHE_TTL_MS;
}

// Never throws: a catalogue read must degrade to the bundled list, never fail.
export async function resolveStorefrontVersions(): Promise<string[]> {
  try {
    const stored = await browser.storage.local.get(STORAGE_KEY);
    if (isFresh(stored[STORAGE_KEY])) return (stored[STORAGE_KEY] as CachedVersions).versions;

    const config = await fetchConfig().catch(() => null);
    const fromServer = (config as { storefront_api_versions?: unknown } | null)?.storefront_api_versions;
    if (!isStringArray(fromServer)) return [...BUNDLED_STOREFRONT_VERSIONS];

    await browser.storage.local.set({ [STORAGE_KEY]: { versions: fromServer, fetchedAt: Date.now() } });
    return fromServer;
  } catch {
    return [...BUNDLED_STOREFRONT_VERSIONS];
  }
}
