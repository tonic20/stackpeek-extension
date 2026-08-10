import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import Section from "../entrypoints/sidepanel/components/Section.svelte";
import { loadSections } from "../lib/sections.svelte";

const body = createRawSnippet(() => ({ render: () => `<p class="zz-body">body</p>` }));

// jsdom removes the `open` attribute synchronously on a summary click but
// queues the `toggle` event for a later task, so persistence is not observable
// until the queue drains.
const tick = () => new Promise((r) => setTimeout(r, 0));

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

describe("Section", () => {
  // <details> nests INSIDE <section class="sp-sec"> rather than replacing it.
  // <details> is not a landmark, so replacing the section would drop the region
  // semantics and orphan the aria-labelledby.
  it("keeps the landmark and heads the disclosure with the label and count", () => {
    const { container } = render(Section, { id: "trackers", heading: "Trackers", count: 3, children: body });

    const section = container.querySelector("section.sp-sec")!;
    expect(section.getAttribute("aria-labelledby")).toBe("sp-trackers-label");

    const summary = section.querySelector(":scope > details > summary")!;
    expect(summary.classList.contains("sp-sec__hd")).toBe(true);
    expect(summary.querySelector("#sp-trackers-label")!.textContent).toBe("Trackers");
    expect(summary.querySelector(".sp-count")!.textContent).toBe("3");
    expect(container.querySelector(".zz-body")!.textContent).toBe("body");
  });

  it("renders an empty count slot when given none", () => {
    const { container } = render(Section, { id: "products", heading: "Products", children: body });

    expect(container.querySelector(".sp-count")!.textContent).toBe("");
  });

  it("ships open when the user has never chosen", () => {
    const { container } = render(Section, { id: "apps", heading: "Apps", children: body });

    expect(container.querySelector("details")!.hasAttribute("open")).toBe(true);
  });

  it("opens closed when the record says the user collapsed it", async () => {
    store.sections = { apps: false };
    await loadSections();

    const { container } = render(Section, { id: "apps", heading: "Apps", children: body });

    expect(container.querySelector("details")!.hasAttribute("open")).toBe(false);
  });

  // The siblings' own tests query straight into section bodies without opening
  // anything. <details> hides its children visually, it does not remove them,
  // and this pins that so a remembered collapse cannot silently break them.
  it("still renders its children while collapsed", async () => {
    store.sections = { apps: false };
    await loadSections();

    const { container } = render(Section, { id: "apps", heading: "Apps", children: body });

    expect(container.querySelector(".zz-body")!.textContent).toBe("body");
  });

  it("persists a collapse", async () => {
    const { container } = render(Section, { id: "trackers", heading: "Trackers", children: body });

    container.querySelector("summary")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await tick();

    expect(store.sections).toEqual({ trackers: false });
  });

  it("persists a re-open", async () => {
    store.sections = { trackers: false };
    await loadSections();
    const { container } = render(Section, { id: "trackers", heading: "Trackers", children: body });

    container.querySelector("summary")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await tick();

    expect(store.sections).toEqual({ trackers: true });
  });

  // <details> starts closed natively. Setting open={true} after insertion is a
  // state change that queues a toggle event, but no user asked for it. Writing
  // it back would record a preference the user never expressed. Absent entries
  // are "no opinion" (design D3), not "record the default".
  it("does not write when mounting open with an empty record", async () => {
    const setCalls = vi.mocked(globalThis.chrome.storage.local.set).mock.calls.length;

    render(Section, { id: "apps", heading: "Apps", children: body });
    await tick();

    expect(store.sections).toBeUndefined();
    expect(vi.mocked(globalThis.chrome.storage.local.set).mock.calls).toHaveLength(setCalls);
  });

  it("does not write when mounting closed with a false record", async () => {
    store.sections = { apps: false };
    await loadSections();
    const setCalls = vi.mocked(globalThis.chrome.storage.local.set).mock.calls.length;

    render(Section, { id: "apps", heading: "Apps", children: body });
    await tick();

    expect(store.sections).toEqual({ apps: false });
    expect(vi.mocked(globalThis.chrome.storage.local.set).mock.calls).toHaveLength(setCalls);
  });
});
