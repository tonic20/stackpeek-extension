// Pure, self-contained: safe to inject into a page's MAIN world OR run under jsdom.
export interface CollectedSignals {
  shopify: unknown;
  script_urls: string[];
  window_globals: string[];
  meta_tags: string[];
}

export async function collectSignals(
  globalsList: readonly string[],
  waitMs: number,
): Promise<CollectedSignals> {
  // Strips the query string and fragment off a same-origin URL before it is
  // recorded -- a page's own <link rel="canonical"> or paginated asset href
  // resolves to an absolute URL via .src/.href, and on a search or paginated
  // page that carries ?q=..., ?page=..., a discount code, or a cart token in
  // the query string. None of that belongs on the wire.
  //
  // The path is deliberately kept, for both same- and third-party URLs: some
  // fingerprints in the backend's corpus (e.g. Appikon Back In Stock's
  // "/assets/subscribe-it.js", FireApps Ali Reviews' "/widget/review-widget")
  // have no host component at all, which only makes sense if they are meant
  // to match a script the merchant's own theme serves on the merchant's own
  // (necessarily store-specific) origin -- see the investigation note in the
  // commit this landed in. Collapsing a same-origin URL down to a bare origin
  // would silently blind those fingerprints, so this stops at query+fragment.
  //
  // Third-party URLs (including cdn.shopify.com, which is NOT this page's
  // origin even for the store's own assets) are left completely untouched --
  // the backend matches app/pixel signatures against their full path, and
  // truncating any part of them would break detection outright.
  //
  // Two non-http(s) schemes worth calling out explicitly, since they look
  // similar but are not: a data: URL has no origin at all (the URL spec
  // gives it a fresh, unique opaque origin), so its .origin is never
  // location.origin and it always lands in the "third-party, untouched"
  // case above. A blob: URL is not the same -- its .origin is the origin of
  // whatever context created it, so a blob created by this page has .origin
  // === location.origin and DOES run through the same-origin branch below.
  // That's invisible in practice, not because blob URLs are exempt like
  // data: URLs are, but because the object URLs Chrome hands out
  // (blob:https://store.example/<uuid>) have no query string or fragment
  // for that branch to strip.
  function addUrl(set: Set<string>, url: string) {
    try {
      const u = new URL(url);
      if (u.origin === location.origin) {
        u.search = "";
        u.hash = "";
      }
      set.add(u.href);
    } catch { /* ignore relative/invalid */ }
  }

  // rel values that describe the CURRENT page's own identity or its position
  // in a navigation sequence, never a third-party app fingerprint: canonical
  // and shortlink both restate this page's own path (a same-origin canonical
  // literally IS the page path -- /products/blue-shirt, /search -- and a
  // cross-origin one is exactly the same disclosure via a different host);
  // next/prev are pagination; amphtml points at this page's own AMP twin;
  // alternate (bare) points at another representation of this same page
  // (a translation, an RSS feed). None of backend/db/fingerprints.json's
  // url_patterns reference any of these tokens, and detection_service.rb has
  // no rel-aware logic at all -- confirmed by grepping both before adding
  // this list, not assumed.
  //
  // "alternate stylesheet" is a real second-CSS-file resource (a spec-defined
  // combination, not "alternate" plus noise) and must NOT be caught by this:
  // any link carrying the "stylesheet" token stays in, regardless of what
  // else rel says, because that is where CDN signal lives.
  const NAVIGATION_LINK_RELS = new Set(["canonical", "next", "prev", "alternate", "shortlink", "amphtml"]);
  function isNavigationLink(relAttr: string | null): boolean {
    const tokens = (relAttr || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (tokens.includes("stylesheet")) return false;
    return tokens.some((t) => NAVIGATION_LINK_RELS.has(t));
  }

  // Injected with injectImmediately, this can run at document_start — ahead of
  // the inline script that defines window.Shopify. Collecting right then would
  // report a Shopify store as "Not a Shopify store", which is a worse failure
  // than being slow. Wait for whichever comes first: Shopify appearing, the
  // parser finishing, or the cap. Everything here is inline because Chrome
  // injects only this function's own source.
  const deadline = Date.now() + waitMs;
  while (
    typeof (window as any).Shopify === "undefined" &&
    document.readyState === "loading" &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const urls = new Set<string>();
  document.querySelectorAll("script[src]").forEach((s) => addUrl(urls, (s as HTMLScriptElement).src));
  document.querySelectorAll("link[href]").forEach((l) => {
    if (isNavigationLink(l.getAttribute("rel"))) return;
    addUrl(urls, (l as HTMLLinkElement).href);
  });

  const window_globals = (globalsList || []).filter((name) => typeof (window as any)[name] !== "undefined");

  const meta_tags = Array.from(document.querySelectorAll("meta[name]"))
    .map((m) => m.getAttribute("name"))
    .filter((n): n is string => !!n && n.startsWith("shopify-"));

  const S = (window as any).Shopify;
  const shopify = S ? { shop: S.shop || null, theme: S.theme || null } : null;

  return { shopify, script_urls: [...urls], window_globals, meta_tags };
}
