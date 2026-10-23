// Tells the panel that what it is showing no longer describes the page in
// front of the user.
//
// Deliberately does not learn WHERE the user went. Reading a tab's URL needs
// the `tabs` permission, which is browsing history by any honest reading, and
// the homepage, the permissions table, the FAQ and /privacy all promise we do
// not take it. These events fire without it -- they merely withhold `url` --
// and "the result is stale" is the whole question (design D4).
import { browser } from "wxt/browser";
import { claimActivation } from "./held_tabs";
import { isActionClicked } from "./action_click";

// Why the panel should look again. "click" is the toolbar icon or the
// shortcut -- the user asking, which is what grants activeTab. "auto" is
// everything the watcher notices on its own: a tab switch, a load finishing.
// The panel treats them differently on Firefox, where an automatic scan needs
// a consent a click does not (lib/host_access.ts, blocksAutoScan).
export type ScanTrigger = "auto" | "click";

export function watchActiveTab(
  onChange: (trigger: ScanTrigger) => void,
  {
    // Whether an activation belongs to a tab the panel opened for the user --
    // see lib/held_tabs.ts. Injected so the watcher's own tests can say which
    // tab is held without driving the click that held it.
    claim = claimActivation,
    onHold = (_holding: boolean) => {},
  }: {
    claim?: (tabId: number) => boolean;
    onHold?: (holding: boolean) => void;
  } = {},
): { stop: () => void } {
  const tabs = browser?.tabs;
  if (!tabs) return { stop: () => {} };

  // The tab whose result is on screen. Undefined until the opening query
  // settles, which is why the handlers below check it rather than assume it.
  let shownTabId: number | undefined;
  tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    shownTabId = tab?.id;
  });

  // A held tab is in front of the user. shownTabId deliberately does NOT move
  // to it: the panel is still describing the tab it scanned, and going back
  // there must not read as a page change.
  let holding = false;

  const setHolding = (next: boolean) => {
    if (holding === next) return;
    holding = next;
    onHold(next);
  };

  const handleActivated = (info: { tabId: number }) => {
    if (info.tabId === shownTabId) {
      setHolding(false);
      return;
    }
    if (claim(info.tabId)) {
      setHolding(true);
      return;
    }
    setHolding(false);
    shownTabId = info.tabId;
    onChange("auto");
  };

  // status === "complete" only. onUpdated fires repeatedly through a load --
  // loading, favicon, title -- and acting on each would run a scan per event.
  //
  // This does fire for the load that was already in flight when the panel
  // opened, which reads like a redundant rescan but is not: a page that
  // finished loading after we scanned it has more signals than the one we saw,
  // so scanning again is the right answer rather than a wasteful one.
  const handleUpdated = (tabId: number, changeInfo: { status?: string }) => {
    // A scan reads whichever tab is active, not shownTabId, so acting on the
    // scanned tab finishing a background reload while a held tab is in front
    // would scan the held tab -- the permission error the hold exists to
    // prevent, arriving without the user having done anything at all.
    if (holding) return;
    if (tabId !== shownTabId) return;
    if (changeInfo.status !== "complete") return;
    onChange("auto");
  };

  // The toolbar icon was clicked, which granted activeTab on the clicked tab
  // (lib/action_click.ts). Reported as a change because it IS the event the
  // panel was waiting for: the result on screen -- most often the
  // needs_permission state, which asks for exactly this click -- was decided
  // without the access the user has just handed over.
  //
  // Only for the tab in front of THIS panel. Every open panel receives the
  // message -- Firefox draws a sidebar per window, and Chrome's global panel
  // can be open in several -- and a click in another window granted nothing
  // here: rescanning on it would spend four rounds of the rate limit to arrive
  // at the same refusal.
  //
  // A click on a held tab is the user asking for that tab after all, so it
  // stops being held and becomes the one shown. Left holding, the watcher would
  // go on ignoring the tab's reloads and treat a return to the original store
  // as no change, leaving the listing's result under the store's tab.
  const handleMessage = (message: unknown) => {
    if (!isActionClicked(message)) return;
    tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id !== message.tabId) return;
      shownTabId = tab.id;
      setHolding(false);
      onChange("click");
    });
  };

  tabs.onActivated.addListener(handleActivated);
  tabs.onUpdated.addListener(handleUpdated);
  const messages = browser?.runtime?.onMessage;
  messages?.addListener(handleMessage);

  return {
    stop() {
      tabs.onActivated.removeListener(handleActivated);
      tabs.onUpdated.removeListener(handleUpdated);
      messages?.removeListener(handleMessage);
    },
  };
}
