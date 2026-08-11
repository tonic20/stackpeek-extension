import { rankedHandles } from "./best_sellers";
import type { CatalogueDigest, CatalogueEntry, CollectionPages } from "./catalogue_types";

// Runs in the panel, not the page. chrome.scripting serialises an injected
// function's own source and nothing else, so the in-page reader cannot call
// rankedHandles -- and inlining a copy of it would put the one piece of logic
// this feature's honesty rests on in two places.
//
// The join is against the digest's index rather than a refetch: the naive
// alternative resolves each ranked handle with its own /products/<handle>.json
// request at concurrency 4, up to 25 further requests for data already sitting
// in memory (design D6). Joining locally also guarantees the titles and prices
// agree with the count rendered above them.
export function rankCatalogue(
  pages: CollectionPages | null,
  digest: CatalogueDigest,
  limit: number,
): CatalogueEntry[] {
  if (!pages || !digest.available) return [];

  // A capped digest's index holds only the first 10,000 products of a larger
  // catalogue, while the best-selling order below covers ALL of them. Joining
  // the two is not a partial ranking, it is a wrong one: every ranked handle
  // beyond the cap is silently dropped by the filter, and .slice then renumbers
  // the survivors 1..N -- so the store's 25th best seller is printed as "#1"
  // with #1-#24 nowhere on screen. Measured on kith.com: 289 of 370 ranked
  // handles dropped; on yosekastationery.com, 13 of 20. A rank is a claim about
  // position, and there is no honest one to make from a prefix.
  //
  // Refusing costs nothing the panel wants: an empty result is what sends it to
  // Shopify's own BEST_SELLING sort, which is authoritative and untouched by
  // any read cap.
  if (digest.capped) return [];

  // Empty whenever the two sorts agreed, which means the store ignored sort_by
  // and there is no ranking to show (design D3).
  const handles = rankedHandles(pages.bestSelling, pages.alphabetical);
  if (!handles.length) return [];

  const byHandle = new Map(digest.index.map((e) => [e.handle, e]));
  return handles
    .map((h) => byHandle.get(h))
    .filter((e): e is CatalogueEntry => !!e)
    .slice(0, limit);
}
