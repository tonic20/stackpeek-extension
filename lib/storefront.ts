// Injected into the page's MAIN world, so EVERY function here must be entirely
// self-contained -- chrome.scripting serialises the function's own source and
// nothing else. Same constraint as lib/collector.ts and lib/catalogue.ts; each
// helper is declared INSIDE the function that needs it for that reason, and
// test/injection_safety.test.ts pins it.
//
// These functions map nothing. They return raw bodies and
// lib/storefront_adapter.ts does the mapping panel-side, where imports work.

// Shopify serves the Storefront API on the shop's own origin, so this is a
// same-origin request: no CORS, no token, no host permission. Verified against
// five Shopify-hosted stores on 2026-08-11. A store whose front end is not
// Shopify-hosted (measured: www.gymshark.com) 404s every version, which is the
// null return.
export async function collectStorefrontQuery(versions: string[], query: string): Promise<unknown | null> {
  for (const version of versions) {
    try {
      const res = await fetch(`/api/${version}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        credentials: "omit",
      });
      if (!res.ok) continue;
      const body = await res.json();
      // A GraphQL failure is a 200 carrying `errors`. Treat it as no answer
      // rather than letting an undefined `data` flow onward as if it were one.
      if (body && !body.errors && body.data) return body.data;
    } catch {
      // Try the next version: a throw here is indistinguishable from a refusal.
    }
  }
  return null;
}

// The exact catalogue size in one request, which pagination cannot give cheaply
// -- the Storefront API exposes no total count, so counting by traversal costs
// minutes on a large store (measured: ~2.7 min).
//
// Counts by regex rather than parsing: a real product sitemap ran to 4.2 MB and
// 41,762 entries (www.fashionnova.com), and building a DOM of that is waste when
// the answer is the number of matches.
export async function collectProductSitemapCount(): Promise<number | null> {
  try {
    const index = await fetch("/sitemap.xml", { credentials: "omit" });
    if (!index.ok) return null;
    const indexXml = await index.text();

    // The filename is not fixed: Hydrogen serves /sitemap/products.xml while
    // Liquid serves /sitemap_products_1.xml, so follow the index rather than
    // guessing a path.
    const locs = indexXml.match(/<loc>([^<]+)<\/loc>/g) ?? [];
    const productMaps = locs
      .map((l) => l.replace(/<\/?loc>/g, ""))
      .filter((l) => /product/i.test(l));
    if (productMaps.length === 0) return null;

    let total = 0;
    for (const url of productMaps) {
      const res = await fetch(url, { credentials: "omit" });
      if (!res.ok) return null;
      const xml = await res.text();
      total += (xml.match(/<loc>[^<]*\/products\/[^<]*<\/loc>/g) ?? []).length;
    }
    return total;
  } catch {
    return null;
  }
}
