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
