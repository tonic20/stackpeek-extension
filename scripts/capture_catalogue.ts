// Fills in the `catalogue` key of backend/db/demo_stores.json for every domain
// in backend/db/demo_store_domains.txt.
//
// It imports the extension's OWN collectCatalogueDigest and rankCatalogue
// rather than reimplementing them. Those are written for injection into a page,
// so they fetch relative URLs and read window.Shopify; the harness below
// supplies exactly those two things per store. A Node reimplementation would
// put the ranking logic -- the one piece of logic this feature's honesty rests
// on -- in two languages, which is the drift this whole feature exists to
// reduce. CORS does not apply outside a browser, so Node can fetch directly.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { collectCatalogueDigest, collectCollectionPages } from "../lib/catalogue";
import { rankCatalogue } from "../lib/ranking";
import { BEST_SELLER_LIMIT } from "../lib/catalogue_bridge";
import type { CatalogueDigest, CatalogueEntry } from "../lib/catalogue_types";

export interface CatalogueSnapshot {
  available: boolean;
  // Both widened to match CatalogueDigest: this script only ever captures the
  // /products.json path today, which always computes a real count and a real
  // variant total, but the shared type is honest about the source rather than
  // assuming which one fed it. The Storefront path can answer "readable
  // catalogue, unknown size" and a snapshot must be able to carry that.
  count: number | null;
  variants: number | null;
  price_min: number | null;
  price_max: number | null;
  newest: string | null;
  currency: string | null;
  // True when `count` is the store's real total but the reader can only export
  // the first 10,000 of it. The panel has to say so beside the number, exactly
  // as ProductSummary.svelte does, or the export truncates in silence.
  capped: boolean;
  best_sellers: { handle: string; title: string; price: string | null }[];
}

// snake_case because the consumer is a Rails jsonb column read straight into
// ERB. The digest's `index` is deliberately dropped: it exists only so the
// ranking can be joined against it, and it is ~87 KB on a large store -- in a
// committed seed file that would dwarf everything else.
export function toSnapshot(digest: CatalogueDigest, ranks: CatalogueEntry[]): CatalogueSnapshot {
  return {
    available: digest.available,
    count: digest.count,
    variants: digest.variants,
    price_min: digest.priceMin,
    price_max: digest.priceMax,
    newest: digest.newest,
    currency: digest.currency,
    // Optional on the digest (the /products.json walk sets it, the Storefront
    // path may not), required here: a JSON seed read straight into ERB should
    // not make the view distinguish false from absent.
    capped: digest.capped === true,
    best_sellers: ranks.map((r) => ({ handle: r.handle, title: r.title, price: r.price })),
  };
}

// Resolved from the working directory, not from import.meta.url: `npm run
// capture:catalogue` bundles this into scripts/.build/ first, so the module's
// own path is one level deeper at runtime than in source. npm always runs a
// script from the package root, which makes cwd the stable anchor.
//
// ROOT is the stackpeek monorepo, one level above this package. This is a
// monorepo maintenance script and cannot run from the standalone extension
// repository, which mirrors extension/ alone and has no backend/ beside it.
// No guard, because there is nothing to degrade to -- only an error that says
// so, since a bare ENOENT on a path outside the repository is a puzzle rather
// than an answer. Nothing in CI runs this. The existence check itself lives in
// main(), not here at module scope: this module is also imported by
// test/capture_catalogue.test.ts for toSnapshot alone, and a top-level throw
// would fire on that import too, in any environment without a backend/ beside
// it -- which is exactly the standalone repository this guard is meant to
// explain, not break.
const ROOT = resolve(process.cwd(), "..");
const DOMAINS = resolve(ROOT, "backend/db/demo_store_domains.txt");
const STORES = resolve(ROOT, "backend/db/demo_stores.json");

