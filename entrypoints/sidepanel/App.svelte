<script lang="ts">
  import { postDetect, RateLimitError } from "../../lib/api";
  import { getInstallId } from "../../lib/install_id";
  import { collectFromActiveTab } from "../../lib/collect_bridge";
  import { runRounds } from "../../lib/detect_runner";
  import { InjectionDeniedError } from "../../lib/errors";
  import { watchActiveTab } from "../../lib/tab_watcher";
  import { extensionVersion } from "../../lib/version";
  import type { PanelStatus, TerminalStatus } from "../../lib/panel_status";
  import { fetchCatalogueDigest, fetchCataloguePage, fetchCollectionPages, BEST_SELLER_LIMIT } from "../../lib/catalogue_bridge";
  import { fetchStorefrontDigest, fetchStorefrontBestSellers, fetchStorefrontExport } from "../../lib/storefront_bridge";
  import { EXPORT_CEILING, EXPORT_MAX_PAGES, EXPORT_PAGE_SIZE } from "../../lib/export_limits";
  import type { CatalogueDigest, CatalogueEntry, CatalogueProduct, CollectionPages, ExportState, ExportWalk } from "../../lib/catalogue_types";
  import { toCsv } from "../../lib/csv";
  import { downloadText, catalogueFilename } from "../../lib/download";
  import { rankCatalogue } from "../../lib/ranking";
  import ProductSummary from "./components/ProductSummary.svelte";
  import BestSellers from "./components/BestSellers.svelte";
  import ThemeCard from "./components/ThemeCard.svelte";
  import AppList from "./components/AppList.svelte";
  import Trackers from "./components/Trackers.svelte";
  import Infrastructure from "./components/Infrastructure.svelte";
  import Skeleton from "./components/Skeleton.svelte";
  import TerminalState from "./components/TerminalState.svelte";
  import ThemeToggle from "./components/ThemeToggle.svelte";

  // runner returns { signals, url }; injected in tests, defaults to the real collector bridge (Task 7)
  // delays overrides the round schedule; only used by tests to avoid waiting out ROUND_DELAYS_MS.
  let {
    runner = collectFromActiveTab,
    autostart = true,
    delays,
    watch = watchActiveTab,
    catalogue = fetchCatalogueDigest,
    storefrontCatalogue = fetchStorefrontDigest,
    storefrontBestSellers = fetchStorefrontBestSellers,
    cataloguePage = fetchCataloguePage,
    collectionPages = fetchCollectionPages,
    storefrontExport = fetchStorefrontExport,
  }: {
    runner?: () => Promise<{ signals: unknown; url: string | undefined }>;
    autostart?: boolean;
    delays?: number[];
    watch?: (onChange: () => void) => { stop: () => void };
    catalogue?: () => Promise<CatalogueDigest>;
    storefrontCatalogue?: () => Promise<CatalogueDigest>;
    storefrontBestSellers?: (limit: number) => Promise<CatalogueEntry[]>;
    cataloguePage?: (page: number) => Promise<CatalogueProduct[] | null>;
    collectionPages?: () => Promise<CollectionPages | null>;
    storefrontExport?: (onProgress: (done: number) => void) => Promise<ExportWalk | null>;
  } = $props();

  let status: PanelStatus = $state("idle");
  let data: any = $state(null);
  let refining = $state(false);

  let domain = $state("");

  // null while being read; a settled digest may still report available: false.
  let digest: CatalogueDigest | null = $state(null);
  // The store the digest describes. The memo key is the hostname, not the page:
  // the panel rescans on navigation now, and refetching several megabytes
  // because the user opened a second product page would be waste with no
  // observable benefit (design D4).
  let digestDomain = "";

  // Which source answered for the current store, so the export uses the same one.
  // A digest from the Storefront API means /products.json is not readable here;
  // exporting through it would fail every time.
  let digestSource: "products_json" | "storefront" = "products_json";

  let exportState: ExportState = $state("idle");
  // total is null when the digest carries no count -- a readable catalogue whose
  // size we could not read. ProductSummary renders that as a bare "exported"
  // tally with no track, rather than against an invented denominator.
  let exportProgress: { done: number; total: number | null } | null = $state(null);
  let exportFilename: string | null = $state(null);

  // Empty unless the ranking was proven. Absent, not empty, is what the section
  // renders (design D3).
  let bestSellers: CatalogueEntry[] = $state([]);

  // A tab change that arrives mid-scan. Consumed when the run settles rather
  // than acted on immediately -- see handleTabChange below. A plain let, not
  // $state: nothing in the template reads it, so making it reactive would buy
  // nothing and imply it is rendered.
  let pendingRescan = false;

  const version = extensionVersion();

  // The header names the store being scanned. A tab URL can be undefined (no
  // active tab) or unparseable (chrome:// pages), and both mean "nothing to
  // show" rather than an error -- the header renders an empty slot.
  function hostnameOf(url: string | undefined): string {
    if (!url) return "";
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  }

  export async function runDetection(run = runner) {
    status = "loading";
    refining = true;
    try {
      const install_id = await getInstallId();
      await runRounds({
        collect: run,
        send: postDetect,
        installId: install_id,
        delays,
        onNoSignals: () => { status = "cant_scan"; },
        onUpdate: (result, url) => {
          data = result;
          domain = hostnameOf(url);
          status = result.is_shopify ? "result" : "not_shopify";
          if (result.is_shopify) loadCatalogue(domain);
        },
      });
    } catch (e) {
      // Each of these is its own status rather than an error carrying different
      // copy, so each can have its own code chip and wording. TerminalState
      // owns all of it; nothing here formats a message.
      if (e instanceof InjectionDeniedError) status = "needs_permission";
      else if (e instanceof RateLimitError) status = "rate_limited";
      else status = "error";
    } finally {
      refining = false;
      if (pendingRescan) {
        pendingRescan = false;
        runDetection();
      }
    }
  }

  async function loadCatalogue(host: string) {
    if (!host || host === digestDomain) return;
    digestDomain = host;
    digest = null;
    digestSource = "products_json";
    bestSellers = [];
    exportState = "idle";
    exportProgress = null;
    exportFilename = null;

    let result = await catalogue();
    // A store change mid-read makes this answer stale; the newer load owns the
    // slot and this one is dropped.
    if (digestDomain !== host) return;

    // Only "not_public" is evidence: the store answered and has no feed. An
    // unreadable result proves nothing about the store, so a second source
    // would be guessing -- and would replace an honest message with a wrong one.
    if (!result.available && result.reason === "not_public") {
      const viaApi = await storefrontCatalogue();
      if (digestDomain !== host) return;
      if (viaApi.available) { result = viaApi; digestSource = "storefront"; }
    } else if (result.available && result.capped) {
      // The walk ran out of pages, not products, so `count` is a floor. The
      // sitemap knows the real total; nothing else about the digest changes.
      const exact = await storefrontCatalogue();
      if (digestDomain !== host) return;
      // A null count from that source is a sitemap we could not read, which
      // improves on nothing: the floor we already have is better than an
      // absence, so it stays.
      if (exact.available && exact.count !== null && exact.count > (result.count ?? 0)) {
        // Every figure the walk computed goes with the count it was computed
        // from. `variants` was summed over the first 10,000 products only, so
        // beside a 34,935-product total it is a floor wearing the clothes of a
        // total -- the exact overclaim this branch exists to remove, moved one
        // row down.
        //
        // The price range is the same fault, not a sampling quibble.
        // /products.json is served in published_at DESCENDING order (measured
        // on kith.com: 7,569 descending pairs, 0 ascending), so the products the
        // walk never reached are systematically the OLDER ones -- exactly where
        // clearance pricing lives. Both endpoints are therefore bounds in the
        // wrong direction: the true minimum can only be lower and the true
        // maximum only higher. A "Price range" row directly beneath "34,935
        // products" reads as the range of those 34,935.
        //
        // `newest` survives, and is the only prefix-derived figure that does.
        // It survives BECAUSE of that same descending order: the prefix is the
        // newest-published 10,000, every unread product was published earlier
        // than the prefix's oldest, and created_at <= published_at held for all
        // 10,000 of kith's with no exceptions -- so the globally newest product
        // is necessarily inside the prefix. A store whose feed is not
        // published-descending would break that argument.
        //
        // Null is what the digest already means by "we did not read this", and
        // ProductSummary renders it as an em dash.
        result = { ...result, count: exact.count, variants: null, priceMin: null, priceMax: null, capped: true };
      }
    }

    digest = result;

    // Ranked after the digest, not with it: the ranking is optional and slower,
    // and the summary must never wait on it.
    const pages = await collectionPages();
    if (digestDomain !== host) return;
    bestSellers = rankCatalogue(pages, result, BEST_SELLER_LIMIT);
    // The collection-order inference needs collection pages, which a headless
    // storefront does not serve. Shopify's own ranking is available there and is
    // better evidence anyway.
    if (bestSellers.length === 0) {
      const ranked = await storefrontBestSellers(BEST_SELLER_LIMIT);
      if (digestDomain === host) bestSellers = ranked;
    }
  }

  // loadCatalogue memoizes on digestDomain to avoid refetching several
  // megabytes on a same-store re-render (design D4) -- which is exactly what
  // makes a retry a no-op if that memo is left standing: `host === digestDomain`
  // would be true and loadCatalogue would return before doing anything. Clearing
  // it here is the whole fix; the fetch/fallback/ranking logic stays in one place.
  function retryCatalogueRead() {
    digestDomain = "";
    loadCatalogue(domain);
  }

  // What the progress counts against: the export's reach, not the store's size.
  // A denominator of 42,098 on a walk that stops at 10,000 draws a bar that
  // fills a quarter of the way and then announces success -- which reads as a
  // botched export of the whole catalogue rather than a finished export of the
  // part we are allowed to take.
  //
  // Still bounded below by `done`: the count comes from a sitemap, and a
  // sitemap that undercounts must not produce a bar drawn past full.
  const exportTotal = (known: number | null, done: number): number | null =>
    known === null ? null : Math.max(Math.min(known, EXPORT_CEILING), done);

  async function runExport() {
    if (!digest?.available) return;
    exportState = "fetching";
    // Cleared on entry, not merely on success: a second export from the `done`
    // state otherwise carries the previous run's filename in memory, waiting
    // for something to render it.
    exportFilename = null;
    // null when the catalogue's size was never read. Carried through rather
    // than defaulted to 0 or to the running total: the progress note and the
    // track both key on it, and either substitute would invent a denominator.
    exportProgress = { done: 0, total: exportTotal(digest.count, 0) };

    const products: CatalogueProduct[] = [];
    let truncated = false;
    if (digestSource === "storefront") {
      const walk = await storefrontExport((done) => {
        exportProgress = { done, total: exportTotal(digest?.count ?? null, done) };
      });
      if (walk === null) { exportState = "error"; exportProgress = null; return; }
      products.push(...walk.products);
      truncated = walk.truncated;
    } else {
      for (let page = 1; page <= EXPORT_MAX_PAGES; page++) {
        const batch = await cataloguePage(page);
        if (batch === null) { exportState = "error"; exportProgress = null; return; }
        products.push(...batch);
        exportProgress = { done: products.length, total: exportTotal(digest.count, products.length) };
        // A short page is the feed running out of products. A full one on the
        // last page we are allowed to read is the walk running out of pages,
        // which is a different thing and leaves the rest of the store behind.
        if (batch.length < EXPORT_PAGE_SIZE) break;
        truncated = page === EXPORT_MAX_PAGES;
      }
    }

    // The count beside the button is the whole store; what the file holds is
    // what the walk reached. Naming the second against the first is the whole
    // point -- "10,000 of 42,098" is the sentence the CSV could not otherwise
    // say about itself.
    exportFilename = catalogueFilename(domain, new Date(),
      truncated ? { exported: products.length, total: digest.count } : null);
    downloadText(exportFilename, toCsv(products));
    exportProgress = null;
    exportState = "done";
  }

  // The panel outlives the tab it scanned -- that is what makes it a panel
  // rather than a popup -- so a navigation leaves a result on screen that
  // describes a page the user has left, with the old domain still in the
  // header. Confidently wrong with no tell is the worst failure a detection
  // tool has.
  //
  // Queued rather than immediate while a scan is in flight: calling
  // runDetection here would start a second concurrent runRounds loop racing the
  // first over status, data, domain and refining, which is exactly the race the
  // hidden rescan button exists to make unreachable (design D6).
  function handleTabChange() {
    if (refining) {
      pendingRescan = true;
      return;
    }
    runDetection();
  }

  $effect(() => {
    const watcher = watch(handleTabChange);
    return () => watcher.stop();
  });

  $effect(() => { if (autostart && status === "idle") runDetection(); });
