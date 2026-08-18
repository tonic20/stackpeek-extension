// Which panel sections the user has collapsed.
//
// One record for the whole extension, not one per store (design D2). Collapsing
// a section is a statement about the user -- "this is not what I am here for" --
// not about the store they happened to be on when they made it. Per-hostname
// state would also grow without bound and need an eviction policy nothing else
// here has.
//
// A .svelte.ts module so the record can be $state. The alternative -- a plain
// object read once at render -- happens to work today only because the compiler
// treats a bare function call as constant, which is a bet on an optimisation
// rather than a declared dependency.
import { browser } from "wxt/browser";

export type SectionId =
  | "theme"
  | "apps"
  | "trackers"
  | "infrastructure"
  | "products"
  | "best-sellers";

// Exported so the panel and its tests iterate one list rather than three.
export const SECTION_IDS: readonly SectionId[] = [
  "theme",
  "apps",
  "trackers",
  "infrastructure",
  "products",
  "best-sellers",
];

const KEY = "sections";

type SectionState = Partial<Record<SectionId, boolean>>;

let sections = $state<SectionState>({});

function isSectionId(value: string): value is SectionId {
  return (SECTION_IDS as readonly string[]).includes(value);
}

// Called once, from main.ts, before mount (design D5). Nothing paints a section
// before then, so this closes the flash gap completely and -- unlike the theme
// preference -- needs no synchronous pre-paint script in public/.
//
// Anything unrecognised is dropped rather than trusted: this key shares storage
// with `theme` and `install_id` and outlives upgrades.
export async function loadSections(): Promise<void> {
  const result = await browser?.storage?.local?.get(KEY);
  const stored = result?.[KEY];
  const next: SectionState = {};

  if (stored && typeof stored === "object") {
    for (const [key, value] of Object.entries(stored)) {
      if (isSectionId(key) && typeof value === "boolean") next[key] = value;
    }
  }

  sections = next;
}

// An absent entry is "no opinion", not "open" (design D3). The default lives
// here, in code, so a section shipped closed-by-default later would apply to
// every install that never touched it while leaving deliberate choices alone.
export function isOpen(id: SectionId): boolean {
  return sections[id] ?? true;
}

export function setOpen(id: SectionId, open: boolean): void {
  // In memory first, and unconditionally. A refused write must still leave the
  // record agreeing with what is on screen, or the next read re-asserts a state
  // the user just changed.
  sections[id] = open;

  // Spread, not the $state proxy itself: chrome.storage structured-clones what
  // it is given, and a proxy does not survive that. Flat record of booleans, so
  // one level is the whole thing.
  const snapshot = { ...sections };

  try {
    void browser?.storage?.local?.set({ [KEY]: snapshot }).catch(() => {
      // Storage denied. The section still toggled; the choice just is not kept.
    });
  } catch {
    // A synchronous throw from storage. Same answer.
  }
}
