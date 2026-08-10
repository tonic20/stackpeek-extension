import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { collectCatalogueDigest, collectCataloguePage, collectCollectionPages } from "../lib/catalogue";

const product = (over: Record<string, unknown> = {}) => ({
  handle: "a", title: "A", created_at: "2026-01-01T00:00:00Z",
  variants: [{ price: "10.00" }], images: [], ...over,
});

function feed(pages: Record<string, unknown>[][], status = 200) {
  return vi.fn(async (url: string) => {
    const page = Number(new URL(url, "https://s.example").searchParams.get("page") ?? 1);
    if (status !== 200) return { ok: false, status } as Response;
    return { ok: true, status: 200, json: async () => ({ products: pages[page - 1] ?? [] }) } as unknown as Response;
  });
}

afterEach(() => {
  // @ts-expect-error test-local globals
  delete globalThis.fetch;
  delete (globalThis as any).Shopify;
});

describe("collectCatalogueDigest", () => {
  it("summarises the feed", async () => {
    globalThis.fetch = feed([[
      product({ variants: [{ price: "10.00" }, { price: "40.00" }], created_at: "2026-01-01T00:00:00Z" }),
      product({ handle: "b", variants: [{ price: "25.50" }], created_at: "2026-03-09T00:00:00Z" }),
    ]]) as unknown as typeof fetch;

    const d = await collectCatalogueDigest(25);

    expect(d.available).toBe(true);
    expect(d.count).toBe(2);
    expect(d.variants).toBe(3);
    expect(d.priceMin).toBe(10);
    expect(d.priceMax).toBe(40);
    expect(d.newest).toBe("2026-03-09T00:00:00Z");
  });

  it("follows pagination until a short page", async () => {
    const full = Array.from({ length: 250 }, (_, i) => product({ handle: `p${i}` }));
    globalThis.fetch = feed([full, [product({ handle: "last" })]]) as unknown as typeof fetch;

    const d = await collectCatalogueDigest(25);

    expect(d.count).toBe(251);
  });

  // 404 on chubbiesshorts.com, blocked outright on us.gymshark.com,
  // password-protected stores likewise. All are "not public", not errors.
  it("reports unavailable when the feed 404s", async () => {
    globalThis.fetch = feed([], 404) as unknown as typeof fetch;

    expect((await collectCatalogueDigest(25)).available).toBe(false);
  });

  it("reports unavailable when the fetch is blocked outright", async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;

    expect((await collectCatalogueDigest(25)).available).toBe(false);
  });

  // /products.json carries no currency at all. Rendering "$" on a euro store
  // would be a quiet, plausible fabrication.
  it("takes the currency from window.Shopify", async () => {
    globalThis.fetch = feed([[product()]]) as unknown as typeof fetch;
    (globalThis as any).Shopify = { currency: { active: "EUR" } };

    expect((await collectCatalogueDigest(25)).currency).toBe("EUR");
  });

  it("reports no currency rather than guessing one", async () => {
    globalThis.fetch = feed([[product()]]) as unknown as typeof fetch;

    expect((await collectCatalogueDigest(25)).currency).toBeNull();
  });

  // The index is what the panel joins a ranking against. Kept to three fields
  // so a 1,240-product store costs ~87KB rather than the feed's ~5MB.
  it("returns a compact index of every product", async () => {
    globalThis.fetch = feed([[
      product({ handle: "a", title: "A", variants: [{ price: "10.00" }] }),
      product({ handle: "b", title: "B", variants: [] }),
    ]]) as unknown as typeof fetch;

    expect((await collectCatalogueDigest(25)).index).toEqual([
      { handle: "a", title: "A", price: "10.00" },
      { handle: "b", title: "B", price: null },
    ]);
  });

  it("survives a product with no variants", async () => {
    globalThis.fetch = feed([[product({ variants: [] })]]) as unknown as typeof fetch;

    const d = await collectCatalogueDigest(25);
    expect(d.count).toBe(1);
    expect(d.priceMin).toBeNull();
  });
});

describe("collectCataloguePage", () => {
  it("returns one page of raw products", async () => {
    globalThis.fetch = feed([[product(), product({ handle: "b" })]]) as unknown as typeof fetch;

    expect((await collectCataloguePage(1))!.map((p) => p.handle)).toEqual(["a", "b"]);
  });

  // The panel's export loop reads null as "stop", and must not mistake it for
  // an empty-but-successful page.
  it("returns null when the page cannot be read", async () => {
    globalThis.fetch = feed([], 404) as unknown as typeof fetch;

    expect(await collectCataloguePage(1)).toBeNull();
  });
});

describe("collectCollectionPages", () => {
  it("returns both sorted bodies", async () => {
    globalThis.fetch = vi.fn(async (url: string) => ({
      ok: true, text: async () => (url.includes("best-selling") ? "BS" : "AZ"),
    } as unknown as Response)) as unknown as typeof fetch;

    expect(await collectCollectionPages()).toEqual({ bestSelling: "BS", alphabetical: "AZ" });
  });

  // Shopify serves the default template when a view does not exist, so asking
  // for it costs nothing and sometimes wins outright.
  it("asks for the json view and the underscore sort parameter", async () => {
    // Typed parameter, not `async ()`: without it mock.calls is a zero-length
    // tuple and indexing it is a type error rather than a test failure.
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, text: async () => "x" } as unknown as Response));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await collectCollectionPages();

    expect(fetchMock.mock.calls[0]![0]).toBe("/collections/all?sort_by=best-selling&view=json");
    expect(fetchMock.mock.calls[1]![0]).toBe("/collections/all?sort_by=title-ascending&view=json");
  });

  it("returns null when the collection page cannot be read", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404 } as Response)) as unknown as typeof fetch;

    expect(await collectCollectionPages()).toBeNull();
  });
});
