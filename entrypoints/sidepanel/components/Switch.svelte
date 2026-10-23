<script lang="ts">
  import type { Snippet } from "svelte";

  let { checked, describedby, onclick, children }:
    { checked: boolean; describedby?: string; onclick: () => void; children: Snippet } = $props();
</script>

<button type="button" role="switch" class="switch" aria-checked={checked} aria-describedby={describedby} {onclick}>
  <span class="track" aria-hidden="true"><span class="knob"></span></span>
  {@render children()}
</button>

<style>
  /* A switch drawn from the panel's own parts: hairline border, small radius,
     text colours only. Not a pill -- the brief rules those out everywhere --
     and not the accent, which belongs to the detected theme. */
  .switch {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-space-2);
    align-self: flex-start;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-size: var(--sp-fs-xs);
    color: var(--sp-text-muted);
    text-align: left;
    cursor: pointer;
  }
  .switch:hover { color: var(--sp-text); }
  .track {
    flex: none;
    display: inline-flex;
    align-items: center;
    width: 22px;
    height: 12px;
    padding: 1px;
    box-sizing: border-box;
    border: var(--sp-hairline) solid var(--sp-border-strong);
    border-radius: var(--sp-radius-sm);
    background: var(--sp-bg);
    transition: background-color var(--sp-dur-fast) var(--sp-ease);
  }
  .knob {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: var(--sp-text-faint);
    transition: transform var(--sp-dur-fast) var(--sp-ease);
  }
  .switch[aria-checked="true"] .track {
    background: var(--sp-text);
    border-color: var(--sp-text);
  }
  .switch[aria-checked="true"] .knob {
    background: var(--sp-bg);
    transform: translateX(10px);
  }
</style>
