import { i18n } from "#i18n";

// The server's category taxonomy, mirrored here the way scripts/shots.py
// mirrors ShotSelection::FRAMES: the panel needs a LOCALIZED heading and the
// detect API sends only the English name alongside the slug.
//
// Kept as an explicit map rather than deriving the key from the slug at call
// time (`categories.${slug}`), for two reasons. The key has to be camelCase
// because Chrome message names cannot contain a hyphen, so a derived key would
// need a transform that silently produces a name no locale file defines. And a
// derived key is an unchecked string: i18n.t() throws on an unknown message in
// test/setup.ts, so a category the server adds later would turn a real panel
// render into a failing test rather than a missing label. Looking the slug up
// here first means an unknown category never reaches i18n.t() at all.
const CATEGORY_MESSAGES = {
  "email-sms": "categories.emailSms",
  "page-builder": "categories.pageBuilder",
  reviews: "categories.reviews",
  upsell: "categories.upsell",
  subscriptions: "categories.subscriptions",
  sales: "categories.sales",
  marketing: "categories.marketing",
  "store-design": "categories.storeDesign",
  "customer-service": "categories.customerService",
  "social-media": "categories.socialMedia",
  analytics: "categories.analytics",
  advertising: "categories.advertising",
  discounts: "categories.discounts",
  payments: "categories.payments",
  "shipping-delivery": "categories.shippingDelivery",
  orders: "categories.orders",
  "product-management": "categories.productManagement",
  "search-navigation": "categories.searchNavigation",
  localization: "categories.localization",
  loyalty: "categories.loyalty",
  "trust-security": "categories.trustSecurity",
  "privacy-compliance": "categories.privacyCompliance",
  dropshipping: "categories.dropshipping",
  seo: "categories.seo",
  "store-management": "categories.storeManagement",
  performance: "categories.performance",
  accessibility: "categories.accessibility",
} as const;

export type KnownCategorySlug = keyof typeof CATEGORY_MESSAGES;

export const CATEGORY_SLUGS = Object.keys(CATEGORY_MESSAGES) as KnownCategorySlug[];

/** The localized heading for a category, falling back to the server's English
 *  name for a slug this build does not know. */
export function categoryLabel(slug: string, serverName: string): string {
  const key = CATEGORY_MESSAGES[slug as KnownCategorySlug];
  return key ? i18n.t(key) : serverName;
}