// Shopify throttles per IP and answers 429 with "local_rate_limited". A browser
// running the extension visits one store at a time and never trips it; this
// script walks 29 in a row and trips it immediately -- measured as 3 of 29
// catalogues readable and ZERO rankings, which looks exactly like "these stores
// block us" and is not. Pacing lives here rather than in lib/catalogue.ts
// because it is a property of this harness, not of the shipped reader.
// Shopify's throttle is per IP and spans all storefronts, not per shop, so
// walking a list is exactly the shape it exists to stop. Tuned to be gentle and
// to give up quickly rather than to fight it: long per-request backoffs kept the
// connection hot and got the whole IP limited for an hour, capturing nothing.
// Cheaper to pace widely, fail fast, and let a later pass pick up the rest --
// which is what the resume behaviour in main() is for.
const MIN_GAP_MS = 20_000;
const RETRY_BASE_MS = 5000;
const MAX_RETRIES = 2;
// After a store gives up, stop knocking for a while: being throttled on one
// store means the IP is limited, so the next store would only confirm it — and
// repeated attempts escalate the penalty rather than riding it out.
const COOLDOWN_MS = 180_000;

// collectCatalogueDigest walks at most 40 pages of 250 and stops early the
// moment a page comes back short — so a count of exactly 40 × 250 means it
// stopped because it ran out of pages to walk, not because the feed ended.
// The catalogue is larger than the number, and publishing it would be a cap
// presented as a total. Measured on fashionnova.com and kith.com, both of
// which return a FULL page 40.
//
// The two constants live inside collectCatalogueDigest (they have to: the
// function is serialised into the page, so it can reference no module scope),
// which is why they are restated rather than imported. If they change there,
// this stops catching anything — hence the assertion in the test.
export const PAGE_CAP = 40 * 250;

// The extension's own answer to the cap is to ask /sitemap.xml, which knows the
// store's real total without pagination. scripts/remote_fetch.sh now captures
// that index and the per-product sitemaps it lists for exactly the stores that
// capped, so the replay can do the same arithmetic here.
//
// Counted, not parsed. kith.com's 35 product sitemaps hold 34,935 <url>
// entries between them, each carrying an <image:image> block; building a DOM
// per file to count children costs hundreds of megabytes to learn one integer.
// `<loc>` cannot match `<image:loc>` -- the literal opening tag differs -- so
// the count is of page URLs, and requiring /products/ keeps it to product pages
// even if a store's index ever points a non-product sitemap at us.
export function countSitemapProducts(xml: string): number {
  const loc = /<loc>[^<]*\/products\/[^<]*<\/loc>/g;
  let count = 0;
  while (loc.exec(xml) !== null) count++;
  return count;
}

// How many product sitemaps the store's own index lists. Same filter as
// remote_fetch.sh applies when it decides which of the index's <loc> entries to
// fetch, so the two counts are comparable by construction; lib/storefront.ts
// uses the same one in the shipped reader.
function indexedProductSitemaps(indexXml: string): number {
  return (indexXml.match(/<loc>[^<]*<\/loc>/g) ?? []).filter((l) => /product/i.test(l)).length;
}

// Whether every sitemap request in this capture answered 200. remote_fetch.sh
// sends each per-sitemap fetch's return value to /dev/null, but fetch() appends
// the code to `status` before returning it, so the evidence survives -- no
// change to the script is needed to read it here.
//
// False when there is no status file at all: an unverifiable capture is not a
// verified one.
function everySitemapFetchOk(dir: string): boolean {
  let status: string;
  try {
    status = readFileSync(resolve(dir, "status"), "utf8");
  } catch {
    return false;
  }
  let seen = false;
  for (const line of status.split("\n")) {
    const [label, code] = line.trim().split(/\s+/);
    if (!label || !code || !label.startsWith("sitemap")) continue;
    seen = true;
    if (Number(code) !== 200) return false;
  }
  return seen;
}

