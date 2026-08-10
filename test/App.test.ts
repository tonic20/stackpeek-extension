import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import App from "../entrypoints/sidepanel/App.svelte";
import * as api from "../lib/api";
import type { DetectResponse } from "../lib/api";
import * as ident from "../lib/install_id";
import { InjectionDeniedError } from "../lib/errors";

beforeEach(() => {
  vi.spyOn(ident, "getInstallId").mockResolvedValue("k1");
});

// Deliberately not named "Custom": ThemeCard renders a "Custom theme" origin
// marker for origin "custom", and a fixture name of "Custom" would collide
// with that marker's own text under a /Custom/ query.
const signals = { shopify: { shop: "demo.myshopify.com", theme: { theme_store_id: null, name: "Handover theme" } },
  script_urls: ["https://cdn.shopify.com/a.js", "https://cdn.judge.me/loader.js"], window_globals: [], meta_tags: [] };
const fakeRunner = async () => ({ signals, url: "https://demo.example/" });

describe("App state machine", () => {
  it("renders apps and theme on a successful shopify result", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true,
      theme: { name: "Handover theme", origin: "custom", version: null, price: null, creator: null },
      apps: [{ name: "Judge.me", category: "Reviews", category_slug: "reviews", slug: "judge-me", app_store_url: "", matched_on: ["url_pattern"], verified: true }],
      pixels: [], unknown_domain_count: 2,
    });
    render(App, { props: { runner: fakeRunner, autostart: true } });
    expect(await screen.findByText("Judge.me")).toBeTruthy();
    expect(await screen.findByText("Handover theme")).toBeTruthy();
    // The origin now reads as the section's count chip rather than as a
    // suffix on the name, which is free to be the merchant's own.
    expect(await screen.findByText("custom")).toBeTruthy();
    expect(await screen.findByText(/2 more/)).toBeTruthy();
  });

  it("renders the not-shopify state", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({ is_shopify: false, theme: null, apps: [], pixels: [], unknown_domain_count: 0 });
    render(App, { props: { runner: fakeRunner, autostart: true } });
    expect(await screen.findByText(/Not a Shopify store/i)).toBeTruthy();
  });

  it("renders an error state on rate limit", async () => {
    vi.spyOn(api, "postDetect").mockRejectedValue(new api.RateLimitError());
    render(App, { props: { runner: fakeRunner, autostart: true } });
    expect(await screen.findByText(/slow down/i)).toBeTruthy();
  });

  it("renders infrastructure entries, which the panel previously dropped", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true,
      theme: { name: "Handover theme", origin: "custom", version: null, price: null, creator: null },
      apps: [],
      pixels: [{ name: "Meta Pixel", category: "Pixel", slug: "meta-pixel" }],
      infrastructure: [
        { name: "Shopify Payments", category: "Payments", slug: "shopify-payments" },
        { name: "Adobe Fonts", category: "Fonts", slug: "adobe-fonts" },
      ],
      unknown_domain_count: 0,
    });
    render(App, { props: { runner: fakeRunner, autostart: true } });
    expect(await screen.findByText("Shopify Payments")).toBeTruthy();
    expect(await screen.findByText("Adobe Fonts")).toBeTruthy();
    expect(await screen.findByText("Meta Pixel")).toBeTruthy();
  });

  it("renders no infrastructure section when the array is empty", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true,
      theme: { name: "Handover theme", origin: "custom", version: null, price: null, creator: null },
      apps: [], pixels: [], infrastructure: [], unknown_domain_count: 0,
    });
    render(App, { props: { runner: fakeRunner, autostart: true } });
    expect(await screen.findByText("Handover theme")).toBeTruthy();
    expect(screen.queryByText(/Infrastructure/i)).toBeNull();
  });

  it("shows the first round's result and then refines it", async () => {
    const first = { is_shopify: true, theme: { name: "Handover theme", origin: "custom" },
      apps: [{ name: "Judge.me", category: "Reviews", category_slug: "reviews", slug: "judge-me", verified: true }],
      pixels: [], infrastructure: [], unknown_domain_count: 0 };
    const second = { ...first, apps: [...first.apps, { name: "Klaviyo", category: "Marketing", category_slug: "marketing", slug: "klaviyo", verified: true }] };
    let call = 0;
    vi.spyOn(api, "postDetect").mockImplementation(async () => (call++ === 0 ? first : second) as any);

    let round = 0;
    const growingRunner = async () => ({
      signals: { shopify: { shop: "demo.myshopify.com" },
        script_urls: round++ === 0 ? ["https://a.example/x.js"] : ["https://a.example/x.js", "https://b.example/y.js"],
        window_globals: [], meta_tags: [] },
      url: "https://demo.example/",
    });

    render(App, { props: { runner: growingRunner, autostart: true, delays: [0, 0] } });
    expect(await screen.findByText("Judge.me")).toBeTruthy();
    expect(await screen.findByText("Klaviyo")).toBeTruthy();
  });

  it("shows the scanned store in the header", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    render(App, { props: { runner: fakeRunner, autostart: true } });

    expect(await screen.findByText("demo.example")).toBeTruthy();
  });

  // The header is persistent chrome -- .sp-hd is position: sticky -- so it must
  // not appear only once a result has arrived.
  it("renders the header before any scan has run", () => {
    render(App, { props: { runner: fakeRunner, autostart: false } });

    expect(screen.getByRole("button", { name: /rescan this page/i })).toBeTruthy();
    expect(document.querySelector('img[src="/icon-32.png"]')).toBeTruthy();
  });

  it("rescans when the header control is clicked after the scan settles", async () => {
    // delays: [0] reaches a fully-settled single-round scan without a
    // still-pending background round left racing this test's own click.
    const send = vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    render(App, { props: { runner: fakeRunner, autostart: true, delays: [0] } });
    await screen.findByText("demo.example");
    const button = screen.getByRole("button", { name: /rescan this page/i });
    await vi.waitFor(() => expect(button).not.toBeDisabled());

    const before = send.mock.calls.length;
    await fireEvent.click(button);

    await vi.waitFor(() => expect(send.mock.calls.length).toBeGreaterThan(before));
  });

  // Pins the re-entrancy guard. While a round is in flight the header shows
  // .sp-scan in the rescan button's place (D5), so there is no control to
  // click: an absent button cannot start a second concurrent runRounds() loop
  // racing the first over shared state (status, data, domain, refining).
  it("replaces rescan with the scan indicator while a scan is in flight", async () => {
    let resolveSend!: (value: DetectResponse) => void;
    const send = vi.spyOn(api, "postDetect").mockImplementation(
      () => new Promise<DetectResponse>((resolve) => { resolveSend = resolve; }),
    );
    // mock.calls persists across tests (nothing here resets it), so compare
    // against a baseline rather than asserting "has been called" outright.
    const before = send.mock.calls.length;
    const { container } = render(App, { props: { runner: fakeRunner, autostart: true, delays: [0] } });

    // Wait for the in-flight send itself, not just the header: status flips to
    // "loading" synchronously on mount, before postDetect is ever called, so
    // asserting on the markup alone would race ahead of resolveSend being
    // assigned.
    await vi.waitFor(() => expect(send.mock.calls.length).toBeGreaterThan(before));
    expect(container.querySelector(".sp-scan")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /rescan this page/i })).toBeNull();

    resolveSend({ is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0 });

    await vi.waitFor(() => expect(screen.getByRole("button", { name: /rescan this page/i })).toBeTruthy());
  });

  // status flips to "result" as soon as the first round's onUpdate fires, but
  // runRounds keeps going while `refining` stays true. Keying the header on
  // status === "loading" would bring the button back the moment that first
  // result renders, letting a click start a second concurrent runRounds() loop
  // mid-refinement -- exactly the race the guard exists to close. Different
  // signals each round keep the loop from settling early, so a genuine
  // refinement window exists between the first render and the guard clearing.
  it("keeps the scan indicator up through refinement, not just the first round", async () => {
    const first = { is_shopify: true, theme: { name: "Handover theme", origin: "custom" },
      apps: [{ name: "Judge.me", category: "Reviews", category_slug: "reviews", slug: "judge-me", verified: true }],
      pixels: [], infrastructure: [], unknown_domain_count: 0 };
    const second = { ...first, apps: [...first.apps, { name: "Klaviyo", category: "Marketing", category_slug: "marketing", slug: "klaviyo", verified: true }] };
    let call = 0;
    vi.spyOn(api, "postDetect").mockImplementation(async () => (call++ === 0 ? first : second) as any);

    let round = 0;
    const growingRunner = async () => ({
      signals: { shopify: { shop: "demo.myshopify.com" },
        script_urls: round++ === 0 ? ["https://a.example/x.js"] : ["https://a.example/x.js", "https://b.example/y.js"],
        window_globals: [], meta_tags: [] },
      url: "https://demo.example/",
    });

    const { container } = render(App, { props: { runner: growingRunner, autostart: true, delays: [0, 0] } });
    // Results are on screen...
    await screen.findByText("Judge.me");
    // ...and the header still says the scan is not finished. D5: the body shows
    // results rather than a second status line competing with them.
    expect(container.querySelector(".sp-scan")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /rescan this page/i })).toBeNull();
    expect(screen.queryByText(/still scanning/i)).toBeNull();
  });

  it("renders the skeleton on the first round, not a bare line of text", async () => {
    vi.spyOn(api, "postDetect").mockImplementation(() => new Promise<DetectResponse>(() => {}));
    const { container } = render(App, { props: { runner: fakeRunner, autostart: true } });

    await vi.waitFor(() => expect(container.querySelector(".sp-skel--theme")).toBeTruthy());
    expect(container.querySelectorAll(".sp-skel--row").length).toBeGreaterThan(0);
  });

  it("renders rate limiting as its own state rather than a generic error", async () => {
    vi.spyOn(api, "postDetect").mockRejectedValue(new api.RateLimitError());
    render(App, { props: { runner: fakeRunner, autostart: true } });

    expect(await screen.findByText("429")).toBeTruthy();
    expect(await screen.findByText(/slow down/i)).toBeTruthy();
  });

  it("renders a network failure as the error state", async () => {
    vi.spyOn(api, "postDetect").mockRejectedValue(new api.ApiError("detect failed: 500"));
    render(App, { props: { runner: fakeRunner, autostart: true } });

    expect(await screen.findByText("network")).toBeTruthy();
    expect(await screen.findByText(/Couldn't reach the detector/)).toBeTruthy();
  });

  // Nothing about the page will change by asking again, so the header offers
  // no rescan either -- the same reasoning as the state's missing action.
  it("hides the header's rescan button on an unscannable page", async () => {
    const emptyRunner = async () => ({ signals: null, url: undefined });
    render(App, { props: { runner: emptyRunner, autostart: true } });

    expect(await screen.findByText("unreadable page")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /rescan this page/i })).toBeNull();
  });

  it("renders a refused injection as needs_permission, not as an unscannable page", async () => {
    const deniedRunner = async () => { throw new InjectionDeniedError("denied"); };
    render(App, { props: { runner: deniedRunner, autostart: true } });

    expect(await screen.findByText("permission")).toBeTruthy();
    expect(await screen.findByText("Open Stackpeek on this store.")).toBeTruthy();
    expect(screen.queryByText(/Can't scan this page/)).toBeNull();
  });

  // Same reasoning as cant_scan: the header must not offer a control that
  // cannot succeed.
  it("hides the header's rescan button when access was refused", async () => {
    const deniedRunner = async () => { throw new InjectionDeniedError("denied"); };
    render(App, { props: { runner: deniedRunner, autostart: true } });

    await screen.findByText("permission");
    expect(screen.queryByRole("button", { name: /rescan this page/i })).toBeNull();
  });

  it("renders trackers as their own section and says so when there are none", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], infrastructure: [], unknown_domain_count: 0,
    });
    render(App, { props: { runner: fakeRunner, autostart: true } });

    expect(await screen.findByText("Trackers")).toBeTruthy();
    expect(await screen.findByText("None detected on this page.")).toBeTruthy();
  });

  it("footers the panel with the privacy link, the theme toggle and the manifest's version", async () => {
    globalThis.chrome = {
      ...(globalThis.chrome ?? {}),
      runtime: { getManifest: () => ({ version: "4.5.6" }) },
      storage: { local: { get: async () => ({}), set: async () => {} } },
    } as unknown as typeof chrome;
    const { container } = render(App, { props: { runner: fakeRunner, autostart: false } });

    const link = screen.getByRole("link", { name: "Privacy" });
    expect(link.getAttribute("href")).toBe("https://stackpeek.app/privacy");
    expect(screen.getByRole("button", { name: /switch to .* theme/i })).toBeTruthy();
    expect(container.querySelector(".sp-ft__v")!.textContent).toBe("v4.5.6");

    // @ts-expect-error `chrome` only exists inside the extension.
    delete globalThis.chrome;
  });

  it("rescans when the tab moves on", async () => {
    const send = vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    let fire!: () => void;
    const watch = (onChange: () => void) => { fire = onChange; return { stop: () => {} }; };
    render(App, { props: { runner: fakeRunner, autostart: true, delays: [0], watch } });
    await screen.findByText("demo.example");
    await vi.waitFor(() => expect(screen.getByRole("button", { name: /rescan this page/i })).toBeTruthy());

    const before = send.mock.calls.length;
    fire();

    await vi.waitFor(() => expect(send.mock.calls.length).toBeGreaterThan(before));
  });

  // Pins D6. A tab change arriving mid-scan must not call runDetection again --
  // that is a second concurrent runRounds loop racing the first over status,
  // data, domain and refining, which is the exact race the hidden rescan button
  // exists to make unreachable. The assertion counts scans rather than
  // inspecting the render, because the race is invisible in the output whenever
  // the timing happens to fall the right way.
  it("queues a tab change that arrives mid-scan instead of racing the run", async () => {
    let resolveSend!: (value: DetectResponse) => void;
    const send = vi.spyOn(api, "postDetect").mockImplementation(
      () => new Promise<DetectResponse>((resolve) => { resolveSend = resolve; }),
    );
    let fire!: () => void;
    const watch = (onChange: () => void) => { fire = onChange; return { stop: () => {} }; };
    const before = send.mock.calls.length;
    render(App, { props: { runner: fakeRunner, autostart: true, delays: [0], watch } });
    await vi.waitFor(() => expect(send.mock.calls.length).toBe(before + 1));

    // Three changes while the first scan is still in flight.
    fire(); fire(); fire();
    expect(send.mock.calls.length).toBe(before + 1);

    resolveSend({ is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0 });

    // Exactly one further scan, however many changes arrived.
    await vi.waitFor(() => expect(send.mock.calls.length).toBe(before + 2));
  });

  it("stops watching when the panel goes away", () => {
    const stop = vi.fn();
    const watch = () => ({ stop });
    const { unmount } = render(App, { props: { runner: fakeRunner, autostart: false, watch } });

    unmount();

    expect(stop).toHaveBeenCalledOnce();
  });

  const digestOf = (over: Record<string, unknown> = {}) => ({
    available: true, count: 2, variants: 3, priceMin: 10, priceMax: 40,
    newest: "2026-08-01T00:00:00Z", currency: "USD",
    index: [
      { handle: "a", title: "Runner up", price: "10.00" },
      { handle: "b", title: "Bestseller", price: "20.00" },
    ],
    ...over,
  });

  it("reads the catalogue once the scan resolves", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    const catalogue = vi.fn(async () => digestOf());
    render(App, { props: { runner: fakeRunner, autostart: true, delays: [0], catalogue } });

    expect(await screen.findByText("Products")).toBeTruthy();
    await vi.waitFor(() => expect(catalogue).toHaveBeenCalledOnce());
    expect(await screen.findByText("2 products · Shopify import format")).toBeTruthy();
  });

  // The panel now rescans on navigation, so "after every scan" would refetch the
  // whole feed on every page the user clicks within one store. The catalogue is
  // a property of the store, not the page (design D4).
  it("does not re-read the catalogue when the same store is rescanned", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    const catalogue = vi.fn(async () => digestOf());
    let fire!: () => void;
    const watch = (onChange: () => void) => { fire = onChange; return { stop: () => {} }; };
    render(App, { props: { runner: fakeRunner, autostart: true, delays: [0], catalogue, watch } });
    await vi.waitFor(() => expect(catalogue).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(screen.getByRole("button", { name: /rescan this page/i })).toBeTruthy());

    fire();

    await vi.waitFor(() => expect(screen.getByRole("button", { name: /rescan this page/i })).toBeTruthy());
    expect(catalogue).toHaveBeenCalledOnce();
  });

  it("re-reads the catalogue when the store changes", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    const catalogue = vi.fn(async () => digestOf());
    let host = "a.example";
    const movingRunner = async () => ({ signals, url: `https://${host}/` });
    let fire!: () => void;
    const watch = (onChange: () => void) => { fire = onChange; return { stop: () => {} }; };
    render(App, { props: { runner: movingRunner, autostart: true, delays: [0], catalogue, watch } });
    await vi.waitFor(() => expect(catalogue).toHaveBeenCalledOnce());

    host = "b.example";
    fire();

    await vi.waitFor(() => expect(catalogue).toHaveBeenCalledTimes(2));
  });

  it("exports the catalogue as a csv", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.fn();
    // Scoped to anchors: testing-library calls createElement("div") for its own
    // container, and a blanket stub hands it this fake and breaks the render.
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string, ...rest: unknown[]) =>
      tag === "a"
        ? ({ click, set href(_v: string) {}, set download(_v: string) {} } as unknown as HTMLAnchorElement)
        : (realCreate as (t: string, ...r: unknown[]) => HTMLElement)(tag, ...rest));

    const catalogue = vi.fn(async () => digestOf());
    const cataloguePage = vi.fn(async (page: number) =>
      page === 1 ? [{ handle: "a", title: "A", variants: [{ price: "1.00" }], images: [] }] : []);
    render(App, { props: { runner: fakeRunner, autostart: true, delays: [0], catalogue, cataloguePage } });
    await screen.findByText("Products");

    await fireEvent.click(await screen.findByRole("button", { name: "Export catalogue CSV" }));

    await vi.waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });

  it("shows the export as failed when a page cannot be read", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    const catalogue = vi.fn(async () => digestOf());
    const cataloguePage = vi.fn(async () => null);
    render(App, { props: { runner: fakeRunner, autostart: true, delays: [0], catalogue, cataloguePage } });
    await screen.findByText("Products");

    await fireEvent.click(await screen.findByRole("button", { name: "Export catalogue CSV" }));

    expect(await screen.findByText("Couldn't read the catalogue.")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
  });

  const gridOf = (hs: string[]) =>
    `<html><body><ul>${hs.map((h) => `<li><a href="/products/${h}">${h}</a></li>`).join("")}</ul></body></html>`;

  it("renders best sellers when the two sorts disagree", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    const catalogue = vi.fn(async () => digestOf());
    const collectionPages = vi.fn(async () => ({
      bestSelling: gridOf(["b", "a"]), alphabetical: gridOf(["a", "b"]),
    }));
    render(App, { props: { runner: fakeRunner, autostart: true, delays: [0], catalogue, collectionPages } });

    expect(await screen.findByText("Best sellers")).toBeTruthy();
    expect(await screen.findByText("Bestseller")).toBeTruthy();
  });

  // The panel-level statement of the guard: a store that ignored sort_by gets no
  // section, not an empty one.
  it("renders no best-sellers section when the store ignored the sort", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    const same = gridOf(["a", "b"]);
    const catalogue = vi.fn(async () => digestOf());
    const collectionPages = vi.fn(async () => ({ bestSelling: same, alphabetical: same }));
    render(App, { props: { runner: fakeRunner, autostart: true, delays: [0], catalogue, collectionPages } });

    await screen.findByText("Products");
    expect(screen.queryByText("Best sellers")).toBeNull();
  });

  it("still shows Products when the collection page cannot be read", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    const catalogue = vi.fn(async () => digestOf());
    const collectionPages = vi.fn(async () => null);
    render(App, { props: { runner: fakeRunner, autostart: true, delays: [0], catalogue, collectionPages } });

    expect(await screen.findByText("2 products · Shopify import format")).toBeTruthy();
    expect(screen.queryByText("Best sellers")).toBeNull();
  });

  // .sp-panel is the design's shell: it carries the container query the wide
  // layout keys on, and the flex column that pins the footer to the bottom.
  it("wraps the panel in the design's shell", () => {
    const { container } = render(App, { props: { runner: fakeRunner, autostart: false } });

    expect(container.querySelector(".sp-panel > .sp-hd")).toBeTruthy();
    expect(container.querySelector(".sp-panel > .sp-body")).toBeTruthy();
    expect(container.querySelector(".sp-panel > .sp-ft")).toBeTruthy();
  });
});
