import { describe, expect, it, vi, afterEach } from "vitest";
import { collectStorefrontQuery, collectProductSitemapCount } from "../lib/storefront";

afterEach(() => { delete (globalThis as any).fetch; });

describe("collectStorefrontQuery", () => {
  it("returns the data payload from the first version that answers", async () => {
    globalThis.fetch = vi.fn(async (url: string) => (
      url.includes("2025-01")
        ? ({ ok: false, status: 404 } as Response)
        : ({ ok: true, status: 200, json: async () => ({ data: { products: { nodes: [] } } }) } as unknown as Response)
    )) as unknown as typeof fetch;

    const out = await collectStorefrontQuery(["2025-01", "2024-10"], "{ products { nodes { handle } } }");
    expect(out).toEqual({ products: { nodes: [] } });
    expect((globalThis.fetch as any).mock.calls[1][0]).toContain("/api/2024-10/graphql.json");
  });

  it("returns null when no version answers", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404 } as Response)) as unknown as typeof fetch;
    expect(await collectStorefrontQuery(["2025-01"], "{}")).toBeNull();
  });

  // A GraphQL error is a 200 with an errors array -- treat it as no answer
  // rather than letting an undefined data field flow onward.
  it("returns null on a GraphQL error response", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ errors: [{ message: "denied" }] }),
    } as unknown as Response)) as unknown as typeof fetch;
    expect(await collectStorefrontQuery(["2025-01"], "{}")).toBeNull();
  });

  it("returns null when the fetch throws", async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError("blocked"); }) as unknown as typeof fetch;
    expect(await collectStorefrontQuery(["2025-01"], "{}")).toBeNull();
  });
});

describe("collectProductSitemapCount", () => {
  it("counts product URLs across the sitemap index", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/sitemap.xml")) {
        return { ok: true, text: async () => `<sitemapindex><sitemap><loc>https://s/sitemap/products.xml</loc></sitemap></sitemapindex>` } as unknown as Response;
      }
      return { ok: true, text: async () => `<urlset><url><loc>https://s/products/a</loc></url><url><loc>https://s/products/b</loc></url></urlset>` } as unknown as Response;
    }) as unknown as typeof fetch;

    expect(await collectProductSitemapCount()).toBe(2);
  });

  it("returns null when the index cannot be read", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false } as Response)) as unknown as typeof fetch;
    expect(await collectProductSitemapCount()).toBeNull();
  });

  it("returns null when the index names no product sitemap", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true, text: async () => `<sitemapindex><sitemap><loc>https://s/sitemap/pages.xml</loc></sitemap></sitemapindex>`,
    } as unknown as Response)) as unknown as typeof fetch;
    expect(await collectProductSitemapCount()).toBeNull();
  });
});
