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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { collectCatalogueDigest, collectCollectionPages } from "../lib/catalogue";
import { rankCatalogue } from "../lib/ranking";
import { BEST_SELLER_LIMIT } from "../lib/catalogue_bridge";
import type { CatalogueDigest, CatalogueEntry } from "../lib/catalogue_types";

export interface CatalogueSnapshot {
  available: boolean;
  count: number;
  variants: number;
  price_min: number | null;
  price_max: number | null;
  newest: string | null;
  currency: string | null;
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
  const capped: string[] = [];

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

    if (snapshot.available && snapshot.count === PAGE_CAP) {
      capped.push(domain);
      console.log(`${domain}: feed exceeds the ${PAGE_CAP}-product read cap — no reading taken`);
    } else if (throttled) {
      blocked.push(domain);
      // No cooldown when replaying: the throttle being recorded is one that
      // happened elsewhere, at capture time. There is no live connection here
      // to back off from, and sleeping only lengthens the run.
      console.log(`${domain}: throttled at capture time — no reading taken`);
      if (!replayRoot) await sleep(COOLDOWN_MS);
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
  if (capped.length) {
    console.warn(`Larger than the reader's ${PAGE_CAP}-product cap, so no honest count exists: ${capped.join(", ")}.`);
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
