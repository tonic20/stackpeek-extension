<script lang="ts">
  import type { TerminalStatus } from "../../../lib/panel_status";

  let { status, domain = "", onretry }:
    { status: TerminalStatus; domain?: string; onretry: () => void } = $props();

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
      // NOT "nothing was sent": the page's signals are sent on every scan --
      // is_shopify is a field in the API *response*, so the panel cannot know a
      // page is not Shopify until the server has seen the signals
      // (lib/detect_runner.ts:109).
      //
      // And NOT the flat "nothing was stored" this line used to carry. The
      // negation is scoped to the PAGE because that is exactly how far it
      // holds: DetectController#create enqueues RecordDetectionJob only when
      // the page turned out to be Shopify, but it calls
      // Install.touch_detection on every final round, outside that guard --
      // which upserts the anonymous install row's detect_count and
      // last_seen_at. Something IS written here; it just knows nothing about
      // the page. The privacy page and the store listing both disclose that
      // counter, and the panel must not deny what they disclose.
      body: "Checked against the catalogue and no match. Nothing about the page was stored.",
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

  // Our own site. An explicit list rather than a substring or suffix test:
  // "notstackpeek.app" belongs to someone else and gets the ordinary answer.
  const OWN_HOSTS = ["stackpeek.app", "www.stackpeek.app"];
  const isOurs = $derived(status === "not_shopify" && OWN_HOSTS.includes(domain));

  // The script-count claim below is checked against the real page:
  // backend/app/views/layouts/application.html.erb loads exactly one
  // third-party script, the Cloudflare Insights beacon. If a script is added
  // or removed there, re-check this string -- and no test can do that for
  // you, because extension/ is published standalone to the public mirror
  // where backend/ does not exist, so a test reading across the repo would
  // fail for anyone who cloned it. A matching comment sits at the other end.
  // (This comment does not vouch for the hosting description in the same
  // sentence; that is verified independently against backend/config/deploy.yml
  // and backend/app/views/pages/privacy.html.erb.)
  const state = $derived(isOurs ? {
    code: "it's us",
    title: "You pointed the detector at the detector.",
    body: "Not Shopify. Rails and Postgres on a DigitalOcean box — plus one analytics beacon, the only third-party script on the page. We don't exempt ourselves.",
    action: "Scan again",
    variant: "sp-btn--quiet",
    role: "status",
  } : STATES[status]);
</script>

<div class="sp-state" role={state.role}>
  <span class="sp-state__code">{state.code}</span>
  <h2 class="sp-state__title">{state.title}</h2>
  <p class="sp-state__body">{state.body}</p>
  {#if state.action}
    <button class="sp-btn {state.variant}" type="button" onclick={onretry}>{state.action}</button>
  {/if}
</div>
