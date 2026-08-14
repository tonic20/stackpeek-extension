// The arguments passed to the injected collectors, shared by everything that
// injects them — the extension's own bridges (chrome.scripting.executeScript)
// and the crawler's Playwright driver (page.evaluate).
//
// They live apart from those bridges deliberately. Both constants used to sit
// at the top of collect_bridge.ts and catalogue_bridge.ts, which is a fine
// place for the extension but meant that anything else wanting the wait budget
// had to import a module built on `chrome.scripting`. The crawler does want it,
// runs under Node where `chrome` does not exist, and would otherwise pull the
// whole chrome API surface into its type-check to learn that a timeout is 1500
// milliseconds.
//
// Nothing here may import anything: this module is the leaf both sides depend
// on, and a dependency of its own would defeat the point.

// How long collectSignals waits in-page for window.Shopify to appear before
// giving up and reporting what it can see. The wait that actually matters on a
// storefront — which is why navigation does not additionally wait for `load`.
export const SHOPIFY_WAIT_MS = 1500;

// How many ranked best sellers a catalogue digest carries back.
export const BEST_SELLER_LIMIT = 25;
