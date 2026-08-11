// The three Storefront API documents. Kept apart from lib/storefront.ts so they
// can be asserted without a network, and so the measurements behind their shape
// live next to them.

// Everything the digest needs except the count, in one document: the cheapest
// and priciest product (sortKey PRICE, both directions) and the newest. Each
// costs 5 points and answers in under a second, where deriving the same range by
// walking the catalogue measured ~2.7 minutes. The count comes from the sitemap.
export const DIGEST_EDGES_QUERY = `{
  cheapest: products(first: 1, sortKey: PRICE) {
    nodes { priceRange { minVariantPrice { amount currencyCode } } }
  }
  priciest: products(first: 1, sortKey: PRICE, reverse: true) {
    nodes { priceRange { maxVariantPrice { amount currencyCode } } }
  }
  newest: products(first: 1, sortKey: CREATED_AT, reverse: true) {
    nodes { createdAt }
  }
}`;

// Shopify's own ranking, which is better evidence than the collection-order
// inference the /products.json path has to fall back on. Cost 10.
export const BEST_SELLERS_QUERY = (limit: number): string => `{
  products(first: ${limit}, sortKey: BEST_SELLING) {
    nodes { handle title priceRange { minVariantPrice { amount } } }
  }
}`;

// Measured 2026-08-11: at first:250 with both nested connections also at 250,
// one page costs 661 points and returns in ~3s. Reducing the nested sizes to 25
// and 10 only drops the cost to 364 while risking truncated variants, so there is
// no reason to ask for less.
//
// Exported because storefront_bridge derives the export's product ceiling from
// it (pages x page size). One number, in one place -- a second literal is how a
// ceiling and the sentence disclosing it drift apart.
export const EXPORT_PAGE_SIZE = 250;

export const EXPORT_PAGE_QUERY = (cursor: string | null): string => `{
  products(first: ${EXPORT_PAGE_SIZE}${cursor ? `, after: "${cursor}"` : ""}) {
    pageInfo { hasNextPage endCursor }
    nodes {
      handle title descriptionHtml vendor productType tags publishedAt createdAt
      seo { title description }
      options { name }
      images(first: 250) { nodes { url altText } }
      variants(first: 250) {
        nodes {
          sku weight weightUnit requiresShipping taxable
          selectedOptions { name value }
          price { amount currencyCode }
          compareAtPrice { amount }
        }
      }
    }
  }
}`;
