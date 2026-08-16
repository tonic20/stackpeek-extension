<script lang="ts">
  import type { TerminalStatus } from "../../../lib/panel_status";
  import { i18n } from "#i18n";

  let { status, domain = "", onretry }:
    { status: TerminalStatus; domain?: string; onretry: () => void } = $props();

  // Design D7's table, verbatim. The copy lives in locales/en.yml now; what
  // stays here is the mapping from status to keys, and the two rules it
  // settles:
  //
  //   - cant_scan gets no action. Nothing about the page will change by asking
  //     again, and the header hides its rescan button for the same reason.
  //   - rate limiting is its own status rather than an error with a different
  //     message, so it can carry its own code chip and copy. The bundle's
  //     "retry after" row is omitted: RateLimitError carries no such value --
  //     the API sends no Retry-After we read -- and a guess would be worse
  //     than silence.
  //
  // The keys are spelled out per status rather than built as
  // `terminal.${status}.title`: a template literal would still typecheck
  // against the generated key union, but it would also silently accept a
  // renamed status as a runtime lookup failure rather than a compile error.
  const STATES = {
    not_shopify: {
      code: "terminal.notShopify.code",
      title: "terminal.notShopify.title",
      // NOT "nothing was sent": the page's signals are sent on every scan --
      // is_shopify is a field in the API *response*, so the panel cannot know a
      // page is not Shopify until the server has seen the signals
      // (lib/detect_runner.ts:109).
      //
      // And NOT a flat "nothing was stored". The negation is scoped to the PAGE
      // because that is exactly how far it holds: DetectController#create
      // enqueues RecordDetectionJob only when the page turned out to be
      // Shopify, but it calls Install.touch_detection on every final round,
      // outside that guard -- which upserts the anonymous install row's
      // detect_count and last_seen_at. Something IS written here; it just knows
      // nothing about the page. The privacy page and the store listing both
      // disclose that counter, and the panel must not deny what they disclose.
      body: "terminal.notShopify.body",
      action: "terminal.notShopify.action",
      variant: "sp-btn--quiet",
      role: "status",
    },
    cant_scan: {
      code: "terminal.cantScan.code",
      title: "terminal.cantScan.title",
      body: "terminal.cantScan.body",
      action: null,
      variant: null,
      role: "status",
    },
    error: {
      code: "terminal.error.code",
      title: "terminal.error.title",
      body: "terminal.error.body",
      action: "terminal.error.action",
      variant: "sp-btn--primary",
      role: "alert",
    },
    rate_limited: {
      code: "terminal.rateLimited.code",
      title: "terminal.rateLimited.title",
      body: "terminal.rateLimited.body",
      action: "terminal.rateLimited.action",
      variant: "sp-btn--primary",
      role: "alert",
    },
    needs_permission: {
      code: "terminal.needsPermission.code",
      title: "terminal.needsPermission.title",
      body: "terminal.needsPermission.body",
      action: null,
      variant: null,
      role: "status",
    },
  } as const;

  // Our own site. An explicit list rather than a substring or suffix test:
  // "notstackpeek.app" belongs to someone else and gets the ordinary answer.
  const OWN_HOSTS = ["stackpeek.app", "www.stackpeek.app"];
  const isOurs = $derived(status === "not_shopify" && OWN_HOSTS.includes(domain));

  // The script-count claim in terminal.ours.body is checked against the real
  // page: backend/app/views/layouts/application.html.erb loads exactly one
  // third-party script, the Cloudflare Insights beacon. If a script is added
  // or removed there, re-check that string in locales/en.yml -- and no test can
  // do that for you, because extension/ is published standalone to the public
  // mirror where backend/ does not exist, so a test reading across the repo
  // would fail for anyone who cloned it. A matching comment sits at the other
  // end. (This comment does not vouch for the hosting description in the same
  // sentence; that is verified independently against backend/config/deploy.yml
  // and backend/app/views/pages/privacy.html.erb.)
  const keys = $derived(isOurs ? {
    code: "terminal.ours.code",
    title: "terminal.ours.title",
    body: "terminal.ours.body",
    action: "terminal.ours.action",
    variant: "sp-btn--quiet",
    role: "status",
  } as const : STATES[status]);

  const state = $derived({
    code: i18n.t(keys.code),
    title: i18n.t(keys.title),
    body: i18n.t(keys.body),
    action: keys.action === null ? null : i18n.t(keys.action),
    variant: keys.variant,
    role: keys.role,
  });
</script>

<div class="sp-state" role={state.role}>
  <span class="sp-state__code">{state.code}</span>
  <h2 class="sp-state__title">{state.title}</h2>
  <p class="sp-state__body">{state.body}</p>
  {#if state.action}
    <button class="sp-btn {state.variant}" type="button" onclick={onretry}>{state.action}</button>
  {/if}
</div>
