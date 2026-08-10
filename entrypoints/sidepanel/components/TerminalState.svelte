<script lang="ts">
  import type { TerminalStatus } from "../../../lib/panel_status";

  let { status, onretry }: { status: TerminalStatus; onretry: () => void } = $props();

  // Design D7's table, verbatim. Two things it settles:
  //
  //   - cant_scan gets no action. Nothing about the page will change by asking
  //     again, and the header hides its rescan button for the same reason.
  //   - rate limiting is its own status rather than an error with a different
  //     message, so it can carry its own code chip and copy. The bundle's
  //     "retry after" row is omitted: RateLimitError carries no such value --
  //     the API sends no Retry-After we read -- and a guess would be worse
  //     than silence.
  const STATES = {
    not_shopify: {
      code: "no match",
      title: "Not a Shopify store.",
      body: "Stackpeek only reads Shopify storefronts. Nothing was sent to the API.",
      action: "Scan again",
      variant: "sp-btn--quiet",
      role: "status",
    },
    cant_scan: {
      code: "unreadable page",
      title: "Can't scan this page.",
      body: "Browser pages, the Web Store and PDFs are closed to extensions. Open a storefront tab and try there.",
      action: null,
      variant: null,
      role: "status",
    },
    error: {
      code: "network",
      title: "Couldn't reach the detector.",
      body: "The page signals were read; the API didn't answer. Nothing was stored.",
      action: "Retry",
      variant: "sp-btn--primary",
      role: "alert",
    },
    rate_limited: {
      code: "429",
      title: "Please slow down and try again.",
      body: "Too many scans in a short window. The limit resets on its own.",
      action: "Retry",
      variant: "sp-btn--primary",
      role: "alert",
    },
    needs_permission: {
      code: "permission",
      title: "Open Stackpeek on this store.",
      body: "Click the Stackpeek icon in the toolbar to scan this page. Chrome grants access one store at a time, which is why the panel cannot do it for you.",
      action: null,
      variant: null,
      role: "status",
    },
  } as const;

  const state = $derived(STATES[status]);
</script>

<div class="sp-state" role={state.role}>
  <span class="sp-state__code">{state.code}</span>
  <h2 class="sp-state__title">{state.title}</h2>
  <p class="sp-state__body">{state.body}</p>
  {#if state.action}
    <button class="sp-btn {state.variant}" type="button" onclick={onretry}>{state.action}</button>
  {/if}
</div>
