// The Storefront API catalogue path, assembled: resolve versions, inject the
// fetchers, adapt the results. Mirrors lib/catalogue_bridge.ts, and like it
// never throws -- a failure here must degrade to a stated "couldn't read",
// never take the scan result off the screen.
import { collectStorefrontQuery, collectProductSitemapCount } from "./storefront";
import { DIGEST_EDGES_QUERY, BEST_SELLERS_QUERY, EXPORT_PAGE_QUERY } from "./storefront_queries";
import { adaptStorefrontProduct } from "./storefront_adapter";
import { resolveStorefrontVersions } from "./storefront_versions";
import { EXPORT_CEILING, EXPORT_MAX_PAGES } from "./export_limits";
import type { CatalogueDigest, CatalogueProduct, CatalogueEntry, ExportWalk } from "./catalogue_types";

// count is null, not 0, for the same reason `variants` is: we did not read the
// catalogue, so we know nothing about its size. Nothing renders a count for an
// unavailable digest, but the value should not be a number we cannot back.
const UNREADABLE: CatalogueDigest = {
  available: false, reason: "unreadable", count: null, variants: null, priceMin: null,
  priceMax: null, newest: null, currency: null, index: [],
};

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await globalThis.chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function inject<T>(func: (...args: any[]) => Promise<T>, args: unknown[]): Promise<T | null> {
  const tabId = await activeTabId();
  if (tabId === undefined) return null;
  const [injection] = await globalThis.chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN", func, args,
  });
  return (injection?.result as T) ?? null;
}

const num = (value: unknown): number | null => {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
};

export async function fetchStorefrontDigest(): Promise<CatalogueDigest> {
  try {
    const versions = await resolveStorefrontVersions();
    const count = await inject(collectProductSitemapCount, []);
    const edges = (await inject(collectStorefrontQuery, [versions, DIGEST_EDGES_QUERY])) as any;

    // The API answering is what proves this store has a readable catalogue. The
    // sitemap is only where the count comes from, so losing it costs the count,
    // not the section.
    if (!edges) return UNREADABLE;

    const min = edges.cheapest?.nodes?.[0]?.priceRange?.minVariantPrice;
    const max = edges.priciest?.nodes?.[0]?.priceRange?.maxVariantPrice;

    return {
      available: true,
      reason: null,
      // null, never 0: a sitemap we could not read leaves the size unknown, and
      // "0 products" beside a working Export button is a false statement about
      // the merchant's store rather than a missing one. Same rule as `variants`.
      count,
      // The export walks at most EXPORT_CEILING products, so a catalogue larger
      // than that comes back truncated -- and ProductSummary's disclosure line
      // keys on this flag, which is why the Storefront path has to set it too.
      // Necessarily false when the count is unknown: we cannot claim a
      // catalogue exceeds a ceiling we never measured it against.
      capped: count !== null && count > EXPORT_CEILING,
      // Not obtainable cheaply from this API. null, never 0 -- see catalogue_types.
      variants: null,
      priceMin: num(min?.amount),
      priceMax: num(max?.amount),
      newest: edges.newest?.nodes?.[0]?.createdAt ?? null,
      // A fix, not a port: window.Shopify is absent on headless storefronts, so
      // those stores render bare numbers on the /products.json path.
      currency: min?.currencyCode ?? null,
      index: [],
    };
  } catch {
    return UNREADABLE;
  }
}

export async function fetchStorefrontBestSellers(limit: number): Promise<CatalogueEntry[]> {
  try {
    const versions = await resolveStorefrontVersions();
    const data = (await inject(collectStorefrontQuery, [versions, BEST_SELLERS_QUERY(limit)])) as any;
    const nodes = data?.products?.nodes;
    if (!Array.isArray(nodes)) return [];
    return nodes.map((n: any) => ({
      handle: n.handle,
      title: n.title ?? n.handle,
      price: n.priceRange?.minVariantPrice?.amount ?? null,
    }));
  } catch {
    return [];
  }
}

export async function fetchStorefrontExport(
  onProgress: (done: number) => void,
): Promise<ExportWalk | null> {
  try {
    const versions = await resolveStorefrontVersions();
    const products: CatalogueProduct[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < EXPORT_MAX_PAGES; page++) {
      const data = (await inject(collectStorefrontQuery, [versions, EXPORT_PAGE_QUERY(cursor)])) as any;
      // A failure on the first page means no export at all; later, keep what we
      // have rather than discarding minutes of work -- but say that the file is
      // short, which is what `truncated` is for.
      if (!data?.products) return page === 0 ? null : { products, truncated: true };

      for (const node of data.products.nodes ?? []) products.push(adaptStorefrontProduct(node));
      onProgress(products.length);

      // The store saying there is no next page is the only thing that makes
      // this file the whole catalogue. Every other exit -- the page ceiling
      // below, a missing cursor, a read that died -- leaves products behind,
      // and a file that leaves products behind has to admit it.
      if (!data.products.pageInfo?.hasNextPage) return { products, truncated: false };
      cursor = data.products.pageInfo.endCursor ?? null;
      if (!cursor) break;
    }
    return { products, truncated: true };
  } catch {
    return null;
  }
}
