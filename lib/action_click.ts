// The toolbar click, relayed from the background to a panel that is already
// open.
//
// A click is the only thing that grants activeTab, and the panel cannot see
// it: action.onClicked fires in the background, and opening a panel that is
// already open does nothing. So the click that the needs_permission state asks
// for granted access and changed nothing on screen -- the user did exactly
// what the panel told them to and was left looking at the same instruction,
// with no rescan button to press (App.svelte hides it there, rightly: without
// the grant it could only fail again).
//
// The message carries the clicked tab's id and nothing else, which the
// background is handed by the event itself. Like lib/tab_watcher.ts it never
// learns where the tab is.
import { browser } from "wxt/browser";

export const ACTION_CLICKED = "stackpeek:action-clicked";

export interface ActionClickedMessage {
  type: typeof ACTION_CLICKED;
  tabId: number;
}

export function isActionClicked(message: unknown): message is ActionClickedMessage {
  return (
    typeof message === "object" && message !== null &&
    (message as { type?: unknown }).type === ACTION_CLICKED &&
    typeof (message as { tabId?: unknown }).tabId === "number"
  );
}

// Fire-and-forget. With no panel open there is no receiver, and both engines
// reject the send for that ("Could not establish connection. Receiving end
// does not exist." on Chrome) -- which is the ordinary case, not a fault: the
// click is also opening the panel, and a panel scans the active tab when it
// mounts. Every rejection is swallowed for the same reason: the only thing a
// failed send can cost is a rescan the mount is about to do anyway.
//
// That ordering is also why the first open does not scan twice. The send is
// dispatched in the same task as the open() call, long before the new panel
// document has loaded far enough to register a listener, so a panel that is
// being opened by this click never receives it.
export function notifyPanel(tabId: number): void {
  const message: ActionClickedMessage = { type: ACTION_CLICKED, tabId };
  try {
    Promise.resolve(browser.runtime.sendMessage(message)).catch(() => {});
  } catch {
    // A synchronous throw (no runtime to send through at all) means the same
    // thing as a rejection here, and must not take the click handler -- and
    // the open() it already made -- down with it.
  }
}
