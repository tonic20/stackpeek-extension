// How far an export reaches, in one place.
//
// Both walks stop at the same point -- /products.json in App.svelte and the
// Storefront API in storefront_bridge.ts -- and four separate things state that
// ceiling: the two loops, the disclosure line beside the count, the progress
// denominator, and the name of a truncated file. Every one of them was its own
// literal until a 10,000-product export of a 42,098-product store came out as a
// 75,530-row CSV and read as no ceiling at all. Numbers that must agree do not
// get written down twice.

// Shopify caps a page at 250 on both feeds we read: /products.json's `limit`
// and the Storefront API's `first`. One number, because it is one cap.
export const EXPORT_PAGE_SIZE = 250;

export const EXPORT_MAX_PAGES = 40;

// Derived, never written out again: the ceiling IS the walk's reach.
export const EXPORT_CEILING = EXPORT_MAX_PAGES * EXPORT_PAGE_SIZE;
