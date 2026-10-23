<script lang="ts">
  import Section from "./Section.svelte";
  import { heldLinkClick } from "../../../lib/held_tabs";
  import { i18n } from "#i18n";
  import { isCatalogMatch, themeTitle } from "../../../lib/theme_title";

  type Theme = {
    name?: string;
    version?: string;
    origin?: "catalog" | "forked" | "custom" | "headless";
    price?: string;
    theme_url?: string;
  };
  let { theme }: { theme?: Theme } = $props();

  // Shared with the Markdown report (lib/theme_title.ts), which names the
  // theme the same way.
  const isDetected = $derived(theme ? isCatalogMatch(theme) : false);

  // The corner slot showed theme.origin verbatim, which left one English word
  // ("catalog") in an otherwise translated panel. Mapped rather than looked up
  // as `theme.origin.${origin}`: i18n.t() throws on an unknown key under
  // test/setup.ts, so an origin the service adds later would fail a render
  // instead of degrading. An unmapped origin falls through to the raw value,
  // which is what shipped before this and is still better than a blank corner.
  const ORIGIN_MESSAGES = {
    catalog: "theme.origin.catalog",
    forked: "theme.origin.forked",
    custom: "theme.origin.custom",
    headless: "theme.origin.headless",
  } as const;

  const origin = $derived.by(() => {
    const value = theme?.origin;
    if (!value) return "";
    const key = ORIGIN_MESSAGES[value as keyof typeof ORIGIN_MESSAGES];
    return key ? i18n.t(key) : value;
  });

  const title = $derived(theme ? themeTitle(theme) : "");
</script>

{#if theme}
  <Section id="theme" heading={i18n.t("theme.heading")} count={origin}>
    <div
      class="sp-theme"
      class:sp-theme--plain={theme.origin === "custom"}
      class:sp-theme--dashed={theme.origin === "headless"}
    >
      <div class="sp-theme__top">
        {#if isDetected && theme.theme_url}
          <a class="sp-theme__name" href={theme.theme_url} target="_blank" rel="noreferrer" onclick={heldLinkClick}>{title}</a>
        {:else}
          <span class="sp-theme__name">{title}</span>
        {/if}
        {#if isDetected && theme.version}
          <span class="sp-theme__version">{theme.version}</span>
        {/if}
      </div>

      {#if theme.origin === "forked"}
        <div class="sp-theme__meta">
          <span class="sp-theme__mod">{i18n.t("theme.customized")}</span>
          <span class="sp-sep" aria-hidden="true">·</span>
          <span>{theme.price ?? i18n.t("theme.free")}</span>
        </div>
        <span class="sr">{i18n.t("theme.forkedFrom", [theme.name ?? ""])}</span>
      {:else if theme.origin === "catalog"}
        <div class="sp-theme__meta">
          <span>{theme.price ?? i18n.t("theme.free")}</span>
          <span class="sp-sep" aria-hidden="true">·</span>
          <span>{i18n.t("theme.storeTheme")}</span>
        </div>
      {:else if theme.origin === "custom"}
        <p class="sp-theme__note">{i18n.t("theme.customNote")}</p>
      {:else}
        <p class="sp-theme__note">{i18n.t("theme.headlessNote")}</p>
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
