<script lang="ts">
  import { i18n } from "#i18n";
  import Switch from "./Switch.svelte";
  import { heldLinkClick } from "../../../lib/held_tabs";
  import { SHORTCUT_SETTINGS_URL } from "../../../lib/shortcut";

  // keyText is "" when no key is bound. Firefox can bind and unbind from here;
  // Chrome only from its own shortcuts page, so there the row links to it.
  let { keyText, canToggle, onchange }: { keyText: string; canToggle: boolean; onchange: (on: boolean) => void } = $props();
</script>

{#if canToggle}
  <Switch checked={keyText !== ""} onclick={() => onchange(keyText === "")}>
    <span>{i18n.t("shortcut.label")}</span>
    {#if keyText}<kbd>{keyText}</kbd>{/if}
  </Switch>
{:else}
  <p class="row">
    {#if keyText}
      <span>{i18n.t("shortcut.label")}</span>
      <kbd>{keyText}</kbd>
    {:else}
      <span>{i18n.t("shortcut.none")}</span>
    {/if}
    <span class="sp-sep" aria-hidden="true">·</span>
    <a href={SHORTCUT_SETTINGS_URL} target="_blank" rel="noreferrer" onclick={heldLinkClick}>
      {keyText ? i18n.t("shortcut.change") : i18n.t("shortcut.set")}
    </a>
  </p>
{/if}

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 var(--sp-space-1);
    font-size: var(--sp-fs-xs);
    color: var(--sp-text-muted);
  }
  .row a { color: var(--sp-text-muted); text-decoration: none; }
  .row a:hover { color: var(--sp-text); text-decoration: underline; }
  kbd {
    font-family: var(--sp-font-mono);
    font-size: var(--sp-fs-micro);
    padding: 0 var(--sp-space-1);
    border: var(--sp-hairline) solid var(--sp-border-strong);
    border-radius: var(--sp-radius-sm);
    color: var(--sp-text);
  }
</style>
