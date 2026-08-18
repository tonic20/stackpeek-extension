import { describe, it, expect, beforeEach, vi } from "vitest";
import { WINDOW_GLOBALS } from "../lib/window_globals";
import { resolveProbeList, CONFIG_CACHE_TTL_MS } from "../lib/window_globals_config";
import { stubBrowser } from "./setup";

const STORAGE_KEY = "window_globals_config_cache";

function mockChromeStorage(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  stubBrowser({
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        }),
      },
    },
  });
  return store;
}

beforeEach(() => {
  vi.stubEnv("WXT_API_BASE", "http://test.local");
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
  mockChromeStorage();
});

describe("resolveProbeList", () => {
  it("unions the bundled list with a successful fetch", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ window_globals: ["brandNewGlobal"] }),
    });

    const result = await resolveProbeList();

    expect(result).toContain("brandNewGlobal");
    for (const bundled of WINDOW_GLOBALS) expect(result).toContain(bundled);
  });

  // The concrete case the issue calls out: the corpus-derived backend list
  // can legitimately be smaller than the bundled one. Replacing would drop
  // probes the extension has always sent for zero benefit.
  it("does not drop bundled names when the backend list is smaller", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ window_globals: ["fbq"] }),
    });

    const result = await resolveProbeList();

    expect(result.length).toBeGreaterThanOrEqual(WINDOW_GLOBALS.length);
    for (const bundled of WINDOW_GLOBALS) expect(result).toContain(bundled);
  });

  // The exact case the review brief asked to be verified: an empty backend
  // corpus is a legitimate response, isStringArray([]) is vacuously true, and
  // the union of the bundled list with [] must be a no-op.
  it("is a no-op when the backend returns an empty window_globals list", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ window_globals: [] }),
    });

    const result = await resolveProbeList();

    expect(new Set(result)).toEqual(new Set(WINDOW_GLOBALS));
  });

  it("falls back to the bundled list alone when the fetch fails", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));

    const result = await resolveProbeList();

    expect(new Set(result)).toEqual(new Set(WINDOW_GLOBALS));
  });

  it("falls back to the bundled list alone when the response is malformed", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ window_globals: "not-an-array" }),
    });

    const result = await resolveProbeList();

    expect(new Set(result)).toEqual(new Set(WINDOW_GLOBALS));
  });

  it("falls back to the bundled list alone when the array contains non-strings", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ window_globals: [1, 2] }),
    });

    const result = await resolveProbeList();

    expect(new Set(result)).toEqual(new Set(WINDOW_GLOBALS));
  });

  it("falls back to the bundled list alone when the window_globals key is missing", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, status: 200, json: async () => ({}),
    });

    const result = await resolveProbeList();

    expect(new Set(result)).toEqual(new Set(WINDOW_GLOBALS));
  });

  it("aborts a hanging fetch once the 5s config timeout fires, and still falls back to the bundled list", async () => {
    vi.useFakeTimers();
    try {
      (fetch as ReturnType<typeof vi.fn>).mockImplementation(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("This operation was aborted", "AbortError"));
            });
          }),
      );

      const resultPromise = resolveProbeList();
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await resultPromise;

      expect(new Set(result)).toEqual(new Set(WINDOW_GLOBALS));
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the bundled list alone when the server 500s", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    const result = await resolveProbeList();

    expect(new Set(result)).toEqual(new Set(WINDOW_GLOBALS));
  });

  it("uses the cached list without re-fetching when the cache is still fresh", async () => {
    mockChromeStorage({
      [STORAGE_KEY]: { globals: [ "cachedGlobal" ], fetchedAt: Date.now() },
    });

    const result = await resolveProbeList();

    expect(fetch).not.toHaveBeenCalled();
    expect(result).toContain("cachedGlobal");
  });

  it("re-fetches when the cached entry is older than the TTL", async () => {
    mockChromeStorage({
      [STORAGE_KEY]: { globals: [ "staleGlobal" ], fetchedAt: Date.now() - CONFIG_CACHE_TTL_MS - 1000 },
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ window_globals: ["freshGlobal"] }),
    });

    const result = await resolveProbeList();

    expect(fetch).toHaveBeenCalled();
    expect(result).toContain("freshGlobal");
    expect(result).not.toContain("staleGlobal");
  });

  it("writes a fresh fetch to the cache for next time", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ window_globals: ["persisted"] }),
    });

    await resolveProbeList();

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        [STORAGE_KEY]: expect.objectContaining({ globals: ["persisted"] }),
      }),
    );
  });
});
