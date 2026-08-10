import { describe, it, expect } from "vitest";
import { toSnapshot } from "../scripts/capture_catalogue";
import type { CatalogueDigest, CatalogueEntry } from "../lib/catalogue_types";

const digest: CatalogueDigest = {
  available: true, count: 3, variants: 7, priceMin: 18, priceMax: 240,
  newest: "2026-07-30T00:00:00Z", currency: "USD",
  index: [{ handle: "a", title: "A", price: "18.00" }],
};

describe("toSnapshot", () => {
  it("renames the digest fields to the backend's snake_case shape", () => {
    const snap = toSnapshot(digest, []);
    expect(snap).toMatchObject({
      available: true, count: 3, variants: 7,
      price_min: 18, price_max: 240, currency: "USD",
    });
    expect(snap).not.toHaveProperty("priceMin");
  });

  it("drops the index — it exists only to join ranks against", () => {
    expect(toSnapshot(digest, [])).not.toHaveProperty("index");
  });

  it("carries best sellers through in rank order", () => {
    const ranks: CatalogueEntry[] = [
      { handle: "b", title: "B", price: "20.00" },
      { handle: "a", title: "A", price: "18.00" },
    ];
    expect(toSnapshot(digest, ranks).best_sellers).toEqual([
      { handle: "b", title: "B", price: "20.00" },
      { handle: "a", title: "A", price: "18.00" },
    ]);
  });

  it("reports an unreadable catalogue as unavailable with no ranks", () => {
    const empty: CatalogueDigest = {
      available: false, count: 0, variants: 0, priceMin: null, priceMax: null,
      newest: null, currency: null, index: [],
    };
    const snap = toSnapshot(empty, []);
    expect(snap.available).toBe(false);
    expect(snap.best_sellers).toEqual([]);
  });
});
