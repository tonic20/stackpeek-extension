import { browser } from "wxt/browser";

// The one-time card that tells a user auto-scan exists. Any answer closes it
// for good, a denied browser prompt included: it is a pointer to the switch,
// which stays above the footer, not a request to repeat.
const KEY = "autoScanOfferSeen";

export interface AutoScanOffer {
  /** False where there is no storage to remember the answer in. */
  pending(): Promise<boolean>;
  close(): void;
}

async function pending(): Promise<boolean> {
  const local = browser?.storage?.local;
  if (!local?.get) return false;
  try {
    const stored = await local.get(KEY);
    return stored[KEY] !== true;
  } catch {
    return false;
  }
}

function close(): void {
  Promise.resolve(browser?.storage?.local?.set({ [KEY]: true })).catch(() => {});
}

export const autoScanOffer: AutoScanOffer = { pending, close };
