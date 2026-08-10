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
  import type { CatalogueDigest, CatalogueEntry, CatalogueProduct, CollectionPages, ExportState } from "../../lib/catalogue_types";
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
    cataloguePage = fetchCataloguePage,
    collectionPages = fetchCollectionPages,
  }: {
    runner?: () => Promise<{ signals: unknown; url: string | undefined }>;
    autostart?: boolean;
    delays?: number[];
    watch?: (onChange: () => void) => { stop: () => void };
    catalogue?: () => Promise<CatalogueDigest>;
    cataloguePage?: (page: number) => Promise<CatalogueProduct[] | null>;
    collectionPages?: () => Promise<CollectionPages | null>;
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

  let exportState: ExportState = $state("idle");
  let exportProgress: { done: number; total: number } | null = $state(null);
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
    bestSellers = [];
    exportState = "idle";
    exportProgress = null;
    exportFilename = null;

    const result = await catalogue();
    // A store change mid-read makes this answer stale; the newer load owns the
    // slot and this one is dropped.
    if (digestDomain !== host) return;
    digest = result;

    // Ranked after the digest, not with it: the ranking is optional and slower,
    // and the summary must never wait on it.
    const pages = await collectionPages();
    if (digestDomain === host) bestSellers = rankCatalogue(pages, result, BEST_SELLER_LIMIT);
  }

  async function runExport() {
    if (!digest?.available) return;
    exportState = "fetching";
    // Cleared on entry, not merely on success: a second export from the `done`
    // state otherwise carries the previous run's filename in memory, waiting
    // for something to render it.
    exportFilename = null;
    exportProgress = { done: 0, total: digest.count };

    const products: CatalogueProduct[] = [];
    for (let page = 1; page <= 40; page++) {
      const batch = await cataloguePage(page);
      if (batch === null) { exportState = "error"; exportProgress = null; return; }
      products.push(...batch);
      exportProgress = { done: products.length, total: Math.max(digest.count, products.length) };
      if (batch.length < 250) break;
    }

    exportFilename = catalogueFilename(domain, new Date());
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
      />
      <BestSellers products={bestSellers} currency={digest?.currency ?? null} />
    {:else if status !== "idle"}
      <!-- The cast, not narrowing: svelte2tsx compiles each branch separately,
           so it does not carry "not loading, not result, not idle" into the
           child's prop type. PanelStatus minus those three IS TerminalStatus,
           and the branch conditions above are the proof. -->
      <TerminalState status={status as TerminalStatus} onretry={() => runDetection()} />
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
