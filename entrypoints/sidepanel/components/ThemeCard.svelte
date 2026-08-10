<script lang="ts">
  import Section from "./Section.svelte";

  type Theme = {
    name?: string;
    version?: string;
    origin?: "catalog" | "forked" | "custom" | "headless";
    price?: string;
    theme_url?: string;
  };
  let { theme }: { theme?: Theme } = $props();

  // catalog and forked are the two origins that name a real catalog theme, so
  // they are the two that can carry a version and link to a listing. custom and
  // headless are deliberate non-answers -- there is nothing to link to.
  const isDetected = $derived(theme?.origin === "catalog" || theme?.origin === "forked");

  // Unlike the design bundle's reference component, a custom theme keeps the
  // name the merchant gave it: our detector returns it, and dropping data we
  // hold to render a generic label is a regression. The origin chip in
  // .sp-count says "custom", so nothing here claims a catalog match.
  // headless is different in kind, not in policy: the service returns no name
  // for it at all, so the label is the only thing there is to show.
  const title = $derived(
    theme?.origin === "headless"
      ? "Headless storefront"
      : theme?.name || (theme?.origin === "custom" ? "Custom theme" : "Unknown theme"),
  );
</script>

{#if theme}
  <Section id="theme" heading="Theme" count={theme.origin}>
    <div
      class="sp-theme"
      class:sp-theme--plain={theme.origin === "custom"}
      class:sp-theme--dashed={theme.origin === "headless"}
    >
      <div class="sp-theme__top">
        {#if isDetected && theme.theme_url}
          <a class="sp-theme__name" href={theme.theme_url} target="_blank" rel="noreferrer">{title}</a>
        {:else}
          <span class="sp-theme__name">{title}</span>
        {/if}
        {#if isDetected && theme.version}
          <span class="sp-theme__version">{theme.version}</span>
        {/if}
      </div>

      {#if theme.origin === "forked"}
        <div class="sp-theme__meta">
          <span class="sp-theme__mod">customized</span>
          <span class="sp-sep" aria-hidden="true">·</span>
          <span>{theme.price ?? "Free"}</span>
        </div>
        <span class="sr">Forked from {theme.name} and modified.</span>
      {:else if theme.origin === "catalog"}
        <div class="sp-theme__meta">
          <span>{theme.price ?? "Free"}</span>
          <span class="sp-sep" aria-hidden="true">·</span>
          <span>store theme</span>
        </div>
      {:else if theme.origin === "custom"}
        <p class="sp-theme__note">Built for this store — no catalog match.</p>
      {:else}
        <p class="sp-theme__note">Theme not detectable — the storefront is decoupled from Shopify's theme layer.</p>
      {/if}
    </div>
  </Section>
{/if}

<style>
  /* The one rule panel.css genuinely lacks (design D1): a visually-hidden
     helper, so the fork relationship reaches a screen reader without a second
     visible line competing with the card. Deliberately not sp- prefixed --
     that prefix means "defined in panel.css", and this is not. */
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
