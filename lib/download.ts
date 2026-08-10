// Blob download, not chrome.downloads. A Blob URL fed to a synthetic anchor
// click triggers the browser's normal save flow without ever calling the
// chrome.downloads API, so it doesn't need the `downloads` permission at
// all -- unlike calling chrome.downloads.download() directly, which would
// require adding it. Market research on how comparable Shopify-detection
// extensions handle CSV export turned up the same Blob-and-anchor pattern
// as common practice, not a novel trick. Keeping it this way is what keeps
// the FAQ's "the permission list is unchanged" true (design D10).
export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // The panel outlives the tab it scanned, so an un-revoked blob would be held
  // for the whole session rather than until the next navigation.
  URL.revokeObjectURL(url);
}

export function catalogueFilename(domain: string, date: Date): string {
  const day = date.toISOString().slice(0, 10);
  return `${domain.replace(/^www\./, "")}-products-${day}.csv`;
}
