import type { CatalogueDigest, CatalogueProduct, CollectionPages } from "./catalogue_types";

// Injected into the page's MAIN world, so EVERY function here must be entirely
// self-contained: chrome.scripting serialises the function's own source and
// nothing else. No imports may be referenced at runtime (the type import above
// is erased at compile time). Same constraint and same shape as lib/collector.ts,
// which declares its one helper inline for this reason -- and which is still
// directly unit-testable because of it.
//
// This is also why the best-seller ranking is NOT computed here: it needs the
// extraction helpers, which cannot come along. The page fetches the two
// collection bodies below and the panel ranks them.

export async function collectCataloguePage(page: number): Promise<CatalogueProduct[] | null> {
  try {
    const res = await fetch(`/products.json?limit=250&page=${page}`, { credentials: "omit" });
    if (!res.ok) return null;
    return (await res.json()).products ?? [];
  } catch {
    // Some storefronts refuse programmatic fetch from their own page context
    // (measured on us.gymshark.com). Indistinguishable from a 404 here, and it
    // means the same thing to the panel: the catalogue is not readable.
    return null;
  }
}

export async function collectCatalogueDigest(bestSellerLimit: number): Promise<CatalogueDigest> {
  // Declared HERE, not at module scope. A module-level constant is not part of
  // this function's source and so does not survive injection -- referencing one
  // threw a ReferenceError in the page, was swallowed by the catch below, and
  // reported every store's catalogue as "not public". test/injection_safety
  // now pins this for every injected function.
  const PAGE_SIZE = 250;

  const unusable = (reason: "not_public" | "unreadable"): CatalogueDigest => ({
    available: false, reason, count: 0, variants: 0, priceMin: null, priceMax: null,
    newest: null, currency: null, index: [],
  });

  const products: CatalogueProduct[] = [];
  let capped = false;
  for (let page = 1; page <= 40; page++) {
    let batch: CatalogueProduct[];
    try {
      const res = await fetch(`/products.json?limit=${PAGE_SIZE}&page=${page}`, { credentials: "omit" });
      // A response, even a refusal, is the store answering: there is no public feed.
      if (!res.ok) return page === 1 ? unusable("not_public") : finish();
      batch = (await res.json()).products ?? [];
    } catch {
      // No response at all -- we cannot say anything about the store.
      return page === 1 ? unusable("unreadable") : finish();
    }
    products.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    if (page === 40) capped = true;
  }

  return finish();

  function finish(): CatalogueDigest {
    let variants = 0, priceMin: number | null = null, priceMax: number | null = null;
    let newest: string | null = null;

    for (const p of products) {
      for (const v of p.variants ?? []) {
        variants++;
        const price = Number.parseFloat(String(v.price ?? ""));
        if (Number.isFinite(price)) {
          if (priceMin === null || price < priceMin) priceMin = price;
          if (priceMax === null || price > priceMax) priceMax = price;
        }
      }
      if (p.created_at && (newest === null || p.created_at > newest)) newest = p.created_at;
    }

    // The feed carries no currency (verified 2026-08-02). window.Shopify does on
    // an ordinary storefront; where it does not, the panel renders bare numbers
    // rather than assuming a symbol.
    const currency = (window as any).Shopify?.currency?.active ?? null;

    return {
      available: true, reason: null, count: products.length, variants, priceMin, priceMax, newest, currency,
      index: products.map((p) => ({
        handle: p.handle,
        title: p.title ?? p.handle,
        price: p.variants?.[0]?.price ?? null,
      })),
      capped,
    };
  }
}

// The two collection-page bodies the ranking is derived from. Fetched here
// because only the page is same-origin with the storefront; ranked in the panel,
// because the extraction helpers cannot be injected (see the note at the top).
//
// &view=json costs nothing: Shopify serves the default template when that view
// does not exist, so each response is either structured JSON or exactly the HTML
// the parser wants (design D2).
export async function collectCollectionPages(): Promise<CollectionPages | null> {
  try {
    const get = async (sort: string) => {
      const res = await fetch(`/collections/all?sort_by=${sort}&view=json`, { credentials: "omit" });
      if (!res.ok) throw new Error(String(res.status));
      return res.text();
    };
    return { bestSelling: await get("best-selling"), alphabetical: await get("title-ascending") };
  } catch {
    return null;
  }
}
