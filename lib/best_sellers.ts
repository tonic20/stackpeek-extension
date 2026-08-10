const clean = (href: string) => href.split("/products/")[1]?.split(/[?#]/)[0] ?? "";

const handlesIn = (el: ParentNode): string[] => [
  ...new Set(
    [...el.querySelectorAll('a[href*="/products/"]')]
      .map((a) => clean(a.getAttribute("href") ?? ""))
      .filter(Boolean),
  ),
];

// Tier 1 -- the response to `&view=json`. Shopify serves the default template
// when that view does not exist, so this is free to try: the same body is
// either structured or the HTML the later tiers parse.
function structuredHandles(body: string): string[] | null {
  try {
    const parsed = JSON.parse(body);
    const list = Array.isArray(parsed) ? parsed : parsed?.products;
    if (Array.isArray(list)) {
      const handles = list.map((p: { handle?: string }) => p?.handle).filter(Boolean) as string[];
      if (handles.length) return [...new Set(handles)];
    }
  } catch { /* not JSON: the caller falls through to the HTML tiers */ }
  return null;
}

// Tier 2 -- collection-scoped links. Where a theme emits these, grid links
// carry the collection and chrome links stay bare, so the split is exact.
function scopedHandles(doc: Document): string[] | null {
  const scoped = [...doc.querySelectorAll('a[href*="/collections/"][href*="/products/"]')]
    .map((a) => clean(a.getAttribute("href") ?? ""))
    .filter(Boolean);
  return scoped.length ? [...new Set(scoped)] : null;
}

// The two tiers that cannot mistake page chrome for the grid, in order. `doc`
// comes back parsed so the tier-3 caller does not parse the body twice.
function readUnambiguous(body: string): { handles: string[]; doc: Document | null } {
  const structured = structuredHandles(body);
  if (structured) return { handles: structured, doc: null };

  const doc = new DOMParser().parseFromString(body, "text/html");
  return { handles: scopedHandles(doc) ?? [], doc };
}

// Every ancestor of a product link, nearest first, each visited once. The walk
// stops at the first already-seen node because everything above it was reached
// on an earlier link's way up.
function containers(doc: Document): Element[] {
  const found: Element[] = [];
  const seen = new Set<Element>();
  for (const a of doc.querySelectorAll('a[href*="/products/"]')) {
    for (let node = a.parentElement; node; node = node.parentElement) {
      if (seen.has(node)) break;
      seen.add(node);
      found.push(node);
    }
  }
  return found;
}

// Tier 3 -- the tightest container holding the bulk of the product links.
//
// Not simply "the ancestor with the most links": <body> contains every link
// on the page, nav included, so by raw count it always wins and the ranking
// starts with the header menu. The grid is instead the DEEPEST element that
// still holds most of them -- tight enough to have excluded the chrome, big
// enough to be the grid rather than one card.
//
// Keyed on structure rather than class names, because class names belong to
// the theme and structure belongs to Shopify. The threshold is the one
// arbitrary number here: a page whose navigation carried more product links
// than its grid would defeat it, which is recorded in the spec's Risks --
// hence `accept`, which lets the ranking impose the further test that closes
// that hole (see rankedHandles).
function densest(doc: Document, accept: (handles: string[]) => boolean): string[] {
  const total = handlesIn(doc).length;
  if (!total) return [];
  const threshold = total * 0.6;

  let best: string[] = [];
  let bestDepth = -1;
  for (const node of containers(doc)) {
    const handles = handlesIn(node);
    if (handles.length < threshold) continue;
    if (!accept(handles)) continue;

    let depth = 0;
    for (let up: Element | null = node; up; up = up.parentElement) depth++;
    if (depth > bestDepth) { best = handles; bestDepth = depth; }
  }
  return best;
}

// Isolating a collection grid from page chrome is theme-dependent, so it is
// attempted in tiers and stops at the first that yields handles (design D2).
export function extractHandles(body: string): string[] {
  const { handles, doc } = readUnambiguous(body);
  if (handles.length || !doc) return handles;

  return densest(doc, () => true);
}

const order = (handles: string[]) => handles.join("\n");
const contents = (handles: string[]) => [...handles].sort().join("\n");

// Where the two orders match, the sort was ignored and there is nothing to
// show -- no section at all rather than arbitrary order presented as a sales
// ranking (design D3).
function decided(ranked: string[], control: string[]): string[] {
  if (ranked.length < 2) return [];
  return order(ranked) === order(control) ? [] : ranked;
}

// The ranking is only real if the store honoured the sort, and the only way to
// know is to ask twice (design D3).
export function rankedHandles(bestSelling: string, alphabetical: string): string[] {
  const ranked = readUnambiguous(bestSelling);
  const control = readUnambiguous(alphabetical);

  // A nav link is never an entry in the json view and is never
  // collection-scoped, so where either tier read the page there is no chrome
  // in the lists and comparing them whole is sound.
  if (ranked.handles.length || control.handles.length) {
    return decided(ranked.handles, control.handles);
  }

  if (!ranked.doc || !control.doc) return [];

  // Tier 3 only guesses at the grid, and on a small collection it guesses the
  // header: two handles on the page puts the 0.6 threshold at 1.2, so ANY node
  // holding both clears it and the deepest one wins -- on spotonfence.com the
  // menu drawer, nested far below the grid. Its order is page chrome, so it is
  // identical under both sorts and a real ranking reads as "sort ignored".
  //
  // So look first for the one unambiguous proof of a re-sort: a container whose
  // handles ALL appear together on the control page, in a different order. A
  // permutation is something only sort_by produces. Chrome cannot qualify (it
  // renders identically under both sorts), and neither can a difference in what
  // the two responses rendered -- measured on chubbiesshorts.com, where one
  // cross-sort pair in three differs by a whole block, 86 handles against 65.
  // Requiring the set to match as well as the order to differ tells the store
  // that re-sorted from the store that merely rendered something else.
  const control3 = containers(control.doc).map(handlesIn);
  const orders = new Set(control3.map(order));
  const sets = new Set(control3.map(contents));

  const permuted = densest(
    ranked.doc,
    (h) => h.length >= 2 && sets.has(contents(h)) && !orders.has(order(h)),
  );
  if (permuted.length) return permuted;

  // No permutation to point at -- which is every store whose page 1 changes
  // membership between the two sorts, not just the ones that ignored it. Fall
  // back to comparing the densest container on each page, so those stores keep
  // the answer they had before there was a permutation test to try first.
  return decided(densest(ranked.doc, () => true), densest(control.doc, () => true));
}
