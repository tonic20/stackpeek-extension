<script lang="ts">
  import { i18n } from "#i18n";

  // onaccept must reach permissions.request before anything is awaited, so it
  // is called straight from the click handler, as AutoScanSwitch does.
  let { onaccept, ondismiss }: { onaccept: () => void; ondismiss: () => void } = $props();

  const titleId = `sp-offer-${Math.random().toString(36).slice(2)}`;
</script>

<section class="offer" aria-labelledby={titleId}>
  <h2 class="title" id={titleId}>{i18n.t("autoScan.offer.title")}</h2>
  <p class="body">{i18n.t("autoScan.offer.body")}</p>
  <div class="actions">
    <button type="button" class="sp-btn sp-btn--quiet" onclick={onaccept}>{i18n.t("autoScan.offer.accept")}</button>
    <button type="button" class="later" onclick={ondismiss}>{i18n.t("autoScan.offer.dismiss")}</button>
  </div>
</section>

<style>
  .offer {
    display: flex;
    flex-direction: column;
    gap: var(--sp-space-2);
    padding: var(--sp-space-3);
    border-bottom: var(--sp-hairline) solid var(--sp-border);
    background: var(--sp-bg-subtle);
  }
  .title {
    font-size: var(--sp-fs-sm);
    font-weight: var(--sp-fw-semibold);
  }
  .body {
    font-size: var(--sp-fs-xs);
    color: var(--sp-text-muted);
    text-wrap: pretty;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-space-3);
  }
  .later {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-size: var(--sp-fs-xs);
    color: var(--sp-text-muted);
    cursor: pointer;
  }
  .later:hover { color: var(--sp-text); }
</style>
