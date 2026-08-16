<script lang="ts">
  import type { CatalogueEntry } from "../../../lib/catalogue_types";
  import Section from "./Section.svelte";
  import { i18n } from "#i18n";
  import { money } from "../../../lib/format";

  let {
    products = [],
    currency = null,
  }: {
    products?: CatalogueEntry[];
    currency?: string | null;
  } = $props();

  const COLLAPSED = 5;

  let expanded = $state(false);
  const shown = $derived(expanded ? products : products.slice(0, COLLAPSED));

  // The entry's price arrives as a string from the feed. Parsing is this
  // component's job; formatting is lib/format's, which is where the second copy
  // of this Intl.NumberFormat call used to live.
  function price(raw: string | null): string {
    if (raw === null) return "";
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return "";
    return money(value, currency);
  }
</script>

<!-- Fewer than two entries cannot demonstrate a ranking, and the digest already
     returns [] when the sort was not honoured. Either way the section is absent
     rather than empty (design D3). -->
{#if products.length >= 2}
  <Section id="best-sellers" heading={i18n.t("bestSellers.heading")} count={products.length}>
    <ol class="sp-bs">
      {#each shown as product, i (product.handle)}
        <li>
          <span class="sp-rank">{i + 1}</span>
          <span class="sp-bs-name">{product.title}</span>
          <span class="sp-price">{price(product.price)}</span>
        </li>
      {/each}
    </ol>

    {#if products.length > COLLAPSED}
      <button
        class="sp-foot-note"
        type="button"
        aria-expanded={expanded}
        onclick={() => (expanded = !expanded)}
      >{expanded ? i18n.t("bestSellers.showFewer") : i18n.t("bestSellers.showMore", [String(products.length - COLLAPSED)])}</button>
    {/if}
  </Section>
{/if}