// null, not 0, when nothing was captured: "we did not fetch the sitemaps" and
// "the sitemaps list no products" are different facts, and only the second is a
// statement about the store.
//
// And null for a PARTIAL capture, which is the harder case. This total is
// published as the store's exact size, so summing whatever files happen to be
// on disk turns a run that stopped after 20 of kith's 35 sitemaps into a
// confident 20,000-product total -- the cap-as-a-total mistake arriving by a
// new route. The shipped reader this mirrors (lib/storefront.ts) already
// refuses outright when any sitemap fetch is not ok; the replay has the same
// evidence on disk and now uses all three pieces of it:
//
//   - the index says how many product sitemaps exist, so a missing file shows;
//   - `status` records every fetch's code, so a 403 or 429 shows;
//   - each file's closing </urlset> shows a body truncated mid-transfer, which
//     neither of the other two can: curl's --max-time expires after the headers
//     arrived, so the recorded code is still 200 and the file still exists.
export function sitemapProductTotal(dir: string): number | null {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => /^sitemap-products-\d+\.xml$/.test(f)).sort();
  } catch {
    return null;
  }
  if (files.length === 0) return null;

  let indexXml: string;
  try {
    indexXml = readFileSync(resolve(dir, "sitemap.xml"), "utf8");
  } catch {
    return null;
  }
  if (indexedProductSitemaps(indexXml) !== files.length) return null;
  if (!everySitemapFetchOk(dir)) return null;

  let total = 0;
  for (const f of files) {
    const xml = readFileSync(resolve(dir, f), "utf8");
    if (!xml.trimEnd().endsWith("</urlset>")) return null;
    total += countSitemapProducts(xml);
  }
  return total;
}

// What to record for a store whose walk hit the cap.
//
// Until now the answer was "nothing", because the only figure available was the
// cap itself and publishing 10,000 as a total is a lie about a 34,935-product
// store. The sitemap total removes that dilemma: the count becomes exact, and
// `capped` carries the export ceiling beside it -- the same pair the extension
// renders as "34,935 products · exports the first 10,000".
//
// Everything the walk computed over the prefix is dropped alongside the count
// it was computed from. The exact total is the only figure here the whole
// catalogue backs, and a prefix-derived number printed beside it reads as a
// fact about all 34,935 products:
//
//   - `variants` was summed over the first 10,000 products, so it is a floor
//     presented as a total.
//   - `price_min`/`price_max` are the same fault, not a sampling quibble.
//     /products.json is served in published_at DESCENDING order (measured on
//     kith.com: 7,569 descending pairs, 0 ascending), so the unread remainder
//     is systematically the OLDER stock -- exactly where clearance pricing
//     lives. Both endpoints are bounds in the wrong direction: the true minimum
//     can only be lower, the true maximum only higher. A "Price range" row
//     directly beneath "34,935 products" claims to be the range of those
//     34,935. kith's measured price_min of 6 rested on a single product.
//   - `best_sellers` is the worst of the three, because it is printed as a rank
//     number. It is the store's real best-selling order joined against an index
//     holding only the prefix: 289 of kith's 370 ranked handles fall outside it
//     and are dropped, and the survivors are then renumbered from 1 -- so "#1"
//     named a product the store's own sort places 25th. rankCatalogue refuses a
//     capped digest outright, so this arrives empty; stating it here too keeps
//     the rule visible at the point of publication rather than only at its
//     source. There is no substitute to invent: the panel's answer is Shopify's
//     own BEST_SELLING sort, which this harness does not fetch.
//
// The panel renders each of these nulls as an em dash, and omits the
// best-sellers section entirely when the list is empty.
//
// `newest` is the one prefix-derived figure kept, and it is kept for a reason
// specific to this feed's order rather than as a judgement call. Because
// /products.json is published_at descending, the prefix IS the newest-published
// 10,000: every unread product had a published_at earlier than the prefix's
// oldest. created_at <= published_at held for all 10,000 of kith's with zero
// exceptions, so the globally newest product is necessarily inside the prefix
// and the maximum over it is the true maximum. That argument depends entirely
// on the feed being published-descending -- a store whose feed is not would
// break it.
//
// Returns null when there is still no honest total -- no sitemaps captured, or
// one that knows no more than the walk already did.
export function cappedSnapshot(
  snapshot: CatalogueSnapshot,
  sitemapTotal: number | null,
): CatalogueSnapshot | null {
  if (sitemapTotal === null || sitemapTotal <= (snapshot.count ?? 0)) return null;
  return {
    ...snapshot,
    count: sitemapTotal,
    capped: true,
    variants: null,
    price_min: null,
    price_max: null,
    best_sellers: [],
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequestAt = 0;

// Set when a request 429s past MAX_RETRIES, cleared before each store.
//
// This flag is load-bearing, because collectCatalogueDigest cannot tell a
// throttle from a missing feed: a 429 on page 1 returns `available: false`
// ("this store has no public catalogue") and a 429 on page 3 returns the two
// pages it already had as if that were the whole catalogue -- measured on
// rothys.com as "500 products", a truncated count presented as a total. Both
// are readings we would then publish. So a store that hit a hard throttle has
// its snapshot DISCARDED rather than written.
let throttled = false;

async function politeFetch(realFetch: typeof fetch, url: any, init?: any): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const gap = lastRequestAt + MIN_GAP_MS - Date.now();
    if (gap > 0) await sleep(gap);
    lastRequestAt = Date.now();

    const res = await realFetch(url, init);
    if (res.status !== 429) return res;

    if (attempt >= MAX_RETRIES) {
      throttled = true;
      return res;
    }

    const backoff = RETRY_BASE_MS * 2 ** attempt;
    console.log(`  rate limited, waiting ${backoff / 1000}s`);
    await sleep(backoff);
  }
}

