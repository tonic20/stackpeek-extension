import { describe, it, expect } from "vitest";
import { CSV_HEADER, toCsv } from "../lib/csv";

// Minimal shape of a /products.json entry. Fields absent here are the ones the
// public feed genuinely does not carry.
const product = (over: Record<string, unknown> = {}) => ({
  handle: "wool-runner",
  title: "Wool Runner",
  body_html: "<p>Cosy</p>",
  vendor: "Allbirds",
  product_type: "Shoes",
  tags: ["wool", "runner"],
  published_at: "2026-01-02T00:00:00-05:00",
  options: [{ name: "Size" }],
  variants: [
    { sku: "WR-9", price: "98.00", compare_at_price: null, grams: 300,
      requires_shipping: true, taxable: true, option1: "9", option2: null, option3: null },
  ],
  images: [{ src: "https://cdn.example/a.jpg", position: 1, alt: "side" }],
  ...over,
});

const rows = (csv: string) => csv.replace(/^﻿/, "").trim().split("\n");
// Splits one CSV line, honouring quotes -- the fixtures deliberately contain commas.
// Takes undefined so callers can index rows() inline: under
// noUncheckedIndexedAccess a missing row is a type error at every call site
// otherwise. A missing row still fails the test, on the assertion rather than
// on a TypeError here.
const cells = (line: string | undefined) => (line ?? "").match(/("([^"]|"")*"|[^,]*)(,|$)/g)!
  .slice(0, -1).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));

describe("CSV_HEADER", () => {
  it("is the canonical 31 columns in Shopify's import order", () => {
    expect(CSV_HEADER).toHaveLength(31);
    expect(CSV_HEADER[0]).toBe("Handle");
    expect(CSV_HEADER[1]).toBe("Title");
    expect(CSV_HEADER.at(-1)).toBe("Status");
  });
});

