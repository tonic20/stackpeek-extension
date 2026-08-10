// Tells the panel that what it is showing no longer describes the page in
// front of the user.
//
// Deliberately does not learn WHERE the user went. Reading a tab's URL needs
// the `tabs` permission, which is browsing history by any honest reading, and
// the homepage, the permissions table, the FAQ and /privacy all promise we do
// not take it. These events fire without it -- they merely withhold `url` --
// and "the result is stale" is the whole question (design D4).
export function watchActiveTab(onChange: () => void): { stop: () => void } {
  const tabs = globalThis.chrome?.tabs;
  if (!tabs) return { stop: () => {} };

  // The tab whose result is on screen. Undefined until the opening query
  // settles, which is why the handlers below check it rather than assume it.
  let shownTabId: number | undefined;
  tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    shownTabId = tab?.id;
  });

  const handleActivated = (info: { tabId: number }) => {
    if (info.tabId === shownTabId) return;
    shownTabId = info.tabId;
    onChange();
  };

  // status === "complete" only. onUpdated fires repeatedly through a load --
  // loading, favicon, title -- and acting on each would run a scan per event.
  //
  // This does fire for the load that was already in flight when the panel
  // opened, which reads like a redundant rescan but is not: a page that
  // finished loading after we scanned it has more signals than the one we saw,
  // so scanning again is the right answer rather than a wasteful one.
  const handleUpdated = (tabId: number, changeInfo: { status?: string }) => {
    if (tabId !== shownTabId) return;
    if (changeInfo.status !== "complete") return;
    onChange();
  };

  tabs.onActivated.addListener(handleActivated);
  tabs.onUpdated.addListener(handleUpdated);

  return {
    stop() {
      tabs.onActivated.removeListener(handleActivated);
      tabs.onUpdated.removeListener(handleUpdated);
    },
  };
}
