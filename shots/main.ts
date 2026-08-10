// Mounts the shipping sidepanel App.svelte outside an extension so Playwright
// can photograph it. This is the production component, not a copy: the only
// substitutions are Chrome APIs that cannot exist on a plain page.
//
// postDetect is deliberately NOT stubbed. It defaults to http://localhost:3070
// (lib/api.ts:14) with WXT_API_BASE unset, so the panel in these screenshots
// was filled by the real API reading the real fingerprint database. Stubbing it
// would make the frames a drawing of the product rather than a photograph.
import { mount } from "svelte";
import App from "../entrypoints/sidepanel/App.svelte";
import "../entrypoints/sidepanel/panel.css";
import type { CollectionPages } from "../lib/catalogue_types";

export function installChromeShim(store: Record<string, unknown> = {}): void {
  const local = {
    async get(key: string) {
      return key in store ? { [key]: store[key] } : {};
    },
    async set(values: Record<string, unknown>) {
      Object.assign(store, values);
    },
  };
  (globalThis as Record<string, unknown>).chrome = { storage: { local } };
}

// digest is null on four of the five frames — only frame 4 shows the export
// section, and an unavailable digest is what keeps the other four quiet rather
// than showing a spinner that never resolves.
//
// pages is null except for the store whose Best sellers section a frame must
// show. It is NOT a live fetch: scripts/shots.py builds it from
// db/demo_stores.json's catalogue.best_sellers, a ranking the real extension
// already measured during the browsing pass. Re-deriving it from a fresh
// /collections request here would make this stage non-deterministic and
// could turn up a different ranking, or no ranking at all, if the store has
// since stopped honouring sort_by. Passing collectionPages the pre-built
// bodies runs the ranking through the shipped rankCatalogue/rankedHandles
// code path exactly as production does; only the network fetch is replaced.
export function harnessProps(
  signals: unknown,
  url: string,
  digest: Record<string, unknown> | null = null,
  pages: CollectionPages | null = null,
): Record<string, unknown> {
  const empty = {
    available: false, count: 0, variants: 0,
    priceMin: null, priceMax: null, newest: null, currency: null, index: [],
  };

  return {
    autostart: true,
    runner: async () => ({ signals, url }),
    watch: () => ({ stop: () => {} }),
    catalogue: async () => digest ?? empty,
    cataloguePage: async () => null,
    collectionPages: async () => pages,
  };
}

// Browser-only. Vitest imports this module for the two exports above, and
// document.getElementById("app") is null there, so mounting must be guarded.
const target = typeof document === "undefined" ? null : document.getElementById("app");

if (target) {
  const params = new URLSearchParams(location.search);
  const decode = (name: string) => {
    const raw = params.get(name);
    // URL-safe base64, matching scripts/shots.py's urlsafe_b64encode.
    return raw ? JSON.parse(atob(raw.replace(/-/g, "+").replace(/_/g, "/"))) : null;
  };

  installChromeShim();
  document.documentElement.dataset.theme = "light";
  mount(App, {
    target,
    props: harnessProps(
      decode("signals") ?? {},
      params.get("url") ?? "https://example.com/",
      decode("digest"),
      decode("pages"),
    ),
  });
}