</script>

<div class="sp-panel">
  <header class="sp-hd">
    <span class="sp-hd__mark"><img src="/icon-32.png" width="14" height="14" alt=""></span>
    <span class="sp-hd__domain">{domain}</span>
    {#if refining}
      <!--
        We run four rounds, and the design knows a single `loading` state with no
        vocabulary for "these results are real but may still grow". So from the
        first result onward the body shows results and the header carries the
        status instead: .sp-scan holds the rescan button's slot until the last
        round settles (design D5). No in-body "still scanning…" line -- a second
        status line beneath the results competes with the thing it describes.

        This is also the re-entrancy guard. An absent control cannot be clicked,
        so no second runRounds() loop can race the first over shared state
        (status, data, domain, refining). It replaces the old
        disabled={refining} for the same reason, more strongly.
      -->
      <span class="sp-scan" role="status" aria-live="polite">
        <span class="sp-spinner" aria-hidden="true"></span>Scanning…
      </span>
    {:else if status !== "cant_scan" && status !== "needs_permission"}
      <!-- No rescan on an unscannable page: nothing about it will change by
           asking again, which is why the state offers no action either. -->
      <button class="sp-iconbtn" type="button" aria-label="Rescan this page" onclick={() => runDetection()}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"></path><path d="M13.5 2v3.2h-3.2"></path></svg>
      </button>
    {/if}
  </header>

  <div class="sp-body">
    {#if status === "loading"}
      <Skeleton />
    {:else if status === "result"}
      <ThemeCard theme={data.theme} />
      <AppList apps={data.apps} />
      <Trackers items={data.pixels} unknownDomainCount={data.unknown_domain_count} />
      <Infrastructure items={data.infrastructure} />
      <ProductSummary
        {digest}
        state={exportState}
        progress={exportProgress}
        filename={exportFilename}
        onexport={runExport}
        onretryread={retryCatalogueRead}
      />
      <BestSellers products={bestSellers} currency={digest?.currency ?? null} />
    {:else if status !== "idle"}
      <!-- The cast, not narrowing: svelte2tsx compiles each branch separately,
           so it does not carry "not loading, not result, not idle" into the
           child's prop type. PanelStatus minus those three IS TerminalStatus,
           and the branch conditions above are the proof. -->
      <TerminalState status={status as TerminalStatus} {domain} onretry={() => runDetection()} />
    {/if}
  </div>

  <footer class="sp-ft">
    <a href="https://stackpeek.app/privacy" target="_blank" rel="noreferrer">Privacy</a>
    <ThemeToggle />
    <!-- Empty outside the extension (tests, the preview board), where there is
         no manifest to read. A bare "v" would look like a bug. -->
    {#if version}<span class="sp-ft__v">v{version}</span>{/if}
  </footer>
</div>
