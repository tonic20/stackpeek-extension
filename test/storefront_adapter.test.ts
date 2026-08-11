import { describe, expect, it } from "vitest";
import { adaptStorefrontProduct, toGrams } from "../lib/storefront_adapter";

const node = {
  handle: "tee", title: "Tee", descriptionHtml: "<p>Soft</p>", vendor: "Acme",
  productType: "Shirts", tags: ["new"], publishedAt: "2026-01-02T00:00:00Z",
  createdAt: "2026-01-01T00:00:00Z",
  seo: { title: "Buy a Tee", description: "The best tee" },
  options: [{ name: "Size" }],
  images: { nodes: [{ url: "https://cdn/x.jpg", altText: "front" }] },
  variants: { nodes: [{
    sku: "T-1", weight: 0.5, weightUnit: "POUNDS", requiresShipping: true, taxable: true,
    selectedOptions: [{ name: "Size", value: "M" }],
    price: { amount: "20.00", currencyCode: "USD" },
    compareAtPrice: { amount: "30.00" },
  }] },
} as any;

describe("toGrams", () => {
  it("converts each unit Shopify can return", () => {
    expect(toGrams(1, "KILOGRAMS")).toBe(1000);
    expect(toGrams(1, "GRAMS")).toBe(1);
    expect(toGrams(1, "POUNDS")).toBeCloseTo(453.592, 2);
    expect(toGrams(1, "OUNCES")).toBeCloseTo(28.3495, 3);
  });

  // An unknown unit must not silently become grams -- a wrong weight is worse
  // than a blank one, and the CSV already leaves unknown columns empty.
  it("returns null rather than guessing", () => {
    expect(toGrams(1, "STONES")).toBeNull();
    expect(toGrams(null, "GRAMS")).toBeNull();
  });
});

describe("adaptStorefrontProduct", () => {
  it("produces the shape csv.ts already consumes", () => {
    const p = adaptStorefrontProduct(node);
    expect(p.handle).toBe("tee");
    expect(p.body_html).toBe("<p>Soft</p>");
    expect(p.product_type).toBe("Shirts");
    expect(p.published_at).toBe("2026-01-02T00:00:00Z");
    expect(p.options).toEqual([{ name: "Size" }]);
    expect(p.images?.[0]).toEqual({ src: "https://cdn/x.jpg", alt: "front", position: 1 });
    expect(p.variants?.[0]).toMatchObject({
      sku: "T-1", price: "20.00", compare_at_price: "30.00",
      option1: "M", requires_shipping: true, taxable: true,
    });
    expect(p.variants?.[0]?.grams).toBeCloseTo(226.796, 2);
  });

  it("carries the merchant's SEO fields through", () => {
    const p = adaptStorefrontProduct(node);
    expect(p.seo_title).toBe("Buy a Tee");
    expect(p.seo_description).toBe("The best tee");
  });

  // Measured 2026-08-11: seo.title is null when unset and never echoes the
  // product title, so a blank stays blank rather than becoming an invention.
  it("leaves SEO blank when the merchant set none", () => {
    const p = adaptStorefrontProduct({ ...node, seo: { title: null, description: null } });
    expect(p.seo_title).toBeNull();
    expect(p.seo_description).toBeNull();
  });

  it("survives a product with no variants or images", () => {
    const p = adaptStorefrontProduct({ ...node, variants: { nodes: [] }, images: { nodes: [] } });
    expect(p.variants).toEqual([]);
    expect(p.images).toEqual([]);
  });

  // A malformed network response (a truncated body, a proxy that reshapes
  // JSON) can hand back a non-array where nodes belongs. This must degrade to
  // an empty list for the one product, not throw -- a throw here reaches
  // fetchStorefrontExport's page loop and discards every earlier page's
  // already-collected products, not just this one.
  it("degrades a non-array variants.nodes to an empty list instead of throwing", () => {
    const p = adaptStorefrontProduct({ ...node, variants: { nodes: "not-an-array" as any } });
    expect(p.variants).toEqual([]);
  });

  it("degrades a non-array images.nodes to an empty list instead of throwing", () => {
    const p = adaptStorefrontProduct({ ...node, images: { nodes: "not-an-array" as any } });
    expect(p.images).toEqual([]);
  });

  it("maps selectedOptions to option1/option2/option3 by position", () => {
    const p = adaptStorefrontProduct({
      ...node,
      options: [{ name: "Size" }, { name: "Color" }],
      variants: { nodes: [{
        sku: "T-2", weight: 0.5, weightUnit: "POUNDS", requiresShipping: true, taxable: true,
        selectedOptions: [{ name: "Size", value: "M" }, { name: "Color", value: "Blue" }],
        price: { amount: "20.00", currencyCode: "USD" },
        compareAtPrice: { amount: "30.00" },
      }] },
    });
    expect(p.variants?.[0]).toMatchObject({ option1: "M", option2: "Blue", option3: null });
  });
});
