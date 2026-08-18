import { browser } from "wxt/browser";
import { collectSignals } from "./collector";
import { resolveProbeList } from "./window_globals_config";
import { InjectionDeniedError } from "./errors";

// How long the injected collector may wait in-page for window.Shopify. See
// lib/collector.ts for why the wait exists at all.
import { SHOPIFY_WAIT_MS } from "./injection_args";
export { SHOPIFY_WAIT_MS };

// Truncates a tab URL down to scheme + host (+ port), dropping path, query
// string and fragment. This is the one place the value is produced, so it is
// the one place it gets cut -- every call site below hands the result
// straight to the detect payload, and backend/app/views/pages/privacy.html.erb
// already promises users that what leaves their browser is "the store's
// domain", not the page they were on. A query string routinely carries search
// terms, discount codes, UTM parameters and cart tokens; every backend
// consumer (own_hosts_from, own_domain_from, host_from in
// detection_service.rb) reduces the full URL to URI.parse(url).host anyway,
// so nothing downstream loses anything by receiving only the origin. Do not
// "restore" the full URL here as a convenience -- nothing reads it.
//
// tab.url is typed string | undefined (Chrome omits it without the `tabs`
// permission, which this extension does not request), and `new URL(undefined
// as any)` throws -- so undefined must short-circuit before reaching `new
// URL`, not merely be caught by it. A malformed value (never observed from
// Chrome itself, but not something to trust blindly either) must not throw
// through this function either: a detect round already survives a missing
// URL, and it must survive an unparseable one the same way. Crashing here
// would turn this privacy fix into a failed scan on a page the user is
// looking at.
function originOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export async function collectFromActiveTab(): Promise<{
  signals: unknown;
  url: string | undefined;
}> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  // No active tab means there is nothing to inject into. The catch below
  // already degrades to exactly this result -- previously by way of a
  // TypeError on tab.id -- so returning it up front only skips the probe-list
  // fetch that was being done on the way to throwing.
  if (tab?.id === undefined) return { signals: null, url: originOf(tab?.url) };
  try {
    const globals = await resolveProbeList();
    const [injection] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      // Without this, Chrome injects at document_idle, which waits for the
      // window load event. Measured on spotonfence.com: load had still not
      // fired 44s in, and this call blocked for 78,771ms.
      injectImmediately: true,
      func: collectSignals,
      args: [globals, SHOPIFY_WAIT_MS],
    });
    return { signals: injection?.result ?? null, url: originOf(tab.url) };
  } catch (e) {
    // Both engines report this as a plain Error with no code, so the message is
    // the only thing there is to classify on. Matching narrowly and defaulting
    // to the old behaviour keeps a message change from turning restricted pages
    // into permission prompts -- the failure would be a refusal shown as "Can't
    // scan this page", which is no worse than not classifying at all.
    //
    // The two engines word it differently and BOTH must be listed. Chrome says
    // "Cannot access contents of the page ... must request permission";
    // Firefox says "Missing host permission for the tab", or "Frame not found,
    // or missing host permission" for a frame (bugzilla 1448129).
    //
    // Firefox is not an edge case here, it is the common path. Firefox revokes
    // the activeTab grant on navigation, and this panel auto-rescans whenever
    // the active tab changes (lib/tab_watcher.ts) -- a rescan with no user
    // gesture behind it. So on Firefox every scan after a navigation lands
    // here, and with only Chrome's wording listed it rendered "Can't scan this
    // page" on storefronts that were one toolbar click from scanning
    // (observed on Firefox 153, 2026-08-18). The needs_permission state and
    // its copy already say the right thing; they were simply unreachable.
    if (e instanceof Error && /must request permission|Cannot access contents of the page|missing host permission/i.test(e.message)) {
      throw new InjectionDeniedError(e.message);
    }
    return { signals: null, url: originOf(tab.url) };
  }
}
