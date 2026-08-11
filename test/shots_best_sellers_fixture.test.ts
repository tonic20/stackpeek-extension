import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { rankCatalogue } from "../lib/ranking";
import type { CatalogueDigest, CatalogueEntry } from "../lib/catalogue_types";

// Frame 4's Best sellers section is filled from a fixture, not a live fetch:
// scripts/shots.py's collection_pages_for() builds two collection-page bodies
// from db/demo_stores.json's captured catalogue.best_sellers list (bestSelling
// in the captured order, alphabetical sorted by handle) and hands them to the
// SHIPPED rankCatalogue/rankedHandles code, exactly as this test does.
//
// This is the check the task asked to run before trusting the render: does
// reconstructing those two bodies from a real capture actually reproduce that
// capture's order through the real ranking code, rather than through
// something that only looks like it?
//
// flybyjing.com's best_sellers list is READ from backend/db/demo_stores.json
// rather than hand-transcribed, so a regression here stays a regression
// against whatever the corpus currently holds. An inlined copy (this test's
// previous form) diffed identically against the dump the day it was written,
// but nothing kept it that way: after the next capture:catalogue pass, an
// inlined list keeps this test green against data frame 4 no longer uses,
// which is precisely the false confidence this test exists to rule out.
const DUMP_PATH = resolve(__dirname, "../../backend/db/demo_stores.json");

// The dump lives in the stackpeek monorepo. This directory is also published
// on its own as github.com/tonic20/stackpeek-extension, a mirror of extension/
// alone, where ../../backend does not exist.
//
// The guard has to sit at module scope rather than inside the describe: the
// read below runs at import time, so in the mirror an unguarded readFileSync
// takes the whole file down before any skip could apply -- and takes it down
// with an ENOENT stack rather than anything a reader could act on.
const IN_MONOREPO = existsSync(DUMP_PATH);

// Missing and incomplete are different failures and must stay so. A missing
// file means "not the monorepo" and skips. A dump that is present but has lost
// flybyjing.com's captured best_sellers means the corpus regressed since the
// last capture:catalogue pass, which is exactly the false confidence this
// fixture exists to rule out -- so it still throws.
function readBestSellers(): CatalogueEntry[] {
  const dump = JSON.parse(readFileSync(DUMP_PATH, "utf8")) as Array<{
    domain: string;
    catalogue?: { best_sellers?: CatalogueEntry[] };
  }>;
  const flybyjing = dump.find((e) => e.domain === "flybyjing.com");
  if (!flybyjing?.catalogue?.best_sellers) {
    throw new Error(
      "flybyjing.com is missing (or has no captured best_sellers) in backend/db/demo_stores.json " +
        "— this fixture needs it to test frame 4's Best sellers replay against real data.",
    );
  }
  return flybyjing.catalogue.best_sellers;
}

const FLYBYJING_BEST_SELLERS: CatalogueEntry[] = IN_MONOREPO ? readBestSellers() : [];

// Mirrors shots.py's _collection_page_html: bare `/products/<handle>` links,
// which exercise rankedHandles' tier-3 permutation path rather than the
// collection-scoped tier-2 shortcut. This is a REIMPLEMENTATION, not a call
// into shots.py -- nothing enforces the two stay identical. If shots.py's
// _collection_page_html ever changes shape (e.g. switches to collection-
// scoped hrefs, tier 2), this test keeps exercising tier 3 and would not
// notice the render pipeline had moved on.
const collectionPageHtml = (entries: CatalogueEntry[]): string => {
  const items = entries
    .map((e) => `    <li><a href="/products/${e.handle}">${e.title}</a></li>`)
    .join("\n");
  return `<html><body><ul>\n${items}\n</ul></body></html>`;
};

const digestOf = (index: CatalogueEntry[]): CatalogueDigest => ({
  available: true, reason: null, count: index.length, variants: index.length,
  priceMin: 5, priceMax: 150, newest: null, currency: "USD", index,
});

describe.skipIf(!IN_MONOREPO)("frame 4's Best sellers fixture", () => {
  it("reproduces flybyjing.com's captured order through the shipped ranking code", () => {
    const alphabetical = [...FLYBYJING_BEST_SELLERS].sort((a, b) => (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0));
    const pages = {
      bestSelling: collectionPageHtml(FLYBYJING_BEST_SELLERS),
      alphabetical: collectionPageHtml(alphabetical),
    };

    // Sanity: the two bodies must actually disagree, or rankedHandles would
    // (correctly) read that as "the store ignored sort_by" and return [].
    expect(pages.bestSelling).not.toEqual(pages.alphabetical);

    const ranked = rankCatalogue(pages, digestOf(FLYBYJING_BEST_SELLERS), FLYBYJING_BEST_SELLERS.length + 1);

    expect(ranked).toHaveLength(FLYBYJING_BEST_SELLERS.length);
    expect(ranked.map((e) => e.handle)).toEqual(FLYBYJING_BEST_SELLERS.map((e) => e.handle));
    expect(ranked.slice(0, 3)).toEqual(FLYBYJING_BEST_SELLERS.slice(0, 3));
  });
});
