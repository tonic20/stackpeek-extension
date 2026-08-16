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

// A truncated export names itself. The disclosure beside the count is on screen
// for as long as the panel is, which is not long enough: what the merchant
// keeps is the file, and the file cannot show its own shortfall. Its row count
// certainly cannot -- Shopify's import format writes one row per variant, so
// the first 10,000 products of www.fashionnova.com came out as 75,530 rows and
// read as a complete 42,098-product catalogue. The name is the only carrier
// left; a note row inside the CSV would be a row the importer tries to import.
//
// total is null when the store's size was never read: the file still says it is
// partial, because the walk knows that much on its own.
//
// Deliberately NOT in locales/en.yml, even though ProductSummary displays this
// name after an export and it is therefore user-visible English. Two reasons,
// recorded here because the next person extracting a locale file will find this
// string and otherwise have to guess whether skipping it was an oversight:
// the filename is a durable artifact the merchant keeps and may later hand to
// Shopify's importer or to a colleague, so it should read the same everywhere
// rather than varying by whoever exported it; and a translated name drags
// non-ASCII into a download filename, which is its own class of problem across
// filesystems. `products` and `first`/`of` here are closer to `CSV_HEADER` in
// lib/csv.ts -- a format -- than to copy. Revisit only with a reason, not for
// consistency.
export function catalogueFilename(
  domain: string,
  date: Date,
  truncation: { exported: number; total: number | null } | null = null,
): string {
  const day = date.toISOString().slice(0, 10);
  const scope = truncation
    ? `-first-${truncation.exported}${truncation.total === null ? "" : `-of-${truncation.total}`}`
    : "";
  return `${domain.replace(/^www\./, "")}-products${scope}-${day}.csv`;
}