// CAPTURE_FROM=<dir> replays responses already gathered elsewhere instead of
// going to the network. This exists because Shopify's throttle is per IP: a
// residential address that has been walking a store list is penalised for
// hours, while an idle host somewhere else answers 200 immediately. So the
// bytes can be fetched from there with nothing but curl, and the digest and
// ranking still run HERE, through the extension's own modules -- the analysis
// never gets a second implementation just because the fetching moved.
//
// The layout is one directory per domain, written by scripts/remote_fetch.sh:
//   home.html  products-1.json …  best-selling.html  alphabetical.html
//   status     one "<label> <http-code>" line per request
function offlineFetch(root: string, domain: string): typeof fetch {
  const dir = resolve(root, domain);

  // The recorded status codes matter as much as the bodies: a 429 saved to disk
  // is still a throttle, and must reach the same discard rule a live one does
  // rather than being read as an empty catalogue.
  const codes = new Map<string, number>();
  try {
    for (const line of readFileSync(resolve(dir, "status"), "utf8").split("\n")) {
      const [label, code] = line.trim().split(/\s+/);
      if (label && code) codes.set(label, Number(code));
    }
  } catch {
    // No status file: treat whatever is on disk as what it is, below.
  }

  return (async (input: any) => {
    const url = String(input);
    let label: string;

    if (/\/cart\.js/.test(url)) label = "cart";
    else if (/[?&]sort_by=best-selling/.test(url)) label = "best-selling";
    else if (/[?&]sort_by=title-ascending/.test(url)) label = "alphabetical";
    else if (/\/products\.json/.test(url)) label = `products-${url.match(/[?&]page=(\d+)/)?.[1] ?? "1"}`;
    else label = "home";

    const file = label === "products" || label.startsWith("products-") || label === "cart"
      ? `${label}.json`
      : `${label}.html`;

    const status = codes.get(label) ?? 404;
    // A 429 saved to disk is still a throttle. The live path sets this in
    // politeFetch, which replay deliberately bypasses -- so without it here the
    // reading is written as `available: false`, i.e. "no public catalogue", for
    // a store we were merely blocked from reading. Measured on bombas.com.
    if (status === 429) throttled = true;

    let body = "";
    try {
      body = readFileSync(resolve(dir, file), "utf8");
    } catch {
      return new Response("", { status: codes.has(label) ? status : 404 });
    }
    return new Response(body, { status });
  }) as typeof fetch;
}

// The globals the page would have provided. `fetch` resolves the relative paths
// the injected functions use; window.Shopify carries the currency, which the
// product feed itself does not; DOMParser is what the ranking parses the two
// collection pages with.
async function withStoreContext<T>(domain: string, run: () => Promise<T>): Promise<T> {
  const origin = `https://${domain}`;
  const replayRoot = process.env.CAPTURE_FROM;
  // Replayed responses are already on disk, so pacing them would only waste
  // wall-clock; the throttle they were gathered around is a network property.
  const realFetch = replayRoot ? offlineFetch(replayRoot, domain) : globalThis.fetch;
  const paced = replayRoot
    ? (url: any, init?: any) => realFetch(url, init)
    : (url: any, init?: any) => politeFetch(realFetch, url, init);
  const currency = await activeCurrency(origin, paced);

  const g = globalThis as any;
  const saved = { fetch: g.fetch, window: g.window, DOMParser: g.DOMParser };

  g.fetch = (input: any, init?: any) =>
    paced(typeof input === "string" && input.startsWith("/") ? origin + input : input, init);
  g.window = { Shopify: currency ? { currency: { active: currency } } : undefined };
  g.DOMParser = new JSDOM("").window.DOMParser;

  try {
    return await run();
  } finally {
    g.fetch = saved.fetch;
    g.window = saved.window;
    g.DOMParser = saved.DOMParser;
  }
}

