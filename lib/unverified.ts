// Whether a scan's apps get the "unverified" marker at all. Shared by the
// panel (AppList.svelte) and the Markdown report (lib/report.ts), which used
// to answer this differently: the panel hid the marker when every app was
// unverified, and the report printed "(unverified)" after every one -- so the
// pasted report flagged eight apps the screen it came from had flagged none
// of.
//
// "unverified" is a COMPARATIVE claim: it means "matched on weaker evidence
// than the others here", which is only true of anything if the scan holds
// BOTH kinds. Today the catalogue has no verified apps at all -- 0 of 699
// rows carry verified_at -- and flagging 8 of 8 would mark everything and
// distinguish nothing. This self-corrects the moment triage backfills the
// column, with no code change in either caller.
//
// Both halves are load-bearing, and the second is easy to drop as redundant.
// It is not: with every app verified, no marker can render (nothing is
// unverified) but the panel's footnote is gated on the same value, and would
// sit there explaining a marker that is nowhere on screen.
//
// `=== true`, not truthiness: the field is a boolean from the API, and
// anything else -- absent, null -- is not a verification.
export function marksUnverified(apps: readonly { verified?: unknown }[]): boolean {
  return apps.some((a) => a.verified === true) && apps.some((a) => a.verified !== true);
}
