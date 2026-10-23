import { browser } from "wxt/browser";
import { registerWelcomePage } from "../lib/welcome";
import { notifyPanel } from "../lib/action_click";
import { installShopifyBadge } from "../lib/shopify_badge";

// wxt/browser's types are generated from @types/chrome, which has no
// Firefox-only APIs, so sidebarAction isn't in WxtBrowser. Cast to the slice
// this file actually calls rather than pulling in a whole second types
// package for one method.
const firefoxBrowser = browser as unknown as { sidebarAction: { open(): Promise<void> } };

export default defineBackground(() => {
  // The page opened once after install, and the port it asks for the pin
  // state on. Self-contained in lib/welcome.ts.
  registerWelcomePage();

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

    // After the open, never before: both open() calls have to be made inside
    // the user gesture, which lasts only until the handler yields. A panel
    // that was already open rescans on this; one that was not scans on mount
    // instead, and never hears it (lib/action_click.ts).
    notifyPanel(tab.id);
  });

  // The toolbar dot on Shopify storefronts. Inert unless the user has turned
  // on auto-scan's access to every site (lib/shopify_badge.ts).
  installShopifyBadge();
});