// Optional, and deliberately unable to fail the capture. It fetches the whole
// storefront homepage, which is the heaviest request this script makes and the
// one most likely to be throttled -- and letting that set `throttled` threw away
// readings whose product feed was perfectly fine. A missing currency only means
// the panel renders bare numbers, which is already the honest fallback.
async function activeCurrency(
  origin: string,
  paced: (url: any, init?: any) => Promise<Response>,
): Promise<string | null> {
  const before = throttled;
  try {
    const html = await (await paced(origin, { redirect: "follow" })).text();
    // What storefronts actually emit is `Shopify.currency = {"active":"USD",…}`
    // — the key unquoted and assigned, not a JSON member. Requiring `"currency":`
    // matched no store at all: all 19 readable catalogues came back with a null
    // currency and would have rendered prices bare, which is the fallback for
    // "we could not tell", not for "we did not look properly".
    const inline = html.match(/"?currency"?\s*[:=]\s*\{[^}]*"active"\s*:\s*"([A-Z]{3})"/)?.[1];
    if (inline) return inline;

    // The extension reads window.Shopify AFTER the page's scripts have run, so
    // it sees the global even where the served HTML does not carry it. This
    // harness only has the static bytes, so it asks /cart.js — the same shop
    // currency, from an endpoint every Liquid storefront serves. Genuinely
    // headless storefronts 404 it, and those keep the bare-number fallback.
    const cart = await paced(`${origin}/cart.js`, { redirect: "follow" });
    if (!cart.ok) return null;
    return (await cart.text()).match(/"currency"\s*:\s*"([A-Z]{3})"/)?.[1] ?? null;
  } catch {
    return null;
  } finally {
    throttled = before;
  }
}

