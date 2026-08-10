// The four states that end a scan: no further rounds will change them, and
// each carries its own code chip, copy and action (panel design D7).
// Rate limiting is one of them in its own right rather than an error with
// different wording, which is what lets it show a 429 chip.
export type TerminalStatus =
  | "not_shopify"
  | "cant_scan"
  | "error"
  | "rate_limited"
  // Chrome refused to inject into this tab. Recoverable, but only by the
  // toolbar click that grants activeTab -- so it is terminal as far as the
  // panel is concerned.
  | "needs_permission";

// idle is pre-autostart, loading is the first round only, and result covers
// every round from the first one that returns a store onward -- refinement is
// tracked separately, because the results on screen are already real.
export type PanelStatus = "idle" | "loading" | "result" | TerminalStatus;
