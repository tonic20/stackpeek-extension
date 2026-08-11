import { describe, expect, it } from "vitest";
import { DIGEST_EDGES_QUERY, BEST_SELLERS_QUERY, EXPORT_PAGE_QUERY, EXPORT_PAGE_SIZE } from "../lib/storefront_queries";

describe("storefront queries", () => {
  // Two sort keys give an exact price range in two cost-5 requests, where
  // deriving it by traversal costs minutes.
  it("asks for the cheapest and priciest product by price", () => {
    expect(DIGEST_EDGES_QUERY).toContain("sortKey: PRICE");
    expect(DIGEST_EDGES_QUERY).toContain("reverse: true");
    expect(DIGEST_EDGES_QUERY).toContain("currencyCode");
  });

  it("asks Shopify for its own best-seller ranking", () => {
    expect(BEST_SELLERS_QUERY(25)).toContain("sortKey: BEST_SELLING");
    expect(BEST_SELLERS_QUERY(25)).toContain("first: 25");
  });

  // The exported constant is what storefront_bridge multiplies by MAX_PAGES to
  // get the export ceiling it discloses, so the query must be built from the
  // same number rather than a literal that could drift away from it.
  it("builds the export page from the exported page size", () => {
    expect(EXPORT_PAGE_SIZE).toBe(250);
    expect(EXPORT_PAGE_QUERY(null)).toContain(`first: ${EXPORT_PAGE_SIZE}`);
  });

  it("pages the export by cursor, at the measured page size", () => {
    expect(EXPORT_PAGE_QUERY(null)).toContain("first: 250");
    expect(EXPORT_PAGE_QUERY(null)).not.toContain("after:");
    expect(EXPORT_PAGE_QUERY("abc")).toContain('after: "abc"');
    expect(EXPORT_PAGE_QUERY(null)).toContain("hasNextPage");
  });

  it("requests every column csv.ts can write", () => {
    for (const field of ["descriptionHtml", "productType", "publishedAt", "seo",
                         "compareAtPrice", "weightUnit", "taxable", "selectedOptions"]) {
      expect(EXPORT_PAGE_QUERY(null)).toContain(field);
    }
  });
});
