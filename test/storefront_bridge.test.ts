import { describe, expect, it, vi, beforeEach } from "vitest";

function chromeWith(results: unknown[]) {
  const executeScript = vi.fn(async () => [{ result: results.shift() }]);
  (globalThis as any).chrome = {
    tabs: { query: async () => [{ id: 1 }] },
    scripting: { executeScript },
    storage: { local: { get: async () => ({}), set: async () => {} } },
  };
  return executeScript;
}

beforeEach(() => { vi.resetModules(); });

describe("fetchStorefrontDigest", () => {
  it("takes the count from the sitemap and the range from the sort keys", async () => {
    vi.doMock("../lib/api", () => ({ fetchConfig: async () => ({ window_globals: [] }) }));
    chromeWith([
      12345,
      { cheapest: { nodes: [{ priceRange: { minVariantPrice: { amount: "0.75", currencyCode: "USD" } } }] },
        priciest: { nodes: [{ priceRange: { maxVariantPrice: { amount: "299.99" } } }] },
        newest:   { nodes: [{ createdAt: "2026-07-24T00:56:14Z" }] } },
    ]);
    const { fetchStorefrontDigest } = await import("../lib/storefront_bridge");
    const d = await fetchStorefrontDigest();

    expect(d.available).toBe(true);
    expect(d.count).toBe(12345);
    expect(d.priceMin).toBe(0.75);
    expect(d.priceMax).toBe(299.99);
    expect(d.currency).toBe("USD");
    expect(d.newest).toBe("2026-07-24T00:56:14Z");
  });

  // The variant total cannot be had cheaply from this API, and zero would be a
  // false statement about the store rather than a missing one.
  it("reports no variant total rather than zero", async () => {
    vi.doMock("../lib/api", () => ({ fetchConfig: async () => ({ window_globals: [] }) }));
    chromeWith([10, { cheapest: { nodes: [] }, priciest: { nodes: [] }, newest: { nodes: [] } }]);
    const { fetchStorefrontDigest } = await import("../lib/storefront_bridge");
    expect((await fetchStorefrontDigest()).variants).toBeNull();
  });

  it("is unreadable when the API answers nothing", async () => {
    vi.doMock("../lib/api", () => ({ fetchConfig: async () => ({ window_globals: [] }) }));
    chromeWith([null, null]);
    const { fetchStorefrontDigest } = await import("../lib/storefront_bridge");
    const d = await fetchStorefrontDigest();
    expect(d.available).toBe(false);
    expect(d.reason).toBe("unreadable");
  });

  // The sitemap and the GraphQL edges are separate concerns: the API answering
  // is what proves the catalogue is readable. A missing sitemap costs only the
  // count -- it must never flip the digest to unreadable.
  //
  // And the count it costs is null, not 0. A sitemap that 403s leaves the size
  // unread; "0 products" beside a working Export button would be a false
  // statement about the merchant's store, the same class of error as reporting
  // a failed read as "not public".
  it("reports no count, not zero, when only the sitemap count is missing", async () => {
    vi.doMock("../lib/api", () => ({ fetchConfig: async () => ({ window_globals: [] }) }));
    chromeWith([
      null,
      { cheapest: { nodes: [{ priceRange: { minVariantPrice: { amount: "0.75", currencyCode: "USD" } } }] },
        priciest: { nodes: [{ priceRange: { maxVariantPrice: { amount: "299.99" } } }] },
        newest:   { nodes: [{ createdAt: "2026-07-24T00:56:14Z" }] } },
    ]);
    const { fetchStorefrontDigest } = await import("../lib/storefront_bridge");
    const d = await fetchStorefrontDigest();
    expect(d.available).toBe(true);
    expect(d.reason).toBeNull();
    expect(d.count).toBeNull();
    // A ceiling cannot be exceeded by a size that was never measured.
    expect(d.capped).toBeFalsy();
  });

  // The export walks 40 pages of 250, so a catalogue above 10,000 comes back
  // truncated. ProductSummary's disclosure line keys on `capped`, and this path
  // never set it -- so www.fashionnova.com (41,762) offered "41,762 products"
  // and delivered 10,000 with nothing anywhere saying so.
  it("marks a catalogue larger than the export ceiling as capped", async () => {
    vi.doMock("../lib/api", () => ({ fetchConfig: async () => ({ window_globals: [] }) }));
    chromeWith([41762, { cheapest: { nodes: [] }, priciest: { nodes: [] }, newest: { nodes: [] } }]);
    const { fetchStorefrontDigest } = await import("../lib/storefront_bridge");
    const d = await fetchStorefrontDigest();
    expect(d.count).toBe(41762);
    expect(d.capped).toBe(true);
  });

  // Exactly at the ceiling the export delivers every product, so there is
  // nothing to disclose -- only ABOVE it does the walk run out.
  it("does not claim a cap the export does not hit", async () => {
    vi.doMock("../lib/api", () => ({ fetchConfig: async () => ({ window_globals: [] }) }));
    chromeWith([10000, { cheapest: { nodes: [] }, priciest: { nodes: [] }, newest: { nodes: [] } }]);
    const { fetchStorefrontDigest } = await import("../lib/storefront_bridge");
    expect((await fetchStorefrontDigest()).capped).toBe(false);
  });

  it("leaves a small catalogue uncapped", async () => {
    vi.doMock("../lib/api", () => ({ fetchConfig: async () => ({ window_globals: [] }) }));
    chromeWith([240, { cheapest: { nodes: [] }, priciest: { nodes: [] }, newest: { nodes: [] } }]);
    const { fetchStorefrontDigest } = await import("../lib/storefront_bridge");
    expect((await fetchStorefrontDigest()).capped).toBe(false);
  });
});

