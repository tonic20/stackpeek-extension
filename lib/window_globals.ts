// Static list of window global names the collector probes for on a page.
//
// This used to be the whole probe list; it is now the *floor*. As of issue
// #21 phase 1, lib/window_globals_config.ts fetches the live, corpus-derived
// list from Api::V1::ConfigController and unions it with this constant, so
// the backend can add newly-discovered probe names without an extension
// release. This constant still matters on its own: it's what collection
// falls back to whenever /config is unreachable, slow, or returns something
// malformed, and it's a floor the fetched list can only add to, never
// shrink — see resolveProbeList's doc comment for why replacement was
// rejected.
//
// Seeded from the brief's known-good starter list, then reconciled against
// the backend seed with:
//   python3 -c "import json;print(sorted({g for a in json.load(open('data/extracted/fingerprints.json'))['apps'] for g in a['window_globals']}))"
// run from the repo root. That one-off reconciliation is now superseded by
// /config for ongoing drift — this list no longer needs to be hand-synced
// against the corpus to stay useful, only to stay a reasonable fallback.
export const WINDOW_GLOBALS: readonly string[] = Object.freeze([
  "$crisp",
  "BIS",
  "Beacon",
  "Chatra",
  "Cookiebot",
  "ElevarDataLayer",
  "GorgiasChat",
  "Intercom",
  "LimeSpot",
  "LittledataLayer",
  "LiveChatWidget",
  "Northbeam",
  "OneTrust",
  "Privy",
  "Rebuy",
  "Shopify",
  "ShopifyChat",
  "SmileUI",
  "StampedFn",
  "SwymRelay",
  "Tawk_API",
  "Tidio",
  "TriplePixel",
  "Weglot",
  "__PF__",
  "_dcq",
  "_learnq",
  "_loq",
  "algoliasearch",
  "attentive",
  "dataLayer",
  "fbq",
  "gtag",
  "jdgm",
  "klaviyo",
  "klevu",
  "langify",
  "loox",
  "loyaltylion",
  "nostojs",
  "okeWidgetApi",
  "omnisend",
  "snaptr",
  "tidioChatApi",
  "ttq",
  "wisepops",
  "yotpo",
  "zE",
]);
