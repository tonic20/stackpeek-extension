<script lang="ts">
  import Section from "./Section.svelte";
  import { i18n } from "#i18n";

  // Always renders, empty or not: a store with no tracking is a finding, not an
  // absence, and saying so is the point of the section.
  let {
    items = [],
    unknownDomainCount = 0,
  }: {
    items?: { name: string }[];
    unknownDomainCount?: number;
  } = $props();
</script>

<Section id="trackers" heading={i18n.t("trackers.heading")} count={items.length}>
  {#if items.length}
    <ul class="sp-badges">
      {#each items as item (item.name)}
        <li class="sp-badge">{item.name}</li>
      {/each}
    </ul>
  {:else}
    <p class="sp-quiet">{i18n.t("trackers.none")}</p>
  {/if}

  <!-- Trackers only. Infrastructure has no equivalent: unknown domains are
       triaged into apps and trackers, never into infrastructure. -->
  {#if unknownDomainCount > 0}
    <p class="sp-quiet">
      {i18n.t("trackers.unidentified", unknownDomainCount, [String(unknownDomainCount)])}
    </p>
  {/if}
</Section>
