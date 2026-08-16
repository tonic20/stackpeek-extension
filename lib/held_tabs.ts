// The tabs the panel opened for the user, and which it therefore refuses to
// rescan.
//
// ThemeCard and AppList link out to themes.shopify.com and apps.shopify.com.
// Following one of those links used to destroy the result the user had just
// read: the new tab was never granted activeTab, so the rescan it triggered
// ended in "Open Stackpeek on this store" -- an error about a page the user
// never asked us to look at, with the previous store's name still in the
// header. Closing the panel to be rid of it closed it on the store tab too,
// because Chrome's side panel is per-window.
//
// Holding is not the same as going stale (design D4). The header keeps naming
// the store the results describe, and the panel says out loud that the tab in
// front of the user is not the one it scanned. What it stops doing is throwing
// away a good answer for a page it was never able to read.
//
// Deliberately no `tabs` permission: nothing here reads a URL. The panel knows
// these tabs because it opened them, not because it can see where they went.
const held = new Set<number>();

// Set between the click and the moment the new tab's id is known. See
// claimActivation for why the id alone is not enough.
let pending = false;

// A click on one of the panel's own outbound links. Opens the tab through the
// extension API rather than letting the anchor do it, because the API hands
// back the tab's id and the anchor does not.
//
// Reads the href off the anchor rather than taking a URL argument: the href
// has to be there anyway -- for middle-click, for "copy link address", and for
// the static copy of this panel on the marketing site -- so taking it from
// anywhere else would be a second source of truth for the same link.
export function heldLinkClick(event: MouseEvent): void {
  if (event.button !== 0) return;
  // Cmd/Ctrl/Shift/Alt all mean "not a plain navigation": a background tab, a
  // new window, a download. A background tab is never activated, so there
  // would be no activation to claim and `pending` would be left set for
  // whatever the user did next.
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  const create = globalThis.chrome?.tabs?.create;
  if (!create) return;

  const href = (event.currentTarget as HTMLAnchorElement | null)?.href;
  if (!href) return;

  event.preventDefault();
  pending = true;
  Promise.resolve(create({ url: href, active: true })).then(
    (tab) => { if (tab?.id !== undefined) hold(tab.id); },
    // The tab never opened, so there is nothing to hold and nothing to claim.
    () => { pending = false; },
  );
}

// Whether an activation belongs to a tab the panel opened. Consumed by the
// watcher, which asks once per activation.
//
// The `pending` branch exists because chrome.tabs.onActivated for the new tab
// reaches the panel before tabs.create's promise resolves -- the tab is
// activated as part of being created, so the event is generated before the
// API call has anything to return. Waiting for the id would mean the one
// activation that matters is the one we cannot recognise. The click is the
// claim; the id only records it, so that coming back to the tab later is
// recognised too.
//
// It claims exactly one activation, so a create that never resolves can hold
// at most the next tab the user visits, for the few milliseconds until it
// does.
export function claimActivation(tabId: number): boolean {
  if (held.has(tabId)) return true;
  if (!pending) return false;
  hold(tabId);
  return true;
}

function hold(tabId: number): void {
  pending = false;
  held.add(tabId);
}
