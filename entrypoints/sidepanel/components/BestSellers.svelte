<script lang="ts">
  import type { CatalogueEntry } from "../../../lib/catalogue_types";
  import Section from "./Section.svelte";

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

  // Same rule as the Products section: no currency means no symbol, never a
  // guessed one (design D8).
  function money(price: string | null): string {
    if (price === null) return "";
    const value = Number.parseFloat(price);
    if (!Number.isFinite(value)) return "";
    if (!currency) return value.toFixed(2);
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
    } catch {
      return value.toFixed(2);
    }
  }
</script>

<!-- Fewer than two entries cannot demonstrate a ranking, and the digest already
     returns [] when the sort was not honoured. Either way the section is absent
     rather than empty (design D3). -->
{#if products.length >= 2}
  <Section id="best-sellers" heading="Best sellers" count={products.length}>
    <ol class="sp-bs">
      {#each shown as product, i (product.handle)}
        <li>
          <span class="sp-rank">{i + 1}</span>
          <span class="sp-bs-name">{product.title}</span>
          <span class="sp-price">{money(product.price)}</span>
        </li>
      {/each}
    </ol>

    {#if products.length > COLLAPSED}
      <button
        class="sp-foot-note"
        type="button"
        aria-expanded={expanded}
        onclick={() => (expanded = !expanded)}
      >{expanded ? "Show fewer" : `Show ${products.length - COLLAPSED} more`}</button>
    {/if}
  </Section>
{/if}
