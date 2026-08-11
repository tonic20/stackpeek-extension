// The shape /products.json actually returns, narrowed to what we read.
// Verified against a live storefront on 2026-08-02: the feed carries no
// currency, no barcode and no inventory fields, which is why the CSV leaves
// those columns blank.
export interface CatalogueVariant {
  sku?: string | null;
  price?: string | null;
  compare_at_price?: string | null;
  grams?: number | null;
  requires_shipping?: boolean;
  taxable?: boolean;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
}

export interface CatalogueImage {
  src?: string | null;
  position?: number | null;
  alt?: string | null;
}

export interface CatalogueProduct {
  handle: string;
  title?: string | null;
  body_html?: string | null;
  vendor?: string | null;
  product_type?: string | null;
  tags?: string[];
  published_at?: string | null;
  created_at?: string | null;
  options?: { name?: string }[];
  variants?: CatalogueVariant[];
  images?: CatalogueImage[];
  // Only the Storefront API carries these; /products.json does not, so they stay
  // undefined on that path and csv.ts writes blanks exactly as it always has.
  seo_title?: string | null;
  seo_description?: string | null;
}

// One entry per product: enough to render a rank row, and nothing else.
// ~70 bytes each, so ~87 KB for a 1,240-product store against ~5 MB for the
// raw feed. See CatalogueDigest below for why this exists at all.
export interface CatalogueEntry {
  handle: string;
  title: string;
  price: string | null;
}

// What the in-page digest returns. The raw feed never crosses into the panel
// (design D5) -- but the compact index does, because the best-seller ranking is
// computed panel-side and needs something to join against.
//
// The ranking cannot be computed in the page: chrome.scripting serialises the
// injected function's own source and nothing else, so it cannot call the
// extraction helpers, and duplicating them inline would put the one piece of
// logic this feature's honesty depends on in two places. Moving the join to the
// panel costs ~87 KB on a large store and buys a single tested implementation.
export interface CatalogueDigest {
  available: boolean;      // false when the feed is 404, blocked or absent
  // Why `available` is false. "not_public" means the store answered and has no
  // public feed; "unreadable" means we never got an answer -- a throw, an
  // injection refusal, a dropped tab. The panel must not report the second as
  // the first: that states a fact about the merchant's store on no evidence.
  // null when available is true.
  reason: "not_public" | "unreadable" | null;
  // null where the size could not be read even though the catalogue could -- the
  // Storefront path takes its count from /sitemap.xml, and a 403 there costs the
  // count, not the section. Rendering 0 would state a fact about the merchant's
  // store on no evidence, the same error as reporting a failed read as "not
  // public". ProductSummary shows no count at all for null, exactly as it shows
  // an em dash for a null `variants`.
  count: number | null;
  // null where the source cannot answer cheaply -- the Storefront API exposes no
  // variant total, and rendering 0 would be a false statement about the store
  // rather than a missing one. ProductSummary shows an em dash for null.
  variants: number | null;
  priceMin: number | null;
  priceMax: number | null;
  newest: string | null;   // ISO date of the most recent created_at
  currency: string | null; // from window.Shopify; null renders no symbol
  index: CatalogueEntry[];
  // True when the export cannot reach the whole catalogue: on the
  // /products.json path because the 40-page walk ran out of pages rather than
  // products, so `count` is a floor; on the Storefront path because the sitemap
  // count is above the same 40 x 250 ceiling. Never true when `count` is null --
  // a ceiling cannot be exceeded by a size that was never read.
  capped?: boolean;
}

// The two collection-page bodies, fetched in the page and ranked in the panel.
export interface CollectionPages {
  bestSelling: string;
  alphabetical: string;
}

// The export's state machine, shared by App and ProductSummary. Declared here
// rather than exported from the component: a type exported from a Svelte
// instance script is not importable.
export type ExportState = "idle" | "fetching" | "done" | "error";