describe("fetchStorefrontExport", () => {
  const page = (hasNext: boolean, cursor: string, handle = "a") => ({
    products: { pageInfo: { hasNextPage: hasNext, endCursor: cursor },
      nodes: [{ handle, variants: { nodes: [] }, images: { nodes: [] } }] },
  });

  it("follows cursors and stops when hasNextPage is false", async () => {
    vi.doMock("../lib/api", () => ({ fetchConfig: async () => ({ window_globals: [] }) }));
    chromeWith([page(true, "c1"), page(false, "c2")]);
    const { fetchStorefrontExport } = await import("../lib/storefront_bridge");
    const out = await fetchStorefrontExport(() => {});
    expect(out).toHaveLength(2);
    expect(out?.[0]?.handle).toBe("a");
  });

  // MAX_PAGES = 40, the same 40 x 250 ceiling as the /products.json export.
  // Every page here claims hasNextPage: true, so reaching 40 products (not 41)
  // is what proves the loop stops on the cap rather than on the ordinary
  // end-of-pages signal, which the test above already covers.
  it("stops at the 40-page cap even when every page claims more follow", async () => {
    vi.doMock("../lib/api", () => ({ fetchConfig: async () => ({ window_globals: [] }) }));
    const pages = Array.from({ length: 40 }, (_, i) => page(true, `c${i + 1}`, `p${i + 1}`));
    const executeScript = chromeWith(pages);
    const { fetchStorefrontExport } = await import("../lib/storefront_bridge");
    const out = await fetchStorefrontExport(() => {});
    expect(out).toHaveLength(40);
    expect(out?.[39]?.handle).toBe("p40");
    // 1 call to resolve versions' fetchConfig is separate from executeScript;
    // executeScript itself must be called exactly 40 times, never a 41st.
    expect(executeScript).toHaveBeenCalledTimes(40);
  });

  // A later page failing must not cost the pages already collected -- only a
  // failure on the FIRST page means no export at all (see the next test).
  it("keeps earlier pages when a later page cannot be read", async () => {
    vi.doMock("../lib/api", () => ({ fetchConfig: async () => ({ window_globals: [] }) }));
    chromeWith([page(true, "c1"), null]);
    const { fetchStorefrontExport } = await import("../lib/storefront_bridge");
    const out = await fetchStorefrontExport(() => {});
    expect(out).toHaveLength(1);
    expect(out?.[0]?.handle).toBe("a");
  });

  it("returns null when the first page cannot be read", async () => {
    vi.doMock("../lib/api", () => ({ fetchConfig: async () => ({ window_globals: [] }) }));
    chromeWith([null]);
    const { fetchStorefrontExport } = await import("../lib/storefront_bridge");
    expect(await fetchStorefrontExport(() => {})).toBeNull();
  });
});
