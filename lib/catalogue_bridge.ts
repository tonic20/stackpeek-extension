import { collectCatalogueDigest, collectCataloguePage, collectCollectionPages } from "./catalogue";
import type { CatalogueDigest, CatalogueProduct, CollectionPages } from "./catalogue_types";

// How many ranks the panel keeps. 25 is the expanded size of the best-sellers
// list (design D13); more would be data we cannot show.
export const BEST_SELLER_LIMIT = 25;

const UNAVAILABLE: CatalogueDigest = {
  available: false, count: 0, variants: 0, priceMin: null, priceMax: null,
  newest: null, currency: null, index: [],
};

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await globalThis.chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

// Deliberately never throws. The catalogue is secondary to the scan: a result is
// already on screen, and a failure here must degrade to "not available" rather
// than take that result away. This is why it does not classify an injection
// refusal the way collect_bridge does.
export async function fetchCatalogueDigest(): Promise<CatalogueDigest> {
  try {
    const tabId = await activeTabId();
    if (tabId === undefined) return UNAVAILABLE;
    const [injection] = await globalThis.chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: collectCatalogueDigest,
      args: [BEST_SELLER_LIMIT],
    });
    return (injection?.result as CatalogueDigest) ?? UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

export async function fetchCataloguePage(page: number): Promise<CatalogueProduct[] | null> {
  try {
    const tabId = await activeTabId();
    if (tabId === undefined) return null;
    const [injection] = await globalThis.chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: collectCataloguePage,
      args: [page],
    });
    return (injection?.result as CatalogueProduct[] | null) ?? null;
  } catch {
    return null;
  }
}

// Null means the collection page could not be read, which costs the ranking and
// never the summary.
export async function fetchCollectionPages(): Promise<CollectionPages | null> {
  try {
    const tabId = await activeTabId();
    if (tabId === undefined) return null;
    const [injection] = await globalThis.chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: collectCollectionPages,
    });
    return (injection?.result as CollectionPages | null) ?? null;
  } catch {
    return null;
  }
}
