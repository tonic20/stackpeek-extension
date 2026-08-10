import { describe, it, expect } from "vitest";
import { extractHandles, rankedHandles } from "../lib/best_sellers";

const page = (body: string) => `<!doctype html><html><body>${body}</body></html>`;

// Chrome: a header with product links that are not part of the grid.
const chrome = `<nav><a href="/products/nav-one">One</a><a href="/products/nav-two">Two</a></nav>`;
const grid = (handles: string[]) =>
  `<ul class="grid">${handles.map((h) => `<li><a href="/products/${h}"><img></a><a href="/products/${h}">${h}</a></li>`).join("")}</ul>`;

describe("extractHandles", () => {
  // Tier 1. Shopify falls back to the default template when a view does not
  // exist, so the same request returns either JSON or the HTML we wanted.
  it("reads a view=json response directly", () => {
    const body = JSON.stringify({ products: [{ handle: "one" }, { handle: "two" }] });

    expect(extractHandles(body)).toEqual(["one", "two"]);
  });

  it("reads a view=json response shaped as a bare array", () => {
    expect(extractHandles(JSON.stringify([{ handle: "one" }]))).toEqual(["one"]);
  });

  // Tier 2. Where a theme scopes grid links to the collection, chrome links stay
  // bare and the grid separates with no heuristic at all.
  it("prefers collection-scoped links when the theme emits them", () => {
    const body = page(`${chrome}<ul>
      <li><a href="/collections/all/products/real-one">1</a></li>
      <li><a href="/collections/all/products/real-two">2</a></li></ul>`);

    expect(extractHandles(body)).toEqual(["real-one", "real-two"]);
  });

  // Tier 3. deathwishcoffee.com has neither a json view nor scoped links, and a
  // naive document-order read puts three header items at ranks 1-3.
  it("falls back to the densest ancestor, excluding navigation chrome", () => {
    const body = page(chrome + grid(["alpha", "beta", "gamma"]));

    expect(extractHandles(body)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("dedupes the several links each product card carries", () => {
    const body = page(grid(["alpha", "beta"]));

    expect(extractHandles(body)).toEqual(["alpha", "beta"]);
  });

  it("strips query strings and fragments from handles", () => {
    const body = page(`<ul><li><a href="/products/alpha?variant=1">a</a></li>
      <li><a href="/products/beta#x">b</a></li><li><a href="/products/gamma">c</a></li></ul>`);

    expect(extractHandles(body)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("returns nothing for a client-rendered page with no product links", () => {
    expect(extractHandles(page("<div id='root'></div>"))).toEqual([]);
  });
});

describe("rankedHandles", () => {
  it("returns the best-selling order when the two sorts disagree", () => {
    const bs = page(grid(["gamma", "alpha", "beta"]));
    const az = page(grid(["alpha", "beta", "gamma"]));

    expect(rankedHandles(bs, az)).toEqual(["gamma", "alpha", "beta"]);
  });

  // THE guard. chubbiesshorts.com parses perfectly and returns 65 products in an
  // order that has nothing to do with sales; nothing in the response says so.
  // Asking twice and comparing is the only available proof.
  it("returns nothing when the store ignored the sort", () => {
    const same = page(grid(["alpha", "beta", "gamma"]));

    expect(rankedHandles(same, same)).toEqual([]);
  });

  it("returns nothing when neither page yields a grid", () => {
    expect(rankedHandles(page("<div></div>"), page("<div></div>"))).toEqual([]);
  });

  // A one-product store cannot demonstrate a ranking, and claiming one from a
  // single row would be the same fabrication in miniature.
  it("returns nothing when there is only one product to rank", () => {
    const one = page(grid(["alpha"]));

    expect(rankedHandles(one, one)).toEqual([]);
  });

  // spotonfence.com. Its /collections/all holds two products, so the 0.6
  // threshold lands at 1.2 and ANY node holding both handles clears it --
  // including the header's menu drawer, which links to both from deeper than
  // the grid and so wins the depth tie-break. Drawer order is page chrome and
  // identical under both sorts, so a real ranking read as "sort ignored".
  it("ranks the grid when deep navigation chrome links to the same products", () => {
    const drawer = (handles: string[]) =>
      `<header><header-drawer><details><div class="menu-drawer"><div><div><nav><ul><li><details><div><ul>${handles
        .map((h) => `<li><a href="/products/${h}">${h}</a></li>`)
        .join("")}</ul></div></details></li></ul></nav></div></div></div></details></header-drawer></header>`;
    const bs = page(drawer(["nova", "omni"]) + grid(["omni", "nova"]));
    const az = page(drawer(["nova", "omni"]) + grid(["nova", "omni"]));

    expect(rankedHandles(bs, az)).toEqual(["omni", "nova"]);
  });

  // chubbiesshorts.com, measured: two fetches of the SAME sort never disagree,
  // but roughly one cross-sort pair in three has one response rendering a block
  // the other did not -- 86 handles against 65, one a superset of the other. So
  // "some container ordered its handles differently" is not by itself proof of
  // a re-sort. Only a container holding the SAME handles in a different order
  // is, which is what separates this store from spotonfence.com above.
  it("returns nothing when the pages differ by what they rendered, not by order", () => {
    const fixed = Array.from({ length: 65 }, (_, i) => `fixed-${i}`);
    const extra = Array.from({ length: 21 }, (_, i) => `extra-${i}`);
    const bs = page(grid(fixed) + grid(extra));
    const az = page(grid(fixed));

    expect(rankedHandles(bs, az)).toEqual([]);
  });
});
