<script lang="ts">
  import Section from "./Section.svelte";
  import { i18n } from "#i18n";

  // The design bundle never mentions Infrastructure -- no component, no mockup
  // -- but it ships: /api/v1/detect returns it as its own array and the admin
  // counts it as its own kind (extension-panel design D3). So it deliberately
  // mirrors Trackers rather than inventing a second look for the same shape of
  // data. The Section wrapper and the shared .sp-badges / .sp-badge classes are
  // what hold the two in step.
  //
  // Unlike Trackers, an empty array renders nothing at all. "No infrastructure
  // detected" is not a finding about the store, it is a gap in what we can see.
  let { items = [] }: { items?: { name: string }[] } = $props();
</script>

{#if items.length}
  <Section id="infrastructure" heading={i18n.t("infrastructure.heading")} count={items.length}>
    <ul class="sp-badges">
      {#each items as item (item.name)}
        <li class="sp-badge">{item.name}</li>
      {/each}
    </ul>
  </Section>
{/if}
