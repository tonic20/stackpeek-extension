import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/svelte";
import Trackers from "../entrypoints/sidepanel/components/Trackers.svelte";
import Infrastructure from "../entrypoints/sidepanel/components/Infrastructure.svelte";
import AppList from "../entrypoints/sidepanel/components/AppList.svelte";
import BestSellers from "../entrypoints/sidepanel/components/BestSellers.svelte";
import ThemeCard from "../entrypoints/sidepanel/components/ThemeCard.svelte";
import ProductSummary from "../entrypoints/sidepanel/components/ProductSummary.svelte";
import { loadSections } from "../lib/sections.svelte";

let store: Record<string, unknown>;

beforeEach(async () => {
  store = {};
  globalThis.chrome = {
    storage: { local: {
      get: vi.fn(async (k: string) => ({ [k]: store[k] })),
      set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(store, obj); }),
    } },
  } as unknown as typeof chrome;
  await loadSections();
});

afterEach(() => {
  // @ts-expect-error `chrome` only exists inside the extension.
  delete globalThis.chrome;
});

// <details> nests INSIDE <section class="sp-sec"> rather than replacing it.
// Every section carries <section aria-labelledby>, and <details> is not a
// landmark -- replacing the section would drop the region semantics and orphan
// every aria-labelledby. Nesting keeps both and costs one element.
const SECTIONS: [string, unknown, Record<string, unknown>, string, string][] = [
  ["Theme", ThemeCard,
    { theme: { name: "Dawn", origin: "catalog", version: "15.1.0", price: "Free" } },
    "sp-theme-label", "Theme"],
  ["Apps", AppList,
    { apps: [{ name: "Klaviyo", category: "Email & SMS", category_slug: "email-sms", app_store_url: "", verified: true }] },
    "sp-apps-label", "Apps"],
  ["Trackers", Trackers,
    { items: [{ name: "Meta Pixel" }] },
    "sp-trackers-label", "Trackers"],
  ["Infrastructure", Infrastructure,
    { items: [{ name: "Shopify Payments" }] },
    "sp-infrastructure-label", "Infrastructure"],
  ["Products", ProductSummary,
    { digest: { available: true, count: 12, variants: 20, priceMin: 1, priceMax: 9, newest: null, currency: "USD", index: [] }, onexport: () => {} },
    "sp-products-label", "Products"],
  ["Best sellers", BestSellers,
    { products: [{ handle: "a", title: "A", price: "1.00" }, { handle: "b", title: "B", price: "2.00" }] },
    "sp-best-sellers-label", "Best sellers"],
];

describe("collapsible sections", () => {
  // Every section discloses, so every section gets the widget. Previously only
  // Trackers and Infrastructure did, which left the panel with two sections
  // that collapsed and four that did not, for no reason a user could see.
  it.each(SECTIONS)("%s keeps its landmark and puts the head in a summary", (_n, Component, props, labelId, heading) => {
    const { container } = render(Component as never, props as never);

    const section = container.querySelector("section.sp-sec")!;
    expect(section.getAttribute("aria-labelledby")).toBe(labelId);

    const details = section.querySelector(":scope > details")!;
    expect(details).toBeTruthy();

    const summary = details.querySelector(":scope > summary")!;
    expect(summary.classList.contains("sp-sec__hd")).toBe(true);
    // The label stays readable while collapsed -- that is the whole point of
    // putting the head in the summary rather than above it.
    expect(summary.querySelector(`#${labelId}`)!.textContent).toBe(heading);
  });

  // The extension is a full-height side panel; hiding real findings behind a
  // click costs the user something, so every section ships open here. The
  // marketing page renders Trackers and Infrastructure collapsed instead, to
  // keep the panel short beside the hero copy -- a separate ERB template, not
  // an `open` prop these components accept.
  it.each(SECTIONS)("%s ships open in the extension", (_n, Component, props) => {
    const { container } = render(Component as never, props as never);

    expect(container.querySelector("details")!.hasAttribute("open")).toBe(true);
  });

  // A caret that does not drive the section beneath it is worse than none --
  // that is how .sp-sec--fixed shipped a control which lied. Asserted for every
  // section now that every section has one.
  it.each(SECTIONS)("%s toggles closed when its summary is clicked", (_n, Component, props) => {
    const { container } = render(Component as never, props as never);

    const details = container.querySelector("details")!;
    const summary = container.querySelector("summary")!;
    expect(details.hasAttribute("open")).toBe(true);

    summary.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(details.hasAttribute("open")).toBe(false);
  });

  // Task 2 proves Section honours the record. This proves all six sections are
  // actually wired to it -- the failure this catches is a component migrated to
  // <Section> with the wrong id, which no other test would notice.
  it.each(SECTIONS)("%s honours a remembered collapse", async (_n, Component, props, labelId) => {
    const id = labelId.replace(/^sp-|-label$/g, "");
    store.sections = { [id]: false };
    await loadSections();

    const { container } = render(Component as never, props as never);

    expect(container.querySelector("details")!.hasAttribute("open")).toBe(false);
  });
});
