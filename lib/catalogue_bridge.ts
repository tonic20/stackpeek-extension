import { browser } from "wxt/browser";
import { collectCatalogueDigest, collectCataloguePage, collectCollectionPages } from "./catalogue";
import type { CatalogueDigest, CatalogueProduct, CollectionPages } from "./catalogue_types";

// How many ranks the panel keeps. 25 is the expanded size of the best-sellers
// list (design D13); more would be data we cannot show.
import { BEST_SELLER_LIMIT } from "./injection_args";
export { BEST_SELLER_LIMIT };

// Every failure path here is a failure to READ, never evidence about the store:
// no tab, a refused injection, a thrown executeScript. Reporting these as
// "not public" would state a fact about the merchant on no evidence.
const UNREADABLE: CatalogueDigest = {
  available: false, reason: "unreadable", count: 0, variants: 0, priceMin: null,
  priceMax: null, newest: null, currency: null, index: [],
};

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

// Deliberately never throws. The catalogue is secondary to the scan: a result is
// already on screen, and a failure here must degrade to "not available" rather
// than take that result away. This is why it does not classify an injection
// refusal the way collect_bridge does.
export async function fetchCatalogueDigest(): Promise<CatalogueDigest> {
  try {
    const tabId = await activeTabId();
    if (tabId === undefined) return UNREADABLE;
    const [injection] = await browser.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: collectCatalogueDigest,
      args: [BEST_SELLER_LIMIT],
    });
    return (injection?.result as CatalogueDigest) ?? UNREADABLE;
  } catch {
    return UNREADABLE;
  }
}

export async function fetchCataloguePage(page: number): Promise<CatalogueProduct[] | null> {
  try {
    const tabId = await activeTabId();
    if (tabId === undefined) return null;
    const [injection] = await browser.scripting.executeScript({
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
    const [injection] = await browser.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: collectCollectionPages,
    });
    return (injection?.result as CollectionPages | null) ?? null;
  } catch {
    return null;
  }
}
