export default defineBackground(() => {
  // Open the side panel from the action's click handler rather than via
  // setPanelBehavior({ openPanelOnActionClick: true }). Clicking the action
  // fires chrome.action.onClicked, which grants the extension `activeTab`
  // access to that tab — the permission the side panel needs to inject the
  // collector into the page. openPanelOnActionClick would open the panel but
  // suppress onClicked, so activeTab is never granted and every scan is denied.
  chrome.action.onClicked.addListener((tab) => {
    if (tab.id != null) {
      chrome.sidePanel.open({ tabId: tab.id });
    }
  });
});
