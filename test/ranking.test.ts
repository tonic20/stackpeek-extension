import { describe, it, expect } from "vitest";
import { rankCatalogue } from "../lib/ranking";
import type { CatalogueDigest } from "../lib/catalogue_types";

const grid = (hs: string[]) =>
  `<html><body><ul>${hs.map((h) => `<li><a href="/products/${h}">${h}</a></li>`).join("")}</ul></body></html>`;

const digestOf = (handles: string[]): CatalogueDigest => ({
  available: true, reason: null, count: handles.length, variants: handles.length,
  priceMin: 1, priceMax: 9, newest: null, currency: "USD",
  index: handles.map((h, i) => ({ handle: h, title: h.toUpperCase(), price: `${i + 1}.00` })),
});

describe("rankCatalogue", () => {
  it("returns the best-selling order, joined to the index", () => {
    const pages = { bestSelling: grid(["b", "a"]), alphabetical: grid(["a", "b"]) };

    expect(rankCatalogue(pages, digestOf(["a", "b"]), 25)).toEqual([
      { handle: "b", title: "B", price: "2.00" },
      { handle: "a", title: "A", price: "1.00" },
    ]);
  });

  // THE guard, at the level the panel actually calls.
  it("returns nothing when the store ignored the sort", () => {
    const same = grid(["a", "b"]);

    expect(rankCatalogue({ bestSelling: same, alphabetical: same }, digestOf(["a", "b"]), 25)).toEqual([]);
  });

  it("returns nothing when the collection page could not be read", () => {
    expect(rankCatalogue(null, digestOf(["a", "b"]), 25)).toEqual([]);
  });

  it("returns nothing when the catalogue itself is unavailable", () => {
    const pages = { bestSelling: grid(["b", "a"]), alphabetical: grid(["a", "b"]) };
    const unavailable: CatalogueDigest = {
      available: false, reason: "not_public", count: 0, variants: 0, priceMin: null, priceMax: null,
      newest: null, currency: null, index: [],
    };

    expect(rankCatalogue(pages, unavailable, 25)).toEqual([]);
  });

  // The collection pages here are perfect: the two sorts disagree, and every
  // ranked handle is in the index. The refusal is about the INDEX -- a capped
  // digest carries the first 10,000 products of a larger catalogue, while the
  // best-selling order covers all of them, so the join drops whatever ranks
  // above the cap and renumbers the rest from 1.
  it("returns nothing when the index is only a prefix of the catalogue", () => {
    const pages = { bestSelling: grid(["b", "a"]), alphabetical: grid(["a", "b"]) };

    expect(rankCatalogue(pages, { ...digestOf(["a", "b"]), capped: true }, 25)).toEqual([]);
  });

  it("caps the ranking at the limit", () => {
    const hs = Array.from({ length: 40 }, (_, i) => `p${i}`);
    const pages = { bestSelling: grid([...hs].reverse()), alphabetical: grid(hs) };

    expect(rankCatalogue(pages, digestOf(hs), 25)).toHaveLength(25);
  });

  // A ranked handle the feed does not carry has no title or price to show.
  it("drops ranked handles absent from the catalogue", () => {
    const pages = { bestSelling: grid(["ghost", "a", "b"]), alphabetical: grid(["a", "b", "ghost"]) };

    expect(rankCatalogue(pages, digestOf(["a", "b"]), 25).map((e) => e.handle)).toEqual(["a", "b"]);
  });
});
