<script lang="ts">
  import { i18n } from "#i18n";
  import Switch from "./Switch.svelte";

  // The opt-in for access to every site (lib/host_access.ts). Presentational:
  // App owns whether access is granted, because App is also what rescans the
  // moment it is.
  //
  // onchange must reach permissions.request without awaiting anything first
  // -- the click is the user gesture both engines require, and it ends at the
  // first await -- so it is called straight from the click handler.
  let { checked, onchange }: { checked: boolean; onchange: (on: boolean) => void } = $props();

  // The note is the disclosure, so it shows wherever the switch can be turned
  // ON. Once on, the user has read it and the browser's own prompt has
  // restated it; the switch alone then says how to turn it off.
  const noteId = `sp-autoscan-note-${Math.random().toString(36).slice(2)}`;
</script>

<div class="auto">
  <Switch {checked} describedby={checked ? undefined : noteId} onclick={() => onchange(!checked)}>
    <span>{i18n.t("autoScan.label")}</span>
  </Switch>
  {#if !checked}
    <p class="note" id={noteId}>{i18n.t("autoScan.note")}</p>
  {/if}
</div>

<style>
  .auto {
    display: flex;
    flex-direction: column;
    gap: var(--sp-space-1);
    min-width: 0;
  }
  .note {
    font-size: var(--sp-fs-xs);
    color: var(--sp-text-faint);
    text-wrap: pretty;
  }
</style>
