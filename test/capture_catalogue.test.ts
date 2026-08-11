import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  cappedSnapshot, countSitemapProducts, sitemapProductTotal, toSnapshot,
} from "../scripts/capture_catalogue";
import type { CatalogueDigest, CatalogueEntry } from "../lib/catalogue_types";

const digest: CatalogueDigest = {
  available: true, reason: null, count: 3, variants: 7, priceMin: 18, priceMax: 240,
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
      available: false, reason: "not_public", count: 0, variants: 0, priceMin: null, priceMax: null,
      newest: null, currency: null, index: [],
    };
    const snap = toSnapshot(empty, []);
    expect(snap.available).toBe(false);
    expect(snap.best_sellers).toEqual([]);
  });

  // The seed is read straight into ERB, so an optional flag would make the view
  // tell false from absent. It carries a boolean either way.
  it("carries the export ceiling through, and states it as false when unset", () => {
    expect(toSnapshot({ ...digest, capped: true }, []).capped).toBe(true);
    expect(toSnapshot(digest, []).capped).toBe(false);
  });
});

describe("countSitemapProducts", () => {
  // Shopify serves a sitemap as one long line, so anything line-oriented sees a
  // single blob. And every <url> carries an <image:image> block whose
  // <image:loc> must not be counted as a second product.
  const sitemap =
    '<?xml version="1.0"?><urlset><url><loc>https://kith.com/products/a</loc>' +
    "<image:image><image:loc>https://cdn.shopify.com/s/files/1/a.jpg</image:loc></image:image></url>" +
    "<url><loc>https://kith.com/products/b</loc></url>" +
    "<url><loc>https://kith.com/collections/all</loc></url></urlset>";

  it("counts product URLs, and only those, from a single-line sitemap", () => {
    expect(countSitemapProducts(sitemap)).toBe(2);
  });

  it("counts nothing in a sitemap that lists no products", () => {
    expect(countSitemapProducts("<urlset><url><loc>https://kith.com/pages/about</loc></url></urlset>")).toBe(0);
  });
});

describe("sitemapProductTotal", () => {
  // Fixtures are built under test/, never in the system temp directory:
  // extension/ ships standalone to a public mirror and nothing under test/ may
  // read outside the package.
  const built: string[] = [];
  afterEach(() => {
    while (built.length) rmSync(built.pop()!, { recursive: true, force: true });
  });

  const sitemapOf = (handles: string[]) =>
    `<?xml version="1.0"?><urlset>${handles
      .map((h) => `<url><loc>https://s.example/products/${h}</loc>` +
                  `<image:image><image:loc>https://cdn.example/${h}.jpg</image:loc></image:image></url>`)
      .join("")}</urlset>`;

  // A capture directory as remote_fetch.sh leaves one: the store's sitemap
  // index, the per-product sitemaps it lists, and one status line per fetch.
  // `indexed` and `status` are overridable so a capture can be made incomplete
  // in each of the two ways that matter.
  function capture(
    files: string[][],
    { indexed = files.length, status }: { indexed?: number; status?: string[] } = {},
  ): string {
    const dir = mkdtempSync(resolve(__dirname, "capture-"));
    built.push(dir);
    files.forEach((handles, i) =>
      writeFileSync(resolve(dir, `sitemap-products-${i + 1}.xml`), sitemapOf(handles)));
    writeFileSync(
      resolve(dir, "sitemap.xml"),
      `<?xml version="1.0"?><sitemapindex>${Array.from({ length: indexed }, (_, i) =>
        `<sitemap><loc>https://s.example/sitemap_products_${i + 1}.xml?from=1&amp;to=9</loc></sitemap>`,
      ).join("")}<sitemap><loc>https://s.example/sitemap_pages_1.xml</loc></sitemap></sitemapindex>`,
    );
    writeFileSync(resolve(dir, "status"), `${(status ?? [
      "home 200", "sitemap 200",
      ...files.map((_, i) => `sitemap-products-${i + 1} 200`),
    ]).join("\n")}\n`);
    return dir;
  }

  it("sums the product URLs across a complete capture", () => {
    expect(sitemapProductTotal(capture([ [ "a", "b" ], [ "c" ] ]))).toBe(3);
  });

  // null, not 0: "we captured no sitemaps" is not a statement about the store,
  // and a 0 here would flow straight into a published count of zero products.
  it("answers null when the capture holds no sitemaps", () => {
    expect(sitemapProductTotal("test/no-such-capture-dir")).toBeNull();
  });

  // The index is the only thing that knows how many there should be. Summing
  // whatever landed on disk turns a run that stopped after 20 of 35 sitemaps
  // into an exact total for a store two-thirds counted.
  it("answers null when a sitemap the index lists was never captured", () => {
    expect(sitemapProductTotal(capture([ [ "a", "b" ], [ "c" ] ], { indexed: 3 }))).toBeNull();
  });

  it("answers null when the index itself was not captured", () => {
    const dir = capture([ [ "a" ] ]);
    rmSync(resolve(dir, "sitemap.xml"));
    expect(sitemapProductTotal(dir)).toBeNull();
  });

  // remote_fetch.sh discards each sitemap fetch's return value, but the status
  // file still records the code -- so a throttled or refused sitemap is
  // recoverable here, and a total summed over it would be short by whatever
  // that file held.
  it("answers null when a sitemap fetch did not answer 200", () => {
    const dir = capture([ [ "a", "b" ], [ "c" ] ], {
      status: [ "sitemap 200", "sitemap-products-1 200", "sitemap-products-2 429" ],
    });
    expect(sitemapProductTotal(dir)).toBeNull();
  });

  it("answers null when there is no status file to check the fetches against", () => {
    const dir = capture([ [ "a" ] ]);
    rmSync(resolve(dir, "status"));
    expect(sitemapProductTotal(dir)).toBeNull();
  });

  // curl's --max-time expires mid-body and still reports the 200 it got in the
  // headers, so the code proves nothing about the bytes. A sitemap is a single
  // XML document; if its closing tag is missing, the file is a fragment and
  // counting it publishes a total short by an unknown amount.
  it("answers null when a sitemap body was truncated mid-fetch", () => {
    const dir = capture([ [ "a", "b" ] ]);
    writeFileSync(
      resolve(dir, "sitemap-products-1.xml"),
      sitemapOf([ "a", "b" ]).replace("</urlset>", ""),
    );
    expect(sitemapProductTotal(dir)).toBeNull();
  });
});

