<script lang="ts">
  import type { TerminalStatus } from "../../../lib/panel_status";
  import { clock, inSeconds } from "../../../lib/format";
  import { i18n } from "#i18n";
  import type { Snippet } from "svelte";

  // retryAt is when the panel will next let a scan through (App.svelte's rate
  // limit wait), as a timestamp; 0 when nothing is holding it back.
  // children is whatever the caller adds under the copy -- today, the
  // auto-scan switch App offers beside needs_permission. The state does not
  // need to know what it is.
  let { status, domain = "", retryAt = 0, onretry, children }:
    { status: TerminalStatus; domain?: string; retryAt?: number; onretry: () => void; children?: Snippet } = $props();

  // Ticks only while there is something to count down. A quarter second, not a
  // full one, so the display turns over close to the real boundary instead of
  // up to a second late; the DOM only changes when the second does.
  let now = $state(Date.now());
  $effect(() => {
    if (retryAt <= Date.now()) return;
    now = Date.now();
    const tick = setInterval(() => { now = Date.now(); }, 250);
    return () => clearInterval(tick);
  });
  const remaining = $derived(Math.max(0, Math.ceil((retryAt - now) / 1000)));

  // The same wait, said once for a screen reader. The state is an alert, and
  // an alert re-reads its whole content whenever any of it changes, so a
  // ticking number inside it would be announced every second. The visible
  // countdown is aria-hidden for that reason, and this sentence is computed
  // when the wait starts -- Date.now() is not reactive, so it does not tick.
  const waitNote = $derived.by(() => {
    const seconds = Math.ceil((retryAt - Date.now()) / 1000);
    return seconds > 0 ? i18n.t("terminal.wait", [inSeconds(seconds)]) : "";
  });

  // Design D7's table, verbatim. The copy lives in locales/en.yml now; what
  // stays here is the mapping from status to keys, and the two rules it
  // settles:
  //
  //   - cant_scan gets no action. Nothing about the page will change by asking
  //     again, and the header hides its rescan button for the same reason.
  //   - rate limiting is its own status rather than an error with a different
  //     message, so it can carry its own code chip and copy. The bundle's
  //     "retry after" row is still omitted. The wait is real now -- Retry is
  //     disabled through it, with a countdown on the button -- but it is our
  //     default unless the API sends Retry-After, and a row stating it as the
  //     server's figure would claim more than we know.
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
      // The state was a flat dead end. This is the one thing worth adding: what
      // the detector reads, and the two honest reasons a store could still be
      // Shopify -- a headless build may show the page no Shopify signals, and a
      // page still loading may not show them yet, which is what Scan again is
      // for. Nothing beyond that is known, so nothing beyond that is said.
      hint: "terminal.notShopify.hint",
      action: "terminal.notShopify.action",
      variant: "sp-btn--quiet",
      role: "status",
    },
    cant_scan: {
      code: "terminal.cantScan.code",
      title: "terminal.cantScan.title",
      body: "terminal.cantScan.body",
      hint: null,
      action: null,
      variant: null,
      role: "status",
    },
    error: {
      code: "terminal.error.code",
      title: "terminal.error.title",
      body: "terminal.error.body",
      hint: null,
      action: "terminal.error.action",
      variant: "sp-btn--primary",
      role: "alert",
    },
    // The three below split what used to be the one "error" state, each with
    // the advice that fits it (lib/api.ts). All keep Retry: every one of them
    // can come right on its own.
    offline: {
      code: "terminal.offline.code",
      title: "terminal.offline.title",
      body: "terminal.offline.body",
      hint: null,
      action: "terminal.offline.action",
      variant: "sp-btn--primary",
      role: "alert",
    },
    // No figure in the copy. "15 seconds" would be true only until someone
    // tunes DETECT_TIMEOUT_MS, and a translated number of seconds needs plural
    // forms for a fact the user does not need.
    timeout: {
      code: "terminal.timeout.code",
      title: "terminal.timeout.title",
      body: "terminal.timeout.body",
      hint: null,
      action: "terminal.timeout.action",
      variant: "sp-btn--primary",
      role: "alert",
    },
    // Says whose fault it is, because that is the useful part: the user's
    // connection is fine and so is the store, and without saying so the
    // natural next step is to go and check both.
    server_error: {
      code: "terminal.serverError.code",
      title: "terminal.serverError.title",
      body: "terminal.serverError.body",
      hint: null,
      action: "terminal.serverError.action",
      variant: "sp-btn--primary",
      role: "alert",
    },
    rate_limited: {
      code: "terminal.rateLimited.code",
      title: "terminal.rateLimited.title",
      body: "terminal.rateLimited.body",
      hint: null,
      action: "terminal.rateLimited.action",
      variant: "sp-btn--primary",
      role: "alert",
    },
    needs_permission: {
      code: "terminal.needsPermission.code",
      title: "terminal.needsPermission.title",
      body: "terminal.needsPermission.body",
      hint: null,
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
    hint: null,
    action: "terminal.ours.action",
    variant: "sp-btn--quiet",
    role: "status",
  } as const : STATES[status]);

  // `view`, not `state`: a component variable named `state` makes `$state`
  // read as a store subscription to it, and the countdown above needs the rune.
  const view = $derived({
    code: i18n.t(keys.code),
    title: i18n.t(keys.title),
    body: i18n.t(keys.body),
    hint: keys.hint === null ? null : i18n.t(keys.hint),
    action: keys.action === null ? null : i18n.t(keys.action),
    variant: keys.variant,
    role: keys.role,
  });
</script>

<div class="sp-state" role={view.role}>
  <span class="sp-state__code">{view.code}</span>
  <h2 class="sp-state__title">{view.title}</h2>
  <p class="sp-state__body">{view.body}</p>
  {#if view.hint}
    <p class="sp-state__body">{view.hint}</p>
  {/if}
  {@render children?.()}
  {#if waitNote}
    <p class="sr">{waitNote}</p>
  {/if}
  {#if view.action}
    <!-- The label stays the action's own word; the count beside it is
         decoration for sighted users and is hidden from the accessible name,
         which would otherwise change every second under the user's focus. -->
    <button class="sp-btn {view.variant}" type="button" disabled={remaining > 0} onclick={onretry}>
      {view.action}{#if remaining > 0}<span class="countdown" aria-hidden="true">{clock(remaining)}</span>{/if}
    </button>
  {/if}
</div>

<style>
  /* See AppList: panel.css has no visually-hidden helper. */
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  /* panel.css's disabled rule only fades the text, which on the primary's
     accent fill left the countdown unreadable -- faint grey on blue, in both
     themes -- and still looked like the panel's one live call to action. A
     waiting Retry takes the quiet inset look instead: plainly not pressable
     yet, with the countdown in muted text that can still be read. The class is
     doubled to outrank .sp-panel .sp-btn:disabled, which ties otherwise. */
  .sp-btn.sp-btn:disabled {
    background: var(--sp-bg-inset);
    border-color: var(--sp-border);
    color: var(--sp-text-muted);
  }
  /* Mono and tabular like every other figure in the panel, so the button does
     not change width as 0:19 becomes 0:18. */
  .countdown {
    font-family: var(--sp-font-mono);
    font-variant-numeric: tabular-nums;
  }
</style>
