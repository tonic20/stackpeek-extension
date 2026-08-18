import { browser } from "wxt/browser";

// wxt/browser's types are generated from @types/chrome, which has no
// Firefox-only APIs, so sidebarAction isn't in WxtBrowser. Cast to the slice
// this file actually calls rather than pulling in a whole second types
// package for one method.
const firefoxBrowser = browser as unknown as { sidebarAction: { open(): Promise<void> } };

export default defineBackground(() => {
  // Open the panel from the action's click handler rather than via
  // setPanelBehavior({ openPanelOnActionClick: true }). Clicking the action
  // fires action.onClicked, which grants the extension `activeTab` access to
  // that tab — the permission the panel needs to inject the collector into the
  // page. openPanelOnActionClick would open the panel but suppress onClicked,
  // so activeTab is never granted and every scan is denied. That reasoning
  // holds identically on Firefox.
  browser.action.onClicked.addListener((tab) => {
    if (tab.id == null) return;

    if (import.meta.env.FIREFOX) {
      // Firefox implements no sidePanel API (addons-linter: UNSUPPORTED_API).
      // sidebarAction.open() takes no arguments — the sidebar is per-window,
      // not per-tab — and requires a user gesture, which an action.onClicked
      // handler is.
      firefoxBrowser.sidebarAction.open();
    } else {
      browser.sidePanel.open({ tabId: tab.id });
    }
  });
});