describe("cappedSnapshot", () => {
  // 40 pages of 250 that never ran short: the count is the cap, and the variant
  // total was summed over exactly those 10,000 products.
  const walked = toSnapshot(
    { ...digest, count: 10_000, variants: 26_431, capped: true },
    [ { handle: "a", title: "A", price: "18.00" } ],
  );

  it("adopts the sitemap total and discloses the ceiling", () => {
    const snap = cappedSnapshot(walked, 34_935)!;
    expect(snap.count).toBe(34_935);
    expect(snap.capped).toBe(true);
  });

  // The one figure that cannot survive the swap: counted from the first 10,000
  // products, it would sit beside a 34,935-product total as a floor dressed as
  // a total. The panel renders null as an em dash.
  it("drops the variant total, which was counted from the prefix", () => {
    expect(cappedSnapshot(walked, 34_935)!.variants).toBeNull();
  });

  // Both endpoints were computed over the first 10,000 products, and
  // /products.json is served published_at DESCENDING -- so the unread remainder
  // is systematically the older stock, exactly where clearance pricing lives.
  // The true minimum can only be lower and the true maximum only higher, which
  // makes the pair a bound in the wrong direction, not a range. Under a
  // 34,935-product total it reads as the range of all of them.
  it("drops the price range, which was computed over the prefix", () => {
    const snap = cappedSnapshot(walked, 34_935)!;
    expect(snap.price_min).toBeNull();
    expect(snap.price_max).toBeNull();
  });

  // The ranking is the store's real best-selling order joined against an index
  // holding only the first 10,000 products: everything above the cap is dropped
  // and the survivors are renumbered from 1, so "#1" names whatever the prefix
  // happened to keep. rankCatalogue already refuses a capped digest; this is
  // the same refusal stated where the reading is published.
  it("records no ranking, which was joined against the prefix", () => {
    expect(cappedSnapshot(walked, 34_935)!.best_sellers).toEqual([]);
  });

  // Kept, and the only prefix-derived field that is. The feed is published_at
  // descending, so the prefix IS the newest-published 10,000 -- every unread
  // product was published earlier than the prefix's oldest.
  it("keeps the newest date", () => {
    expect(cappedSnapshot(walked, 34_935)!.newest).toBe("2026-07-30T00:00:00Z");
  });

  it("records nothing when no sitemap was captured to count", () => {
    expect(cappedSnapshot(walked, null)).toBeNull();
  });

  // A sitemap that knows no more than the walk did is not a total either -- it
  // would only restate the cap, which is the claim this branch exists to avoid.
  it("records nothing when the sitemap knows no more than the walk did", () => {
    expect(cappedSnapshot(walked, 10_000)).toBeNull();
    expect(cappedSnapshot(walked, 900)).toBeNull();
  });
});