async function main() {
  if (!existsSync(STORES)) {
    throw new Error(
      `No corpus at ${STORES}. capture:catalogue fills in backend/db/demo_stores.json ` +
        "and only runs from the stackpeek monorepo, where backend/ sits beside this " +
        "package. In the standalone extension repository " +
        "(github.com/tonic20/stackpeek-extension) there is no corpus to fill in.",
    );
  }

  const domains = readFileSync(DOMAINS, "utf8")
    .split("\n").map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  const entries = JSON.parse(readFileSync(STORES, "utf8")) as any[];
  const byDomain = new Map(entries.map((e) => [e.domain, e]));

  const missing: string[] = [];
  const blocked: string[] = [];
  const uncaptured: string[] = [];
  // Two outcomes, reported separately: a store too big to walk but counted from
  // its sitemap is a published reading, and one with no sitemap to count is
  // still a hole in the corpus. Rolling them into one line hid which was which.
  const capped: string[] = [];
  const cappedCounted: string[] = [];

  // Shopify's throttle is per IP and recovers over minutes, so a full pass can
  // take longer than one sitting. Re-running skips what already succeeded and
  // retries only what did not; CAPTURE_ALL=1 forces a full re-capture when the
  // figures need refreshing rather than completing.
  const force = process.env.CAPTURE_ALL === "1";
  const replayRoot = process.env.CAPTURE_FROM;

  for (const domain of domains) {
    const entry = byDomain.get(domain);
    if (!entry) {
      missing.push(domain);
      continue;
    }
    if (!force && entry.catalogue?.available) {
      console.log(`${domain}: already captured, skipping`);
      continue;
    }

    // Replaying a capture that is not finished. Two shapes, one consequence:
    //
    //   - no directory at all: never fetched. Reads as a 404, i.e. "no public
    //     catalogue", for a store nobody has looked at yet.
    //   - a directory with no .done marker: fetched only as far as the run got.
    //     The last page present looks full, the next one 404s, and the digest
    //     returns what it has as though that were the whole feed -- measured on
    //     chubbiesshorts.com as a confident "750 products" from a snapshot taken
    //     mid-fetch, which is the rothys truncation arriving by another route.
    //
    // remote_fetch.sh writes .done only after a domain's last request, so its
    // absence is the signal. Both cases leave the entry untouched.
    if (replayRoot && !existsSync(resolve(replayRoot, domain, ".done"))) {
      uncaptured.push(domain);
      continue;
    }

    throttled = false;
    const snapshot = await withStoreContext(domain, async () => {
      const digest = await collectCatalogueDigest(BEST_SELLER_LIMIT);
      const pages = digest.available ? await collectCollectionPages() : null;
      return toSnapshot(digest, rankCatalogue(pages, digest, BEST_SELLER_LIMIT));
    });

    // Throttling is checked first, ahead of the cap. It used to come second,
    // when a capped store recorded nothing either way and the order could not
    // matter; now that a capped store CAN be recorded, a run that was blocked
    // partway must still discard, or a throttle would publish a reading through
    // the new branch.
    if (throttled) {
      blocked.push(domain);
      // No cooldown when replaying: the throttle being recorded is one that
      // happened elsewhere, at capture time. There is no live connection here
      // to back off from, and sleeping only lengthens the run.
      console.log(`${domain}: throttled at capture time — no reading taken`);
      if (!replayRoot) await sleep(COOLDOWN_MS);
    } else if (snapshot.available && snapshot.count === PAGE_CAP) {
      // Only the replay has sitemaps to count: remote_fetch.sh captures them,
      // and the live path here has never fetched one. A live capped store
      // therefore keeps the old behaviour, which is still the right one when
      // there is no exact total to be had.
      const exact = cappedSnapshot(
        snapshot,
        replayRoot ? sitemapProductTotal(resolve(replayRoot, domain)) : null,
      );
      if (exact) {
        entry.catalogue = exact;
        cappedCounted.push(domain);
        // No "N ranks" branch here, unlike the ordinary case below: a capped
        // reading never carries one, because a ranking joined against the
        // prefix is wrong rather than partial. See cappedSnapshot.
        console.log(
          `${domain}: ${exact.count} products from the sitemap, first ${PAGE_CAP} read, ` +
          "no ranking and no price range — both would be readings of the prefix",
        );
      } else {
        capped.push(domain);
        console.log(`${domain}: feed exceeds the ${PAGE_CAP}-product read cap and no sitemap counts it — no reading taken`);
      }
    } else {
      entry.catalogue = snapshot;
      console.log(
        `${domain}: ${snapshot.available ? `${snapshot.count} products` : "catalogue not readable"}` +
        `${snapshot.best_sellers.length ? `, ${snapshot.best_sellers.length} ranks` : ", no ranking"}`,
      );
    }

    // Checkpointed per store, not once at the end: a full pass takes long
    // enough to be interrupted, and losing every reading to the last one is
    // how the first attempt at this went.
    writeFileSync(STORES, `${JSON.stringify(entries, null, 2)}\n`);
  }

  const readable = entries.filter((e) => e.catalogue?.available);
  const ranked = readable.filter((e) => e.catalogue.best_sellers?.length);
  console.log(`\n${readable.length}/${domains.length} catalogues read, ${ranked.length} with a usable ranking.`);
  if (missing.length) {
    console.warn(`No seed entry for: ${missing.join(", ")} — run 'bin/rails demo:dump' first.`);
  }
  if (blocked.length) {
    console.warn(`Throttled, no reading taken: ${blocked.join(", ")}. Re-run later to finish.`);
    process.exitCode = 1;
  }
  if (uncaptured.length) {
    console.warn(`Not in the replay set, left untouched: ${uncaptured.join(", ")}.`);
    process.exitCode = 1;
  }
  if (cappedCounted.length) {
    console.log(`Larger than the reader's ${PAGE_CAP}-product cap; counted from the sitemap and recorded with the ceiling disclosed: ${cappedCounted.join(", ")}.`);
  }
  if (capped.length) {
    console.warn(`Larger than the reader's ${PAGE_CAP}-product cap and no sitemap captured, so no honest count exists: ${capped.join(", ")}. Re-run scripts/remote_fetch.sh to gather one.`);
  }
}

// Guarded so the test can import toSnapshot without driving the network.
// Not top-level await: this is bundled by the extension's Vite, whose target is
// the browser, and esbuild refuses top-level await for it.
if (process.argv[1]?.includes("capture_catalogue")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