describe("toCsv", () => {
  it("opens with a UTF-8 BOM so Excel does not mangle non-ASCII titles", () => {
    expect(toCsv([product()]).startsWith("﻿")).toBe(true);
  });

  it("writes the header first", () => {
    expect(cells(rows(toCsv([product()]))[0])).toEqual([...CSV_HEADER]);
  });

  // Row count is Sum max(variants, images, 1) -- NOT sum of variants. A product
  // with 1 variant and 3 images still needs 3 rows to carry the image URLs.
  it("emits one row per max(variants, images, 1)", () => {
    const csv = toCsv([product({
      variants: [{ sku: "a", price: "1.00", option1: "S" }],
      images: [{ src: "1.jpg", position: 1 }, { src: "2.jpg", position: 2 }, { src: "3.jpg", position: 3 }],
    })]);

    expect(rows(csv)).toHaveLength(1 + 3);
  });

  it("emits one row for a product with neither variants nor images", () => {
    expect(rows(toCsv([product({ variants: [], images: [] })]))).toHaveLength(1 + 1);
  });

  // Shopify's importer groups rows by Handle, so a blank Handle on a
  // continuation row breaks the import. Repeating it on every row is required
  // for a re-importable file, not an arbitrary stylistic choice.
  it("repeats Handle on every row of a product", () => {
    const csv = toCsv([product({
      variants: [{ sku: "a", price: "1.00" }, { sku: "b", price: "2.00" }],
      images: [],
    })]);
    const [, first, second] = rows(csv);

    expect(cells(first)[0]).toBe("wool-runner");
    expect(cells(second)[0]).toBe("wool-runner");
  });

  it("carries product-level columns only on the first row", () => {
    const csv = toCsv([product({
      variants: [{ sku: "a", price: "1.00" }, { sku: "b", price: "2.00" }],
      images: [],
    })]);
    const [, first, second] = rows(csv);
    const at = (line: string | undefined, name: string) => cells(line)[CSV_HEADER.indexOf(name as never)];

    expect(at(first, "Title")).toBe("Wool Runner");
    expect(at(second, "Title")).toBe("");
    expect(at(first, "Body (HTML)")).toBe("<p>Cosy</p>");
    expect(at(second, "Body (HTML)")).toBe("");
  });

  // The store's real SEO fields are not in the public feed this extension
  // reads, so there is no observed value to put here; synthesising one would
  // put an invented value inside a file the user may re-import into a real
  // store.
  it("leaves SEO Title and SEO Description blank rather than synthesising them", () => {
    const csv = toCsv([product()]);
    const at = (name: string) => cells(rows(csv)[1])[CSV_HEADER.indexOf(name as never)];

    expect(at("SEO Title")).toBe("");
    expect(at("SEO Description")).toBe("");
  });

  it("leaves the columns the feed cannot supply blank", () => {
    const csv = toCsv([product()]);
    const at = (name: string) => cells(rows(csv)[1])[CSV_HEADER.indexOf(name as never)];

    expect(at("Product Category")).toBe("");
    expect(at("Variant Inventory Qty")).toBe("");
    expect(at("Variant Inventory Tracker")).toBe("");
    expect(at("Variant Barcode")).toBe("");
  });

  it("hardcodes the two columns Shopify's importer requires a value for", () => {
    const csv = toCsv([product()]);
    const at = (name: string) => cells(rows(csv)[1])[CSV_HEADER.indexOf(name as never)];

    expect(at("Variant Inventory Policy")).toBe("deny");
    expect(at("Variant Fulfillment Service")).toBe("manual");
  });

  it("derives Status from published_at", () => {
    const live = toCsv([product()]);
    const draft = toCsv([product({ published_at: null })]);
    const at = (csv: string) => cells(rows(csv)[1])[CSV_HEADER.indexOf("Status" as never)];

    expect(at(live)).toBe("active");
    expect(at(draft)).toBe("draft");
  });

  it("takes requires_shipping and taxable from the feed, defaulting to true", () => {
    const csv = toCsv([product({ variants: [{ sku: "a", price: "1.00", requires_shipping: false }] })]);
    const at = (name: string) => cells(rows(csv)[1])[CSV_HEADER.indexOf(name as never)];

    expect(at("Variant Requires Shipping")).toBe("false");
    expect(at("Variant Taxable")).toBe("true");
  });

  it("joins tags with commas and quotes the field", () => {
    const csv = toCsv([product()]);

    expect(cells(rows(csv)[1])[CSV_HEADER.indexOf("Tags" as never)]).toBe("wool, runner");
  });

  // A title containing a quote or a comma is ordinary in this data and must not
  // shift every later column by one.
  it("escapes quotes and commas without shifting later columns", () => {
    const csv = toCsv([product({ title: 'The 9" Short, "Classic"' })]);
    const row = cells(rows(csv)[1]);

    expect(row[CSV_HEADER.indexOf("Title" as never)]).toBe('The 9" Short, "Classic"');
    // The column after Title must still be Body (HTML), not a fragment of it.
    expect(row[CSV_HEADER.indexOf("Body (HTML)" as never)]).toBe("<p>Cosy</p>");
  });

  // Asserted on the raw output rather than through the splitter above: a quoted
  // newline is exactly what that naive splitter cannot parse, which is the point.
  it("wraps a field containing a newline in quotes", () => {
    const csv = toCsv([product({ body_html: "a\nb" })]);

    expect(csv).toContain('"a\nb"');
  });

  it("pairs each option name with its variant value", () => {
    const csv = toCsv([product({
      options: [{ name: "Size" }, { name: "Colour" }],
      variants: [{ sku: "a", price: "1.00", option1: "9", option2: "Blue" }],
    })]);
    const at = (name: string) => cells(rows(csv)[1])[CSV_HEADER.indexOf(name as never)];

    expect(at("Option1 Name")).toBe("Size");
    expect(at("Option1 Value")).toBe("9");
    expect(at("Option2 Name")).toBe("Colour");
    expect(at("Option2 Value")).toBe("Blue");
  });

  it("writes image columns from the images array", () => {
    const csv = toCsv([product()]);
    const at = (name: string) => cells(rows(csv)[1])[CSV_HEADER.indexOf(name as never)];

    expect(at("Image Src")).toBe("https://cdn.example/a.jpg");
    expect(at("Image Position")).toBe("1");
    expect(at("Image Alt Text")).toBe("side");
  });
});
