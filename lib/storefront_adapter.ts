// Maps a Storefront API product node onto the /products.json shape the rest of
// the catalogue code already speaks. Everything downstream -- csv.ts,
// rankCatalogue, the digest arithmetic -- is therefore untouched by the
// existence of a second source.
//
// Panel-side on purpose. The fetchers that call the API are injected into the
// page and cannot reference imports (see lib/catalogue.ts:5), so they return
// raw bodies and the mapping happens here, where it is ordinary testable code.
import type { CatalogueProduct, CatalogueVariant, CatalogueImage } from "./catalogue_types";

const GRAMS_PER: Record<string, number> = {
  GRAMS: 1, KILOGRAMS: 1000, POUNDS: 453.592, OUNCES: 28.3495,
};

// Null rather than a guess: a wrong weight is worse than a blank one, and the
// CSV already leaves columns the feed cannot answer empty.
export function toGrams(weight: number | null | undefined, unit: string | null | undefined): number | null {
  if (typeof weight !== "number" || !Number.isFinite(weight)) return null;
  const factor = unit ? GRAMS_PER[unit] : undefined;
  return factor === undefined ? null : weight * factor;
}

interface StorefrontVariantNode {
  sku?: string | null;
  weight?: number | null;
  weightUnit?: string | null;
  requiresShipping?: boolean;
  taxable?: boolean;
  selectedOptions?: { name?: string; value?: string }[];
  price?: { amount?: string; currencyCode?: string } | null;
  compareAtPrice?: { amount?: string } | null;
}

export interface StorefrontNode {
  handle: string;
  title?: string | null;
  descriptionHtml?: string | null;
  vendor?: string | null;
  productType?: string | null;
  tags?: string[];
  publishedAt?: string | null;
  createdAt?: string | null;
  seo?: { title?: string | null; description?: string | null } | null;
  options?: { name?: string }[];
  images?: { nodes?: { url?: string; altText?: string | null }[] };
  variants?: { nodes?: StorefrontVariantNode[] };
}

export function adaptStorefrontProduct(node: StorefrontNode): CatalogueProduct {
  // Array.isArray guards a malformed network response (a truncated body, a
  // proxy that reshapes JSON, etc.) -- same threat model as the options guard
  // below. This one also protects fetchStorefrontExport's partial-results
  // path: a .map on a non-array would throw mid-page and discard every
  // earlier page's already-collected products, not just this one.
  const imageNodes = Array.isArray(node.images?.nodes) ? node.images!.nodes! : [];
  const images: CatalogueImage[] = imageNodes.map((img, i) => ({
    src: img.url ?? null, alt: img.altText ?? null, position: i + 1,
  }));

  const variantNodes = Array.isArray(node.variants?.nodes) ? node.variants!.nodes! : [];
  const variants: CatalogueVariant[] = variantNodes.map((v) => {
    // selectedOptions is ordered to match the product's own options list, which
    // is what option1/2/3 mean in Shopify's import format.
    const opts = v.selectedOptions ?? [];
    return {
      sku: v.sku ?? null,
      price: v.price?.amount ?? null,
      compare_at_price: v.compareAtPrice?.amount ?? null,
      grams: toGrams(v.weight, v.weightUnit),
      requires_shipping: v.requiresShipping ?? true,
      taxable: v.taxable ?? true,
      option1: opts[0]?.value ?? null,
      option2: opts[1]?.value ?? null,
      option3: opts[2]?.value ?? null,
    };
  });

  return {
    handle: node.handle,
    title: node.title ?? null,
    body_html: node.descriptionHtml ?? null,
    vendor: node.vendor ?? null,
    product_type: node.productType ?? null,
    tags: node.tags ?? [],
    published_at: node.publishedAt ?? null,
    created_at: node.createdAt ?? null,
    // Array.isArray guards a malformed network response (a truncated body, a
    // proxy that reshapes JSON, etc.) -- a correctly-typed StorefrontNode
    // always has options as an array, so this is defensive, not a fixture
    // workaround.
    options: Array.isArray(node.options) ? node.options.map((o) => ({ name: o.name })) : [],
    variants,
    images,
    seo_title: node.seo?.title ?? null,
    seo_description: node.seo?.description ?? null,
  };
}
