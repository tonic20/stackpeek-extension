<script lang="ts">
  import type { CatalogueDigest, ExportState } from "../../../lib/catalogue_types";
  import { EXPORT_CEILING } from "../../../lib/export_limits";
  import Section from "./Section.svelte";
  import { i18n } from "#i18n";
  import { number as n, money, daysAgo } from "../../../lib/format";

  let {
    digest,
    state = "idle",
    progress = null,
    filename = null,
    onexport,
    onretryread,
  }: {
    // null means the catalogue is still being read. Distinct from an
    // unavailable digest, which is a settled answer.
    digest: CatalogueDigest | null;
    state?: ExportState;
    // total is null when the catalogue's size could not be read: the export
    // still runs, it just has no denominator to count towards, so the note
    // reports what has been exported and the track is omitted rather than
    // drawn against a made-up total.
    progress?: { done: number; total: number | null } | null;
    filename?: string | null;
    onexport: () => void;
    // Re-attempts the READ, not an export -- reusing onexport here made the
    // button silently no-op, since runExport bails on `!digest?.available`
    // and an unreadable digest is exactly that.
    onretryread: () => void;
  } = $props();

  const priceRange = $derived(
    !digest || digest.priceMin === null || digest.priceMax === null
      ? "—"
      : i18n.t("products.range", [
          money(digest.priceMin, digest.currency),
          money(digest.priceMax, digest.currency),
        ]),
  );

  const READING = i18n.t("products.reading");

  const meta = $derived(
    state === "fetching" && progress
      // A total we never read is not a total. "250 / 250" while the walk is
      // still going would be a wrong answer dressed as a precise one.
      ? (progress.total === null
          ? i18n.t("products.exported", [n(progress.done)])
          : i18n.t("products.progress", [n(progress.done), n(progress.total)]))
    : state === "done" && filename ? filename
    : state === "error" ? i18n.t("products.unreadable")
    : !digest ? READING
    // An unknown size renders no size. The catalogue is readable -- the export
    // below works -- but the Storefront path takes its count from the sitemap,
    // and a sitemap that 403s leaves us with nothing to say about how big the
    // store is. "0 products" here would be a false statement about the
    // merchant, not a missing one.
    : digest.count === null ? i18n.t("products.importFormat")
    // A truncated export that says nothing is the silent failure this line
    // exists to remove: the count is the store's real total, so the export's
    // ceiling has to be stated beside it rather than left to be discovered in
    // the file.
    : digest.capped
      ? i18n.t("products.countExportsFirst", [n(digest.count), n(EXPORT_CEILING)])
      : i18n.t("products.countImportFormat", [n(digest.count)]),
  );

  // The only indeterminate branch above. Every other state is a settled answer,
  // and the export reports itself with a determinate bar, which is a better
  // instrument than a spinner wherever the total is known.
  //
  // Derived FROM meta rather than by re-testing digest and state: the spinner
  // and the words beside it must name the same moment, and two copies of that
  // condition are two things to keep in step.
  const reading = $derived(meta === READING);
</script>

<!-- Empty while loading rather than 0: a count of zero is a wrong answer, not a
     pending one (design D12). Empty for the same reason when the catalogue is
     readable but its size is not: an unread count and a count of zero are
     different facts, and only one of them is ours to state. -->
<Section id="products" heading={i18n.t("products.heading")} count={digest?.available && digest.count !== null ? n(digest.count) : ""}>
  {#if digest && !digest.available}
    {#if digest.reason === "unreadable"}
      <p class="sp-quiet">{i18n.t("products.unreadable")}</p>
      <button class="sp-btn sp-btn--quiet" type="button" onclick={onretryread}>{i18n.t("products.retry")}</button>
    {:else}
      <p class="sp-quiet">{i18n.t("products.notPublic")}</p>
    {/if}
  {:else}
    <div class="sp-facts">
      <div class="sp-fact">
        <span class="sp-fact__k">{i18n.t("products.priceRange")}</span>
        <span class="sp-fact__v">{priceRange}</span>
      </div>
      <div class="sp-fact">
        <span class="sp-fact__k">{i18n.t("products.variants")}</span>
        <span class="sp-fact__v">{digest && digest.variants !== null ? n(digest.variants) : "—"}</span>
      </div>
      <div class="sp-fact">
        <span class="sp-fact__k">{i18n.t("products.newest")}</span>
        <span class="sp-fact__v">{(digest ? daysAgo(digest.newest) : null) ?? "—"}</span>
      </div>
    </div>

    {#if state === "error"}
      <button class="sp-btn sp-btn--quiet" type="button" onclick={onexport}>{i18n.t("products.retry")}</button>
    {:else}
      <!-- Its own variant, never the accent: the accent stays reserved for the
           theme card (product-catalogue design D11). -->
      <button
        class="sp-btn sp-btn--export"
        type="button"
        disabled={!digest || state === "fetching"}
        aria-busy={state === "fetching"}
        onclick={onexport}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 2v8M4.5 7 8 10.5 11.5 7M2.5 13h11"></path></svg>
        {i18n.t("products.export")}
      </button>
    {/if}

    <!-- No track without a total. A determinate bar is a claim about how much
         is left; with an unread count there is nothing to draw it against, and
         the note above still reports what has been exported. -->
    {#if state === "fetching" && progress && progress.total !== null}
      <div class="sp-track">
        <div class="sp-fill" style="width:{((progress.done / progress.total) * 100).toFixed(4)}%"></div>
      </div>
    {/if}

    <!-- Same spinner as the header's "Scanning…", for the same reason: both are
         waits with no known end. Reusing .sp-spinner also inherits its
         reduced-motion rule, which a second spinner would have to repeat. -->
    <p class="sp-foot-note" class:sp-foot-note--busy={reading} aria-live="polite">
      {#if reading}<span class="sp-spinner" aria-hidden="true"></span>{/if}{meta}
    </p>
  {/if}
</Section>
