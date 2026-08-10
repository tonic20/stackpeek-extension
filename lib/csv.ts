import type { CatalogueProduct } from "./catalogue_types";

// The canonical header, matching what Shopify's own importer expects and the
// header shape that has become the de-facto standard for this kind of export.
// Gift Card, Variant Image, Variant Weight Unit and the Google Shopping
// columns are deliberately absent: adding non-standard extras risks producing
// a file that Shopify's importer, or other tooling built against the
// standard shape, doesn't handle the way this file's other columns are
// handled. Do not add them (design D9).
export const CSV_HEADER = [
  "Handle", "Title", "Body (HTML)", "Vendor", "Product Category", "Type", "Tags", "Published",
  "Option1 Name", "Option1 Value", "Option2 Name", "Option2 Value", "Option3 Name", "Option3 Value",
  "Variant SKU", "Variant Grams", "Variant Inventory Tracker", "Variant Inventory Qty",
  "Variant Inventory Policy", "Variant Fulfillment Service", "Variant Price",
  "Variant Compare At Price", "Variant Requires Shipping", "Variant Taxable", "Variant Barcode",
  "Image Src", "Image Position", "Image Alt Text", "SEO Title", "SEO Description", "Status",
] as const;

function escape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(products: CatalogueProduct[]): string {
  const lines: string[] = [CSV_HEADER.map(escape).join(",")];

  for (const p of products) {
    const variants = p.variants ?? [];
    const images = p.images ?? [];
    const options = p.options ?? [];
    // NOT variants.length: a product with one variant and three images still
    // needs three rows to carry the image URLs, and Shopify reads them that way.
    const rows = Math.max(variants.length, images.length, 1);

    for (let i = 0; i < rows; i++) {
      const v = variants[i];
      const img = images[i];
      // Product-level fields ride only on the first row -- except Handle, which
      // is the importer's grouping key and must be on every one.
      const first = i === 0;

      lines.push([
        p.handle,
        first ? p.title : "",
        first ? p.body_html : "",
        first ? p.vendor : "",
        "",                                   // Product Category -- not in the feed
        first ? p.product_type : "",
        first ? (p.tags ?? []).join(", ") : "",
        first ? String(!!p.published_at) : "",
        v ? (options[0]?.name ?? "") : "", v?.option1 ?? "",
        v ? (options[1]?.name ?? "") : "", v?.option2 ?? "",
        v ? (options[2]?.name ?? "") : "", v?.option3 ?? "",
        v?.sku ?? "",
        v?.grams ?? "",
        "",                                   // Inventory Tracker -- not in the feed
        "",                                   // Inventory Qty -- not in the feed
        v ? "deny" : "",                      // Inventory Policy -- importer requires a value
        v ? "manual" : "",                    // Fulfillment Service -- importer requires a value
        v?.price ?? "",
        v?.compare_at_price ?? "",
        v ? String(v.requires_shipping ?? true) : "",
        v ? String(v.taxable ?? true) : "",
        "",                                   // Barcode -- not in the feed
        img?.src ?? "",
        img?.position ?? "",
        img?.alt ?? "",
        "",                                   // SEO Title -- see below
        "",                                   // SEO Description -- see below
        first ? (p.published_at ? "active" : "draft") : "",
      ].map(escape).join(","));
    }
  }

  // SEO Title and SEO Description stay blank on purpose. The store's real
  // values live in Shopify admin, not in the public feed this extension
  // reads, so there is no observed value to put here. It would be easy
  // enough to synthesise one from the title and a stripped body_html, but
  // this file is a real Shopify product import CSV that a user may re-import
  // into a real store, and a synthesised value sitting in a column next to
  // genuinely observed ones would be indistinguishable from data the
  // storefront actually published. Leaving the column blank is the honest
  // option; inventing a plausible-looking value is not.
  //
  // The BOM is not decoration: without it Excel mis-renders non-ASCII product
  // titles, which most catalogues contain.
  return "﻿" + lines.join("\n") + "\n";
}
