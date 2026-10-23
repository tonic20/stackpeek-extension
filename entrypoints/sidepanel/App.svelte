<script lang="ts">
  import { postDetect, ApiError, NetworkError, OfflineError, RateLimitError, TimeoutError } from "../../lib/api";
  import type { DetectResponse } from "../../lib/api";
  import { getInstallId } from "../../lib/install_id";
  import { collectFromActiveTab } from "../../lib/collect_bridge";
  import { runRounds } from "../../lib/detect_runner";
  import { InjectionDeniedError } from "../../lib/errors";
  import { watchActiveTab, type ScanTrigger } from "../../lib/tab_watcher";
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
  import ExportDeck from "./components/ExportDeck.svelte";
  import ThemeCard from "./components/ThemeCard.svelte";
  import AppList from "./components/AppList.svelte";
  import Trackers from "./components/Trackers.svelte";
  import Infrastructure from "./components/Infrastructure.svelte";
  import Skeleton from "./components/Skeleton.svelte";
  import TerminalState from "./components/TerminalState.svelte";
  import ThemeToggle from "./components/ThemeToggle.svelte";
  import AutoScanSwitch from "./components/AutoScanSwitch.svelte";
  import AutoScanOffer from "./components/AutoScanOffer.svelte";
  import { hostAccess, type HostAccess } from "../../lib/host_access";
  import { autoScanOffer, type AutoScanOffer as Offer } from "../../lib/auto_scan_offer";
  import { shortcut as actionShortcut, type Shortcut } from "../../lib/shortcut";
  import ShortcutRow from "./components/ShortcutRow.svelte";
  import { i18n } from "#i18n";
  import { applyDocumentLocale } from "../../lib/locale";
  import { heldLinkClick } from "../../lib/held_tabs";
  import { FEEDBACK_URL, SITE_URL, reviewUrl } from "../../lib/store_links";

  applyDocumentLocale();

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
    access = hostAccess,
    offer = autoScanOffer,
    shortcut = actionShortcut,
  }: {
    runner?: (onUrl?: (url: string | undefined) => void) => Promise<{ signals: unknown; url: string | undefined }>;
    autostart?: boolean;
    delays?: number[];
    watch?: (
      onChange: (trigger?: ScanTrigger) => void,
      opts?: { onHold?: (holding: boolean) => void },
    ) => { stop: () => void };
    catalogue?: () => Promise<CatalogueDigest>;
    storefrontCatalogue?: () => Promise<CatalogueDigest>;
    storefrontBestSellers?: (limit: number) => Promise<CatalogueEntry[]>;
    cataloguePage?: (page: number) => Promise<CatalogueProduct[] | null>;
    collectionPages?: () => Promise<CollectionPages | null>;
    storefrontExport?: (onProgress: (done: number) => void) => Promise<ExportWalk | null>;
    access?: HostAccess;
    offer?: Offer;
    shortcut?: Shortcut;
  } = $props();

  let status: PanelStatus = $state("idle");
  let data: any = $state(null);
  let refining = $state(false);

  let domain = $state("");

  // The tab in front of the user is one the panel opened for them, off a theme
  // or app link, so the results below describe a store they have deliberately
  // stepped away from rather than a page they have left behind (lib/held_tabs.ts).
  let held = $state(false);

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
  //
  // Holds the trigger rather than a flag, so a queued rescan keeps what it was:
  // an automatic one still has to pass the consent check when it runs, and a
  // click queued behind an automatic one is still a click.
  let pendingRescan: ScanTrigger | null = null;
  const stronger = (a: ScanTrigger | null, b: ScanTrigger): ScanTrigger =>
    a === "click" || b === "click" ? "click" : "auto";

  // The API refused us with a 429 and the panel is waiting it out. While it
  // is, nothing starts a scan: not Retry or the header button, which are
  // disabled, and not a tab change, which is the one that matters -- the
  // watcher fires on every switch and navigation, and each of those is up to
  // four more requests at a limit that has already said no. A scan asked for
  // in the meantime is remembered and run once when the wait is over, because
  // whatever is on screen by then describes a page the user has left.
  //
  // `coolUntil` is the moment it ends, for the countdown; `cooling` is the
  // reactive flag the template reads, since Date.now() is not.
  let cooling = $state(false);
  let coolUntil = $state(0);
  let coolTimer: ReturnType<typeof setTimeout> | undefined;
  let deferredRescan: ScanTrigger | null = null;

  function startCooldown(ms: number) {
    cooling = true;
    coolUntil = Date.now() + ms;
    clearTimeout(coolTimer);
    coolTimer = setTimeout(endCooldown, ms);
  }

  function endCooldown() {
    cooling = false;
    coolUntil = 0;
    if (deferredRescan) {
      const trigger = deferredRescan;
      deferredRescan = null;
      handleTabChange(trigger);
    }
  }

  // Wraps the send rather than reading the error in runDetection's catch, which
  // only ever sees a 429 on the FIRST round. A later round's refusal is
  // swallowed by runRounds to keep the result on screen (lib/detect_runner.ts),
  // and the limit is just as spent then: without this the next tab switch
  // would go straight back to the API that has just refused it.
  async function send(payload: Record<string, unknown>): Promise<DetectResponse> {
    try {
      return await postDetect(payload);
    } catch (e) {
      if (e instanceof RateLimitError) startCooldown(e.retryAfterMs);
      throw e;
    }
  }

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

  // trigger is "click" for everything the user asked for in the panel --
  // opening it, Retry, the header button -- and is carried through for the
  // tab watcher's own rescans, which arrive via handleTabChange.
  export async function runDetection(run = runner, trigger: ScanTrigger = "click") {
    // The one gate every path into a scan passes through -- Retry, the header
    // button, a tab change, a click on the toolbar icon, a rescan queued
    // behind the previous run -- so none of them can slip past the wait.
    if (cooling) {
      deferredRescan = stronger(deferredRescan, trigger);
      return;
    }
    status = "loading";
    refining = true;
    // The header names the store the body describes, and the body is about to
    // be a skeleton for a page we have not read yet. Leaving the last store's
    // name there through a scan of the next one says the skeleton is that
    // store's. It is blanked here and filled in as soon as the collector knows
    // which tab it is reading -- the same origin the scan sends, learned
    // before the injection rather than after it (lib/collect_bridge.ts). Only
    // while nothing has rendered: from the first result on, onUpdate owns the
    // header, so that it always names what is on screen.
    domain = "";
    const onUrl = (url: string | undefined) => {
      if (status === "loading") domain = hostnameOf(url);
    };
    try {
      const install_id = await getInstallId();
      await runRounds({
        collect: () => run(onUrl),
        send,
        installId: install_id,
        delays,
        onNoSignals: () => { status = "cant_scan"; domain = ""; },
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
      //
      // Most specific first: OfflineError is a NetworkError, and every API
      // failure is an ApiError. Anything that is not one at all -- a fault of
      // ours before the request was made -- keeps the old network wording,
      // which is what it got before the failures were told apart.
      if (e instanceof InjectionDeniedError) status = "needs_permission";
      else if (e instanceof RateLimitError) status = "rate_limited";
      else if (e instanceof TimeoutError) status = "timeout";
      else if (e instanceof OfflineError) status = "offline";
      else if (e instanceof NetworkError) status = "error";
      else if (e instanceof ApiError) status = "server_error";
      else status = "error";
      // The header names the store the body describes, and none of these
      // states describes a store. Leaving the last one there puts "Open
      // Stackpeek on this store" directly beneath somebody else's domain,
      // which reads as that store having refused us. not_shopify keeps its
      // domain, because it is set from a result and TerminalState reads it to
      // recognise our own site.
      domain = "";
    } finally {
      refining = false;
      if (pendingRescan) {
        const queued = pendingRescan;
        pendingRescan = null;
        handleTabChange(queued);
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
  //
  // An automatic rescan on Firefox also has to pass blocksAutoScan: with the
  // browsingActivity consent withdrawn but the access to all sites still
  // granted, the tab is treated exactly as one without access -- nothing is
  // collected or sent, and the body asks for the click that a click-triggered
  // scan, or the shortcut, then answers as usual.
  async function handleTabChange(trigger: ScanTrigger = "auto") {
    if (refining) {
      pendingRescan = stronger(pendingRescan, trigger);
      return;
    }
    if (trigger === "auto") {
      const blocked = await access.blocksAutoScan();
      // Re-checked after the await, whichever way it went: a second change
      // arriving while the first was being checked has started a run by now,
      // and starting another would be the concurrent-loop race the queue
      // exists to prevent. Queued, it runs -- and is checked -- in turn.
      if (refining) {
        pendingRescan = stronger(pendingRescan, trigger);
        return;
      }
      if (blocked) {
        status = "needs_permission";
        domain = "";
        return;
      }
    }
    runDetection(runner, trigger);
  }

  $effect(() => {
    const watcher = watch(handleTabChange, { onHold: (holding) => { held = holding; } });
    return () => watcher.stop();
  });

  $effect(() => { if (autostart && status === "idle") runDetection(); });

  // Whether the user has given the panel access to every site, so a tab switch
  // can scan without a toolbar click (lib/host_access.ts). null where the
  // browser has no permissions API, which hides the switch rather than offer
  // one that cannot work.
  let autoScan: boolean | null = $state(null);

  // The one place the answer lands, from the switch and from the browser's own
  // onAdded/onRemoved alike -- Chrome fires both for a grant made here, and
  // only a change of answer may act, or the grant would scan twice.
  //
  // A grant while the body says needs_permission is the user doing what that
  // state asked, by the other route it offers: scan now rather than leave the
  // instruction standing until they switch tabs. Through handleTabChange, so
  // it queues behind a scan in flight like every other trigger.
  function applyAutoScan(granted: boolean | null) {
    const was = autoScan;
    autoScan = granted;
    if (granted === true && was !== true && status === "needs_permission") handleTabChange("click");
  }

  // Called from the switch's click handler, and request() makes the browser
  // call synchronously inside it: the user gesture ends at the first await.
  function setAutoScan(on: boolean) {
    (on ? access.request() : access.remove())
      .then(() => access.has())
      .then(applyAutoScan);
  }

  let offerOpen = $state(false);
  $effect(() => {
    let live = true;
    offer.pending().then((p) => { if (live) offerOpen = p; });
    return () => { live = false; };
  });
  function closeOffer(accept: boolean) {
    if (accept) setAutoScan(true);
    offerOpen = false;
    offer.close();
  }
  const offering = $derived.by(() => offerOpen && autoScan === false && status === "result");

  // null where there is no commands API, which hides the row.
  let shortcutKey: string | null = $state(null);
  $effect(() => {
    let live = true;
    const reread = () => shortcut.read().then((k) => { if (live) shortcutKey = k; });
    reread();
    const watcher = shortcut.watch(reread);
    return () => { live = false; watcher.stop(); };
  });
  function setShortcut(on: boolean) {
    shortcut.setEnabled(on).catch(() => {}).then(() => shortcut.read()).then((k) => { shortcutKey = k; });
  }
  const showAutoSwitch = $derived.by(() => autoScan !== null && !offering && !(status === "needs_permission" && autoScan === false));

  $effect(() => {
    let live = true;
    access.has().then((granted) => { if (live) applyAutoScan(granted); });
    const watcher = access.watch(applyAutoScan);
    return () => { live = false; watcher.stop(); };
  });

  // The header's rescan button is replaced by the scan indicator for as long
  // as the scan runs (design D5, and the re-entrancy guard below), so pressing
  // it from the keyboard removed the focused element from under the user and
  // dropped focus to <body> -- the next Tab started again from the top of the
  // panel. Focus follows the slot instead: onto the indicator while the scan
  // runs, which also reads "Scanning…" out, and back onto the button when it
  // returns. A scan that ends with no button to return to (cant_scan,
  // needs_permission) leaves focus on the body that now explains why.
  //
  // Only when the button had focus as it was pressed: a scan started any other
  // way -- a tab switch, a toolbar click -- must not pull focus to the header
  // from wherever the user has it.
  let rescanButton: HTMLButtonElement | null = $state(null);
  let scanIndicator: HTMLElement | null = $state(null);
  let body: HTMLElement | null = $state(null);
  let followFocus = false;

  function rescanFromHeader() {
    followFocus = document.activeElement === rescanButton;
    runDetection();
  }

  $effect(() => {
    if (scanIndicator && followFocus) scanIndicator.focus();
  });
  $effect(() => {
    if (refining || !followFocus) return;
    followFocus = false;
    (rescanButton ?? body)?.focus();
  });

  $effect(() => () => clearTimeout(coolTimer));
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
      <span class="sp-scan" role="status" aria-live="polite" tabindex="-1" bind:this={scanIndicator}>
        <span class="sp-spinner" aria-hidden="true"></span>{i18n.t("panel.scanning")}
      </span>
    {:else if status !== "cant_scan" && status !== "needs_permission"}
      <!-- No rescan on an unscannable page: nothing about it will change by
           asking again, which is why the state offers no action either. -->
      <!-- Disabled rather than absent while the rate limit is waited out: it
           will work again shortly, and a control that vanished would not say
           so. The countdown itself is in the body, beside Retry. -->
      <button class="sp-iconbtn" type="button" aria-label={i18n.t("panel.rescan")} disabled={cooling} bind:this={rescanButton} onclick={rescanFromHeader}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"></path><path d="M13.5 2v3.2h-3.2"></path></svg>
      </button>
    {/if}
  </header>

  <div class="sp-body" tabindex="-1" bind:this={body}>
    {#if status === "loading"}
      <Skeleton />
    {:else if status === "result"}
      <!--
        Only beside a result: "still showing spotonfence.com" under a
        permission error would be describing something that is not there.
      -->
      {#if held}
        <p class="sp-held" role="status">{i18n.t("panel.held", [domain])}</p>
      {/if}
      {#if offering}
        <AutoScanOffer onaccept={() => closeOffer(true)} ondismiss={() => closeOffer(false)} />
      {/if}
      <ThemeCard theme={data.theme} />
      <AppList apps={data.apps} />
      <Trackers items={data.pixels} unknownDomainCount={data.unknown_domain_count} />
      <Infrastructure items={data.infrastructure} />
      <!-- Directly under the findings it exports, and above the catalogue
           sections, which carry their own export. Below Best sellers this read
           as an export of those -- the one thing it does not do. Only where a
           scan settled on a store: a page with no findings has nothing to hand
           anyone. -->
      <ExportDeck
        scan={{
          domain,
          scannedAt: new Date(),
          theme: data.theme,
          apps: data.apps ?? [],
          pixels: data.pixels ?? [],
          infrastructure: data.infrastructure ?? [],
          unknown_domain_count: data.unknown_domain_count ?? 0,
        }}
      />
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
      <TerminalState status={status as TerminalStatus} {domain} retryAt={cooling ? coolUntil : 0} onretry={() => runDetection()}>
        <!-- The one-click fix beside the toolbar instruction: with access to
             every site, the next tab switch needs no click at all. Only while
             it is off; with it on, there is nothing to offer here. -->
        {#if status === "needs_permission" && shortcutKey}
          <p class="sp-state__body">{i18n.t("terminal.needsPermission.shortcut", [shortcutKey])}</p>
        {/if}
        {#if status === "needs_permission" && autoScan === false}
          <p class="sp-state__body">{i18n.t("terminal.needsPermission.hint")}</p>
          <AutoScanSwitch checked={false} onchange={setAutoScan} />
        {/if}
      </TerminalState>
    {/if}
  </div>

  <!--
    Still the brief's minimal footer: one line, the footer's own faint type,
    no new weight. What changed is that it is now the way back to the product
    -- a review on the store and a word to us are the only feedback most users
    will ever give, and there was nowhere in the panel to give either.

    The outbound links go through heldLinkClick, like ThemeCard's and
    AppList's. Opened as a plain new tab, each one fired the tab watcher, and
    the rescan it triggered replaced the result with a permission error about
    our own site or a store listing (lib/held_tabs.ts). Feedback is a
    mailto: the mail client takes it, and no tab is opened to hold.
  -->
  <!-- Above the footer and drawn like it: persistent, quiet, and present in
       every state, because turning auto-scan off has to be as easy as turning
       it on. Not while the body is offering it -- needs_permission's switch or
       the first result's card -- or the question would be asked twice. -->
  {#if showAutoSwitch || shortcutKey !== null}
    <div class="prefs">
      {#if showAutoSwitch}
        <AutoScanSwitch checked={autoScan === true} onchange={setAutoScan} />
      {/if}
      {#if shortcutKey !== null}
        <ShortcutRow keyText={shortcutKey} canToggle={shortcut.canToggle} onchange={setShortcut} />
      {/if}
    </div>
  {/if}

  <footer class="sp-ft">
    <span class="links">
      <a href={reviewUrl()} target="_blank" rel="noreferrer" onclick={heldLinkClick}>{i18n.t("panel.rate")}</a>
      <span class="sp-sep" aria-hidden="true">·</span>
      <a href={FEEDBACK_URL}>{i18n.t("panel.feedback")}</a>
    </span>
    <ThemeToggle />
    <!-- Empty outside the extension (tests, the preview board), where there is
         no manifest to read. A bare "v" would look like a bug. The name says
         where the link goes, since "v0.6.1" alone does not; it keeps the
         visible text in it, so voice control can still say what it sees. -->
    {#if version}
      <a class="sp-ft__v" href={SITE_URL} target="_blank" rel="noreferrer" aria-label="stackpeek.app v{version}" onclick={heldLinkClick}>v{version}</a>
    {/if}
  </footer>
</div>

<style>
  /* Focused only by script, as somewhere for focus to wait (see followFocus).
     Neither is a control, and a ring around the whole body or a status line
     would read as one. */
  .sp-scan:focus,
  .sp-body:focus {
    outline: none;
  }

  /* The settings rows borrow the footer's surface and rhythm, so the block reads
     as one block of persistent chrome rather than a new section. */
  .prefs {
    display: flex;
    flex-direction: column;
    gap: var(--sp-space-2);
    padding: var(--sp-space-2) var(--sp-space-3);
    border-top: var(--sp-hairline) solid var(--sp-border);
    background: var(--sp-bg-subtle);
  }

  /* The footer's links travel as one item, so space-between still lays the
     row out as links / toggle / version. Wraps rather than overflows if a
     translation runs long at the 320px minimum. */
  .links {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 var(--sp-space-1);
    min-width: 0;
  }

  /* panel.css gives .sp-iconbtn no disabled look, because until the rate-limit
     wait no icon button could be disabled. Without one it keeps its hover fill
     and pointer over a control that does nothing. The :hover twin is there to
     outrank panel.css's own .sp-panel .sp-iconbtn:hover. */
  .sp-iconbtn:disabled,
  .sp-iconbtn:disabled:hover {
    cursor: default;
    background: transparent;
    color: var(--sp-text-faint);
  }
</style>
