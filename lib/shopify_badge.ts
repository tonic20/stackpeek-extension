// A dot on the toolbar icon for tabs that are Shopify storefronts, so the user
// can see where Stackpeek has something to say before opening the panel.
//
// Only with access to every site (lib/host_access.ts), which is what lets the
// background read a page nobody clicked on; without it this installs nothing
// that runs. And only local: the check is one property read in the page, and
// its answer goes to the badge and nowhere else. Nothing here talks to the
// API, so it costs no part of the rate limit and tells us nothing about where
// the user goes -- the promise the auto-scan switch's note makes.
import { browser } from "wxt/browser";
import { hostAccess } from "./host_access";

// The same reading the collector makes of the same object (lib/collector.ts:
// `shopify` is non-null exactly when window.Shopify is), narrowed to a
// storefront's `shop` domain so that some other site's global that happens to
// be called Shopify does not light the icon. Headless storefronts, which have
// no window.Shopify, get no dot; the panel can still detect them.
//
// Injected, so self-contained: executeScript serialises this function's own
// source and nothing around it (test/injection_safety.test.ts).
export function probeShopify(): boolean {
  const S = (window as any).Shopify;
  return !!S && typeof S.shop === "string" && S.shop.length > 0;
}

export const BADGE_TEXT = "●";
// The brand accent (--sp-accent). Not Shopify's green, which the brief rules
// out, and the dot means "Stackpeek has a reading here" rather than anything
// of Shopify's.
export const BADGE_COLOR = "#2b5ce6";

type Tabs = typeof browser.tabs;

export function installShopifyBadge(access = hostAccess): void {
  const tabs = browser?.tabs as Tabs | undefined;
  const action = browser?.action;
  const scripting = browser?.scripting;
  const permissions = browser?.permissions;
  if (!tabs || !action || !scripting || !permissions?.onAdded) return;

  // A navigation that starts while a check is still in flight must win: the
  // late answer describes the page being left. Each tab's newest check or
  // reset carries the current number, and an answer is applied only if
  // nothing newer has happened to its tab since.
  const generation = new Map<number, number>();
  const bump = (tabId: number) => {
    const next = (generation.get(tabId) ?? 0) + 1;
    generation.set(tabId, next);
    return next;
  };

  const setBadge = (tabId: number, on: boolean) =>
    Promise.resolve(action.setBadgeText({ tabId, text: on ? BADGE_TEXT : "" })).catch(() => {
      // The tab closed in the meantime. Nothing to mark.
    });

  async function check(tabId: number) {
    const mine = bump(tabId);
    let shopify = false;
    try {
      const [injection] = await scripting!.executeScript({
        target: { tabId },
        world: "MAIN",
        func: probeShopify,
      });
      shopify = injection?.result === true;
    } catch {
      // chrome://, the Web Store, addons.mozilla.org, PDFs, a page that
      // navigated mid-call: closed to every extension, and quietly not a
      // store as far as the dot is concerned.
    }
    if (generation.get(tabId) === mine) await setBadge(tabId, shopify);
  }

  // "loading" clears at once, so the dot never sits over the next page while
  // it loads; "complete" is when an inline window.Shopify is certain to exist.
  const onUpdated = (tabId: number, info: { status?: string }) => {
    if (info.status === "loading") {
      bump(tabId);
      setBadge(tabId, false);
    } else if (info.status === "complete") {
      check(tabId);
    }
  };
  // A tab that finished loading before access was granted, or while the
  // worker was asleep and missed it, gets its answer when it is looked at.
  const onActivated = (info: { tabId: number }) => {
    check(info.tabId);
  };

  let listening = false;
  const listen = () => {
    if (listening) return;
    listening = true;
    tabs.onUpdated.addListener(onUpdated);
    tabs.onActivated.addListener(onActivated);
  };
  const unlisten = () => {
    if (!listening) return;
    listening = false;
    tabs.onUpdated.removeListener(onUpdated);
    tabs.onActivated.removeListener(onActivated);
  };

  // Every tab, not a remembered list: the worker may have been restarted since
  // it set them, and a tab-specific badge outlives the code that set it.
  // Without the tabs permission the ids are still listed; nothing else is
  // needed to clear a badge.
  async function clearAll() {
    generation.clear();
    for (const tab of await tabs!.query({})) {
      if (tab.id !== undefined) setBadge(tab.id, false);
    }
  }

  async function sync(changed: boolean) {
    const granted = (await access.has()) === true;
    if (granted) {
      listen();
      // The tabs already in front of the user, so turning the switch on
      // shows its effect without waiting for a navigation.
      if (changed) for (const tab of await tabs!.query({ active: true })) if (tab.id !== undefined) check(tab.id);
    } else {
      unlisten();
      if (changed) await clearAll();
    }
  }

  // Registered synchronously, on every start of the worker, and dropped as
  // soon as the permission check says there is no access. An MV3 service
  // worker woken by a tab event receives it only if a listener for it was
  // added before the first await of the script; registering only after the
  // check would miss exactly the event that woke it, every time.
  // removeListener then takes the listener back out, so a worker without
  // access is not woken for every page load in the browser.
  listen();
  sync(false);
  Promise.resolve(action.setBadgeBackgroundColor({ color: BADGE_COLOR })).catch(() => {});
  // setBadgeTextColor is newer than the rest (Chrome 110, Firefox 109) and
  // optional: without it Chrome picks a contrasting text colour itself.
  const withTextColor = action as { setBadgeTextColor?: (d: { color: string }) => unknown };
  if (withTextColor.setBadgeTextColor) {
    Promise.resolve(withTextColor.setBadgeTextColor({ color: "#ffffff" })).catch(() => {});
  }

  permissions.onAdded.addListener(() => sync(true));
  permissions.onRemoved.addListener(() => sync(true));
}
