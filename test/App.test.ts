import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import App from "../entrypoints/sidepanel/App.svelte";
import * as api from "../lib/api";
import type { DetectResponse } from "../lib/api";
import * as ident from "../lib/install_id";
import { InjectionDeniedError } from "../lib/errors";
import type { ExportWalk } from "../lib/catalogue_types";
import { stubBrowser } from "./setup";

beforeEach(() => {
  vi.spyOn(ident, "getInstallId").mockResolvedValue("k1");
});

// Deliberately not named "Custom": ThemeCard renders a "Custom theme" origin
// marker for origin "custom", and a fixture name of "Custom" would collide
// with that marker's own text under a /Custom/ query.
const signals = { shopify: { shop: "demo.myshopify.com", theme: { theme_store_id: null, name: "Handover theme" } },
  script_urls: ["https://cdn.shopify.com/a.js", "https://cdn.judge.me/loader.js"], window_globals: [], meta_tags: [] };
const fakeRunner = async () => ({ signals, url: "https://demo.example/" });

// For tests that count sends or hold one open. A test that leaves the default
// round schedule running (ROUND_DELAYS_MS: up to 8 s) keeps sending after it
// has unmounted, and those late rounds land on whatever postDetect spy the
// current test installed. Under a loaded run they arrive inside another
// test's window often enough to fail it, so these tests scan a host of their
// own and look only at the sends for it.
const sendsFor = (send: { mock: { calls: unknown[][] } }, host: string) =>
  send.mock.calls.filter(([payload]) => (payload as { url?: string }).url === `https://${host}/`).length;
const runnerFor = (host: string) => async () => ({ signals, url: `https://${host}/` });

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

  it("offers the export deck once a scan has something to export", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true,
      theme: { name: "Dawn", origin: "catalog", version: "15.3.0", price: null, creator: null },
      apps: [], pixels: [], unknown_domain_count: 0,
    });
    render(App, { props: { runner: fakeRunner, autostart: true } });

    expect(await screen.findByRole("button", { name: "Copy as Markdown" })).toBeTruthy();
  });

  // The deck exports the findings -- theme, apps, trackers, infrastructure --
  // not the catalogue. Sitting below Best sellers it read as an export of
  // those, which is the one thing it does not do.
  it("puts the export deck with the findings, above the product sections", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true,
      theme: { name: "Dawn", origin: "catalog", version: "15.3.0", price: null, creator: null },
      apps: [], pixels: [],
      infrastructure: [{ name: "Cloudflare", category: "CDN" }],
      unknown_domain_count: 0,
    });
    const { container } = render(App, { props: { runner: fakeRunner, autostart: true } });
    await screen.findByRole("button", { name: "Copy as Markdown" });

    const order = [...container.querySelectorAll("#sp-section-infrastructure, .sp-deck, #sp-section-products")]
      .map((el) => el.id || el.className.split(" ")[0]);

    expect(order).toEqual(["sp-section-infrastructure", "sp-deck", "sp-section-products"]);
  });

  // Nothing was detected, so there is nothing to hand anyone. Three buttons
  // over a "Not a Shopify store" panel would offer to export that verdict.
  it("hides the export deck when the page is not a store", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({ is_shopify: false, theme: null, apps: [], pixels: [], unknown_domain_count: 0 });
    render(App, { props: { runner: fakeRunner, autostart: true } });
    await screen.findByText(/Not a Shopify store/i);

    expect(screen.queryByRole("button", { name: "Copy as Markdown" })).toBeNull();
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

  // A rescan used to leave the previous store's name over the next store's
  // skeleton until the first result arrived -- seconds, on a slow page.
  it("names the store being scanned as soon as the collector knows it", async () => {
    vi.spyOn(api, "postDetect").mockImplementation(() => new Promise<DetectResponse>(() => {}));
    const runner = (onUrl?: (url: string | undefined) => void) => {
      onUrl?.("https://next.example");
      return new Promise<{ signals: unknown; url: string | undefined }>(() => {});
    };
    const { container } = render(App, { props: { runner, autostart: true } });

    await vi.waitFor(() => expect(container.querySelector(".sp-hd__domain")!.textContent).toBe("next.example"));
    expect(container.querySelector(".sp-skel")).toBeTruthy();
  });

  // Until then the honest header is an empty one: the last store's name above a
  // skeleton says the skeleton is that store's.
  it("stops naming the previous store when a rescan starts", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    let scans = 0;
    const runner = async () => {
      if (scans++ === 0) return fakeRunner();
      return new Promise<{ signals: unknown; url: string | undefined }>(() => {});
    };
    const { container } = render(App, { props: { runner, autostart: true, delays: [0] } });
    await screen.findByText("demo.example");

    await fireEvent.click(await screen.findByRole("button", { name: /rescan this page/i }));

    expect(container.querySelector(".sp-skel")).toBeTruthy();
    expect(container.querySelector(".sp-hd__domain")!.textContent).toBe("");
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

  // The button leaves the DOM while the scan runs (the guard below). Pressed
  // from the keyboard, that dropped focus to <body>, and the next Tab started
  // over from the top of the panel.
  it("keeps keyboard focus with the rescan control through a rescan", async () => {
    let resolveSend!: (value: DetectResponse) => void;
    let calls = 0;
    vi.spyOn(api, "postDetect").mockImplementation((payload) => {
      if ((payload as { url?: string }).url !== "https://focus.example/") return new Promise(() => {});
      if (calls++ === 0) return Promise.resolve({ is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0 });
      return new Promise<DetectResponse>((resolve) => { resolveSend = resolve; });
    });
    const { container } = render(App, { props: { runner: runnerFor("focus.example"), autostart: true, delays: [0] } });
    const button = await screen.findByRole("button", { name: /rescan this page/i });

    button.focus();
    await fireEvent.click(button);

    await vi.waitFor(() => expect(document.activeElement).toBe(container.querySelector(".sp-scan")));
    resolveSend({ is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0 });
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /rescan this page/i })));
  });

  // A scan the user did not start from the header must not pull focus there.
  it("leaves focus alone for a scan started any other way", async () => {
    const send = vi.spyOn(api, "postDetect").mockResolvedValue({ is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0 });
    let fire!: () => void;
    const watch = (onChange: () => void) => { fire = onChange; return { stop: () => {} }; };
    render(App, { props: { runner: runnerFor("unfocused.example"), autostart: true, delays: [0], watch } });
    const toggle = await screen.findByRole("button", { name: /switch to .* theme/i });
    await screen.findByRole("button", { name: /rescan this page/i });

    toggle.focus();
    fire();
    await vi.waitFor(() => expect(sendsFor(send, "unfocused.example")).toBe(2));
    await vi.waitFor(() => expect(screen.getByRole("button", { name: /rescan this page/i })).toBeTruthy());

    expect(document.activeElement).toBe(toggle);
  });

  // Pins the re-entrancy guard. While a round is in flight the header shows
  // .sp-scan in the rescan button's place (D5), so there is no control to
  // click: an absent button cannot start a second concurrent runRounds() loop
  // racing the first over shared state (status, data, domain, refining).
  it("replaces rescan with the scan indicator while a scan is in flight", async () => {
    let resolveSend!: (value: DetectResponse) => void;
    // Captures only this test's own send: a leftover round from another test
    // would otherwise overwrite resolveSend with a promise nobody awaits.
    const send = vi.spyOn(api, "postDetect").mockImplementation(
      (payload) => new Promise<DetectResponse>((resolve) => {
        if ((payload as { url?: string }).url === "https://inflight.example/") resolveSend = resolve;
      }),
    );
    const { container } = render(App, { props: { runner: runnerFor("inflight.example"), autostart: true, delays: [0] } });

    // Wait for the in-flight send itself, not just the header: status flips to
    // "loading" synchronously on mount, before postDetect is ever called, so
    // asserting on the markup alone would race ahead of resolveSend being
    // assigned.
    await vi.waitFor(() => expect(sendsFor(send, "inflight.example")).toBe(1));
    expect(container.querySelector(".sp-scan")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /rescan this page/i })).toBeNull();

    resolveSend({ is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0 });

    await vi.waitFor(() => expect(screen.getByRole("button", { name: /rescan this page/i })).toBeTruthy());
  });

  // The header's "Scanning…" stays up through the later rounds by design (D5),
  // and must come down once the last one settles -- here the second round,
  // which collects the same signals as the first and is sent as final. A
  // screenshot taken between the two shows the spinner over a finished-looking
  // result; this pins that it does not stay there.
  it.each([
    ["a result", { is_shopify: true, theme: { name: "Dawn", origin: "catalog" }, apps: [], pixels: [], unknown_domain_count: 0 }, ".sp-theme"],
    ["the not-Shopify state", { is_shopify: false, theme: null, apps: [], pixels: [], unknown_domain_count: 0 }, ".sp-state"],
  ])("takes the scan indicator down once the last round settles over %s", async (_name, response, body) => {
    const send = vi.spyOn(api, "postDetect").mockResolvedValue(response as DetectResponse);
    const { container } = render(App, { props: { runner: runnerFor("settles.example"), autostart: true, delays: [0, 30] } });

    await vi.waitFor(() => expect(container.querySelector(body)).toBeTruthy());
    await vi.waitFor(() => expect(container.querySelector(".sp-scan")).toBeNull());

    expect(screen.getByRole("button", { name: /rescan this page/i })).toBeTruthy();
    const finals = send.mock.calls
      .map(([payload]) => payload as { url?: string; final?: boolean })
      .filter((payload) => payload.url === "https://settles.example/")
      .map((payload) => payload.final);
    expect(finals).toEqual([false, true]);
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

  // The API has just said no. A Retry that works at once, or a tab switch
  // that goes straight back to it, spends more of a limit that is already
  // spent -- up to four requests a scan.
  it("holds every rescan back through a rate-limit wait", async () => {
    const send = vi.spyOn(api, "postDetect").mockRejectedValue(new api.RateLimitError("rate limited", 30_000));
    let fire!: () => void;
    const watch = (onChange: () => void) => { fire = onChange; return { stop: () => {} }; };
    render(App, { props: { runner: runnerFor("wait.example"), autostart: true, delays: [0], watch } });
    await screen.findByText("429");

    expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /rescan this page/i })).toBeDisabled();
    fire(); fire(); fire();
    await new Promise((r) => setTimeout(r, 20));

    expect(sendsFor(send, "wait.example")).toBe(1);
  });

  // Whatever is on screen once the wait ends describes a page the user has
  // left, so the switch that arrived during it is not dropped -- it runs, once.
  it("runs one deferred rescan when the wait is over", async () => {
    let refused = false;
    const send = vi.spyOn(api, "postDetect").mockImplementation(async () => {
      if (!refused) { refused = true; throw new api.RateLimitError("rate limited", 150); }
      return { is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0 };
    });
    let fire!: () => void;
    const watch = (onChange: () => void) => { fire = onChange; return { stop: () => {} }; };
    render(App, { props: { runner: runnerFor("deferred.example"), autostart: true, delays: [0], watch } });
    await screen.findByText("429");

    fire(); fire();

    expect(await screen.findByText("deferred.example")).toBeTruthy();
    expect(sendsFor(send, "deferred.example")).toBe(2);
  });

  // Nothing asked for a scan during the wait, so nothing runs at its end: the
  // user decides when to press Retry.
  it("re-enables Retry when the wait is over, without scanning by itself", async () => {
    const send = vi.spyOn(api, "postDetect").mockRejectedValue(new api.RateLimitError("rate limited", 100));
    render(App, { props: { runner: runnerFor("idle.example"), autostart: true, delays: [0] } });
    await screen.findByText("429");

    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).not.toBeDisabled());

    expect(sendsFor(send, "idle.example")).toBe(1);
  });

  // runRounds swallows a refusal on a later round to keep the result on screen,
  // so the panel never shows the 429 state -- but the limit is just as spent,
  // and the next tab switch must not go straight back to it.
  it("waits out a 429 on a later round too, with the result left on screen", async () => {
    const first = { is_shopify: true, theme: { name: "Dawn", origin: "catalog" }, apps: [], pixels: [], unknown_domain_count: 0 };
    let call = 0;
    const send = vi.spyOn(api, "postDetect").mockImplementation(async () => {
      if (call++ === 0) return first as any;
      throw new api.RateLimitError("rate limited", 30_000);
    });
    let round = 0;
    const growingRunner = async () => ({
      signals: { ...signals, script_urls: round++ === 0 ? ["https://a.example/x.js"] : ["https://a.example/x.js", "https://b.example/y.js"] },
      url: "https://later.example/",
    });
    let fire!: () => void;
    const watch = (onChange: () => void) => { fire = onChange; return { stop: () => {} }; };
    render(App, { props: { runner: growingRunner, autostart: true, delays: [0, 0], watch } });
    await vi.waitFor(() => expect(screen.getByRole("button", { name: /rescan this page/i })).toBeDisabled());

    fire();
    await new Promise((r) => setTimeout(r, 20));

    expect(screen.getByText("Dawn")).toBeTruthy();
    expect(sendsFor(send, "later.example")).toBe(2);
  });

  it("renders a network failure as the error state", async () => {
    vi.spyOn(api, "postDetect").mockRejectedValue(new api.NetworkError("TypeError: Failed to fetch"));
    render(App, { props: { runner: fakeRunner, autostart: true } });

    expect(await screen.findByText("network")).toBeTruthy();
    expect(await screen.findByText(/Couldn't reach the detector/)).toBeTruthy();
    expect(screen.getByText(/Check your connection/)).toBeTruthy();
  });

  // Each failure says the thing its user can act on. One shared "Couldn't
  // reach the detector" sent someone whose wifi had dropped and someone
  // looking at our own 500 to check the same connection.
  it.each([
    [new api.OfflineError("TypeError: Failed to fetch"), "offline", "You're offline."],
    [new api.TimeoutError("detect timed out"), "timeout", "The detector took too long."],
    [new api.ServerError("detect failed: 502"), "server", "The detector had a problem."],
  ])("tells %s apart from an unreachable detector", async (error, code, title) => {
    vi.spyOn(api, "postDetect").mockRejectedValue(error);
    render(App, { props: { runner: fakeRunner, autostart: true } });

    expect(await screen.findByText(code)).toBeTruthy();
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.queryByText(/Couldn't reach the detector/)).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  // A fault of ours before any request was made is not evidence of anything
  // about the detector, so it keeps the wording it always had.
  it("keeps the network wording for a failure that is not an API one", async () => {
    vi.spyOn(api, "postDetect").mockRejectedValue(new Error("something else"));
    render(App, { props: { runner: fakeRunner, autostart: true } });

    expect(await screen.findByText("network")).toBeTruthy();
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

  // The header names the store the body describes, and a refused scan
  // describes no store at all. Leaving the last one there puts "Open Stackpeek
  // on this store" directly beneath somebody else's domain, which reads as
  // that store having refused us.
  it("stops naming the last store once a scan is refused", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    // Scans the store, then loses access -- which is what a rescan after the
    // tab navigated somewhere unreadable actually looks like.
    let scans = 0;
    const runner = async () => {
      if (scans++ > 0) throw new InjectionDeniedError("denied");
      return fakeRunner();
    };
    render(App, { props: { runner, autostart: true, delays: [0] } });
    await screen.findByText("demo.example");
    const rescan = await screen.findByRole("button", { name: /rescan this page/i });

    rescan.click();

    expect(await screen.findByText("Open Stackpeek on this store.")).toBeTruthy();
    expect(screen.queryByText("demo.example")).toBeNull();
  });

  // The whole point of the state is the toolbar click it asks for. The watcher
  // reports that click (lib/tab_watcher.ts), and the panel has to take it as a
  // reason to scan again -- not leave the instruction standing under the
  // access it just received.
  it("scans again once the toolbar click has granted access", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    let granted = false;
    const runner = async () => {
      if (!granted) throw new InjectionDeniedError("denied");
      return fakeRunner();
    };
    let clicked!: () => void;
    const watch = (onChange: () => void) => { clicked = onChange; return { stop: () => {} }; };
    render(App, { props: { runner, autostart: true, delays: [0], watch } });
    await screen.findByText("Open Stackpeek on this store.");

    granted = true;
    clicked();

    expect(await screen.findByText("demo.example")).toBeTruthy();
    expect(screen.queryByText("Open Stackpeek on this store.")).toBeNull();
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

  it("footers the panel with the theme toggle and the manifest's version, and no privacy link", async () => {
    stubBrowser({
      ...(globalThis.chrome ?? {}),
      runtime: { getManifest: () => ({ version: "4.5.6" }) },
      storage: { local: { get: async () => ({}), set: async () => {} } },
    });
    const { container } = render(App, { props: { runner: fakeRunner, autostart: false } });

    expect(screen.queryByRole("link", { name: "Privacy" })).toBeNull();
    expect(screen.getByRole("button", { name: /switch to .* theme/i })).toBeTruthy();
    expect(container.querySelector(".sp-ft__v")!.textContent).toBe("v4.5.6");

    stubBrowser({});
  });

  // The footer is the only way back to the product from inside the panel.
  it("footers the panel with a review link, a feedback address and the site", () => {
    stubBrowser({
      ...(globalThis.chrome ?? {}),
      runtime: { id: "vitest", getManifest: () => ({ version: "4.5.6" }) },
      storage: { local: { get: async () => ({}), set: async () => {} } },
    });
    const { container } = render(App, { props: { runner: fakeRunner, autostart: false } });
    const footer = container.querySelector(".sp-ft") as HTMLElement;

    expect(screen.getByRole("link", { name: "Rate us" }).getAttribute("href"))
      .toBe("https://chromewebstore.google.com/detail/membonhdocoehieifbkfkdjmpappflan/reviews");
    expect(screen.getByRole("link", { name: "Feedback" }).getAttribute("href")).toBe("mailto:hello@stackpeek.app");
    // Named for where it goes, with the visible text still in the name.
    expect(screen.getByRole("link", { name: "stackpeek.app v4.5.6" }).getAttribute("href")).toBe("https://stackpeek.app");
    // Still one row of three: the links travel together, then the toggle, then
    // the version.
    expect([...footer.children].map((el) => el.tagName)).toEqual(["SPAN", "BUTTON", "A"]);

    stubBrowser({});
  });

  // A plain new tab fires the tab watcher, and the rescan that followed
  // replaced the result with a permission error about our own site or a store
  // listing. Held like the theme and app links instead.
  it("opens the footer's pages as held tabs, so the result stays on screen", async () => {
    const create = vi.fn(async (_props: { url: string; active: boolean }) => ({ id: 31 }));
    stubBrowser({
      ...(globalThis.chrome ?? {}),
      runtime: { id: "vitest", getManifest: () => ({ version: "4.5.6" }) },
      tabs: { create },
      storage: { local: { get: async () => ({}), set: async () => {} } },
    });
    try {
      render(App, { props: { runner: fakeRunner, autostart: false, watch: () => ({ stop: () => {} }) } });

      await fireEvent.click(screen.getByRole("link", { name: "Rate us" }), { button: 0 });
      await fireEvent.click(screen.getByRole("link", { name: "stackpeek.app v4.5.6" }), { button: 0 });

      expect(create.mock.calls.map(([props]) => props.url)).toEqual([
        "https://chromewebstore.google.com/detail/membonhdocoehieifbkfkdjmpappflan/reviews",
        "https://stackpeek.app/",
      ]);
    } finally {
      stubBrowser({});
    }
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
      (payload) => new Promise<DetectResponse>((resolve) => {
        if ((payload as { url?: string }).url === "https://queued.example/") resolveSend = resolve;
      }),
    );
    let fire!: () => void;
    const watch = (onChange: () => void) => { fire = onChange; return { stop: () => {} }; };
    render(App, { props: { runner: runnerFor("queued.example"), autostart: true, delays: [0], watch } });
    await vi.waitFor(() => expect(sendsFor(send, "queued.example")).toBe(1));

    // Three changes while the first scan is still in flight.
    fire(); fire(); fire();
    expect(sendsFor(send, "queued.example")).toBe(1);

    resolveSend({ is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0 });

    // Exactly one further scan, however many changes arrived.
    await vi.waitFor(() => expect(sendsFor(send, "queued.example")).toBe(2));
  });

  // Following one of the panel's own theme/app links used to replace the store
  // the user had just read with a permission error about the listing page.
  // The results stay; what changes is that the panel says out loud that the
  // tab in front of the user is not the one they describe.
  it("keeps the store on screen, and says so, while a listing tab is in front", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: { name: "Dawn", origin: "catalog" }, apps: [], pixels: [],
      unknown_domain_count: 0,
    });
    let hold!: (holding: boolean) => void;
    const watch = (_onChange: () => void, opts?: { onHold?: (h: boolean) => void }) => {
      hold = opts!.onHold!;
      return { stop: () => {} };
    };
    render(App, { props: { runner: fakeRunner, autostart: true, delays: [0], watch } });
    await screen.findByText("demo.example");

    hold(true);

    expect(await screen.findByText(/still showing demo\.example/i)).toBeTruthy();
    expect(screen.getByText("Dawn")).toBeTruthy();
  });

  it("drops the notice when the user goes back to the store tab", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    let hold!: (holding: boolean) => void;
    const watch = (_onChange: () => void, opts?: { onHold?: (h: boolean) => void }) => {
      hold = opts!.onHold!;
      return { stop: () => {} };
    };
    render(App, { props: { runner: fakeRunner, autostart: true, delays: [0], watch } });
    await screen.findByText("demo.example");

    hold(true);
    await screen.findByText(/still showing demo\.example/i);
    hold(false);

    await vi.waitFor(() => expect(screen.queryByText(/still showing/i)).toBeNull());
  });

  it("stops watching when the panel goes away", () => {
    const stop = vi.fn();
    const watch = () => ({ stop });
    const { unmount } = render(App, { props: { runner: fakeRunner, autostart: false, watch } });

    unmount();

    expect(stop).toHaveBeenCalledOnce();
  });

  const digestOf = (over: Record<string, unknown> = {}) => ({
    available: true, reason: null, count: 2, variants: 3, priceMin: 10, priceMax: 40,
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

  // A capped read cannot be ranked by joining: the index is the first 10,000
  // products and the best-selling order covers all of them, so the join drops
  // whatever ranks above the cap and renumbers the survivors from 1. The panel
  // already had the right answer one line further down -- Shopify's own
  // BEST_SELLING sort, which no read cap touches -- and this is what makes it
  // reachable. The collection pages below are deliberately good: the fallback
  // must fire because the READ was capped, not because the pages were bad.
  it("asks Shopify for the ranking when the catalogue read was capped", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    const catalogue = vi.fn(async () => digestOf({ count: 10000, capped: true }));
    const storefrontCatalogue = vi.fn(async () => digestOf({ count: 34935, variants: null }));
    const collectionPages = vi.fn(async () => ({
      bestSelling: gridOf(["b", "a"]), alphabetical: gridOf(["a", "b"]),
    }));
    const storefrontBestSellers = vi.fn(async () => [
      { handle: "z", title: "Actual number one", price: "9.00" },
      { handle: "y", title: "Actual number two", price: "8.00" },
    ]);
    render(App, { props: { runner: fakeRunner, autostart: true, delays: [0], catalogue,
                           storefrontCatalogue, collectionPages, storefrontBestSellers } });

    expect(await screen.findByText("Actual number one")).toBeTruthy();
    expect(storefrontBestSellers).toHaveBeenCalled();
    // The prefix join's answer, which must not be what "#1" points at.
    expect(screen.queryByText("Bestseller")).toBeNull();
  });

  // Its own postDetect mock, like the tests below it: this file sets no
  // clearMocks, so without one this test would inherit whatever spy a
  // preceding test happened to leave behind -- and if that spy ever stopped
  // resolving is_shopify: true, ProductSummary would never render and the
  // assertions here would fail for a reason that has nothing to do with the
  // fallback.
  it("falls back to the Storefront path when products.json is not public", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    const storefront = vi.fn(async () => ({
      available: true, reason: null, count: 41762, variants: null, priceMin: 0.75,
      priceMax: 299.99, newest: null, currency: "USD", index: [],
    }));
    render(App, {
      runner: async () => ({ signals: {}, url: "https://headless.example/" }),
      catalogue: async () => ({ available: false, reason: "not_public", count: 0, variants: null,
        priceMin: null, priceMax: null, newest: null, currency: null, index: [] }),
      storefrontCatalogue: storefront,
      watch: () => ({ stop: () => {} }),
      delays: [0],
    });
    await waitFor(() => expect(storefront).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("41,762")).toBeTruthy());
  });

  // The panel-level statement of the fix: a headless store whose catalogue is
  // larger than the export can reach must say so where the count is shown.
  // Before this, the Storefront digest never set `capped`, ProductSummary's
  // disclosure branch never fired, and the user got 10,000 of 41,762 products
  // with nothing anywhere saying so.
  it("discloses the export ceiling on a Storefront catalogue larger than it", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    render(App, {
      runner: async () => ({ signals: {}, url: "https://headless.example/" }),
      catalogue: async () => ({ available: false, reason: "not_public", count: 0, variants: null,
        priceMin: null, priceMax: null, newest: null, currency: null, index: [] }),
      storefrontCatalogue: async () => ({ available: true, reason: null, count: 41762, capped: true,
        variants: null, priceMin: null, priceMax: null, newest: null, currency: "USD", index: [] }),
      watch: () => ({ stop: () => {} }),
      delays: [0],
    });

    expect(await screen.findByText("41,762 products · exports the first 10,000")).toBeTruthy();
  });

  // The cap-buster adopts the sitemap's exact count, and the variant total must
  // not be left standing beside it. That figure was summed over the first
  // 10,000 products the walk could reach, so under a 34,935-product total it is
  // a floor presented as a total -- the same overclaim the cap-buster exists to
  // remove, one row further down the panel. An em dash is what the panel
  // already says for "we did not read this".
  it("drops the variant total when it adopts an exact count it did not count variants for", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    const { container } = render(App, {
      runner: async () => ({ signals: {}, url: "https://kith.example/" }),
      // What a 40-page walk of a bigger feed returns: the cap as a count, and a
      // variant total counted from exactly those 10,000 products.
      catalogue: async () => ({ available: true, reason: null, count: 10000, capped: true,
        variants: 26431, priceMin: 18, priceMax: 240, newest: null, currency: "USD", index: [] }),
      storefrontCatalogue: async () => ({ available: true, reason: null, count: 34935, variants: null,
        priceMin: null, priceMax: null, newest: null, currency: "USD", index: [] }),
      watch: () => ({ stop: () => {} }),
      delays: [0],
    });

    expect(await screen.findByText("34,935 products · exports the first 10,000")).toBeTruthy();
    const variants = [ ...container.querySelectorAll(".sp-fact") ]
      .find((fact) => fact.querySelector(".sp-fact__k")?.textContent === "Variants")!;
    expect(variants.querySelector(".sp-fact__v")!.textContent).toBe("—");
    expect(screen.queryByText("26,431")).toBeNull();
  });

  // The same fault as the variant total, one row over. /products.json is served
  // published_at DESCENDING, so the 10,000 the walk reached are the NEWEST
  // 10,000 and the unread remainder is systematically the older stock -- where
  // clearance pricing lives. Both endpoints are therefore bounds in the wrong
  // direction: the true minimum can only be lower and the true maximum only
  // higher. Printed under a 34,935-product total it reads as the range of all
  // of them.
  it("drops the price range when it adopts an exact count it did not price", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    const { container } = render(App, {
      runner: async () => ({ signals: {}, url: "https://kith.example/" }),
      catalogue: async () => ({ available: true, reason: null, count: 10000, capped: true,
        variants: 26431, priceMin: 6, priceMax: 43200, newest: null, currency: "USD", index: [] }),
      storefrontCatalogue: async () => ({ available: true, reason: null, count: 34935, variants: null,
        priceMin: null, priceMax: null, newest: null, currency: "USD", index: [] }),
      watch: () => ({ stop: () => {} }),
      delays: [0],
    });

    expect(await screen.findByText("34,935 products · exports the first 10,000")).toBeTruthy();
    const range = [ ...container.querySelectorAll(".sp-fact") ]
      .find((fact) => fact.querySelector(".sp-fact__k")?.textContent === "Price range")!;
    expect(range.querySelector(".sp-fact__v")!.textContent).toBe("—");
  });

  // The sitemap 403s, the API answers. The catalogue is readable and the export
  // works; only its size is unknown, and an unknown size renders as no size.
  it("states no product count when the Storefront path could not read one", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    const { container } = render(App, {
      runner: async () => ({ signals: {}, url: "https://headless.example/" }),
      catalogue: async () => ({ available: false, reason: "not_public", count: 0, variants: null,
        priceMin: null, priceMax: null, newest: null, currency: null, index: [] }),
      storefrontCatalogue: async () => ({ available: true, reason: null, count: null, variants: null,
        priceMin: 1, priceMax: 9, newest: null, currency: "USD", index: [] }),
      watch: () => ({ stop: () => {} }),
      delays: [0],
    });

    expect(await screen.findByText("Shopify import format")).toBeTruthy();
    expect(screen.queryByText(/0 products/)).toBeNull();
    expect(container.querySelector('[aria-labelledby="sp-products-label"] .sp-count')!.textContent).toBe("");
    expect(screen.getByRole("button", { name: "Export catalogue CSV" })).not.toBeDisabled();
  });

  // A read that failed is not evidence the store has no catalogue, so the
  // second source must not be consulted -- and the honest message must survive.
  //
  // The postDetect mock is load-bearing, not boilerplate. This is the only
  // automated proof that the fallback fires on "not_public" and never on
  // "unreadable", and without a Shopify result there is no ProductSummary at
  // all -- `expect(storefront).not.toHaveBeenCalled()` would then pass
  // vacuously, guarding nothing.
  it("does not fall back when the read merely failed", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    const storefront = vi.fn();
    render(App, {
      runner: async () => ({ signals: {}, url: "https://s.example/" }),
      catalogue: async () => ({ available: false, reason: "unreadable", count: 0, variants: null,
        priceMin: null, priceMax: null, newest: null, currency: null, index: [] }),
      storefrontCatalogue: storefront,
      watch: () => ({ stop: () => {} }),
      delays: [0],
    });
    await waitFor(() => expect(screen.getByText("Couldn't read the catalogue.")).toBeTruthy());
    expect(storefront).not.toHaveBeenCalled();
  });

  // The button that proves Retry is not dead: clicking it must re-attempt the
  // READ (not the export, which bails immediately on an unavailable digest and
  // was the original bug). Self-contained -- its own postDetect mock and its
  // own catalogue mock -- because this file has no clearMocks/restoreMocks and
  // relying on state left by a neighbouring test has caused trouble here before.
  it("re-reads the catalogue when Retry is clicked on an unreadable digest", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    const catalogue = vi.fn()
      .mockResolvedValueOnce({
        available: false, reason: "unreadable", count: 0, variants: null,
        priceMin: null, priceMax: null, newest: null, currency: null, index: [],
      })
      .mockResolvedValueOnce(digestOf());

    render(App, { props: { runner: fakeRunner, autostart: true, delays: [0], catalogue } });

    expect(await screen.findByText("Couldn't read the catalogue.")).toBeTruthy();
    expect(catalogue).toHaveBeenCalledOnce();

    await fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("2 products · Shopify import format")).toBeTruthy();
    expect(catalogue).toHaveBeenCalledTimes(2);
  });

  it("exports through the Storefront path when that is where the digest came from", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    const storefrontExport = vi.fn(async () =>
      ({ products: [{ handle: "a", title: "A", variants: [], images: [] }], truncated: false }));
    render(App, {
      runner: async () => ({ signals: {}, url: "https://headless.example/" }),
      catalogue: async () => ({ available: false, reason: "not_public", count: 0, variants: null,
        priceMin: null, priceMax: null, newest: null, currency: null, index: [] }),
      storefrontCatalogue: async () => ({ available: true, reason: null, count: 3, variants: null,
        priceMin: 1, priceMax: 9, newest: null, currency: "USD", index: [] }),
      storefrontExport,
      watch: () => ({ stop: () => {} }),
      delays: [0],
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /Export/ })).toBeTruthy());
    await fireEvent.click(screen.getByRole("button", { name: /Export/ }));
    await waitFor(() => expect(storefrontExport).toHaveBeenCalled());
  });

  // Captures what the download was actually named, which is where a truncated
  // export now discloses itself.
  const captureDownload = () => {
    const named: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string, ...rest: unknown[]) =>
      tag === "a"
        ? ({ click: () => {}, set href(_v: string) {}, set download(v: string) { named.push(v); } } as unknown as HTMLAnchorElement)
        : (realCreate as (t: string, ...r: unknown[]) => HTMLElement)(tag, ...rest));
    return named;
  };

  const headless = (
    count: number,
    storefrontExport: (onProgress: (done: number) => void) => Promise<ExportWalk | null>,
  ) => ({
    runner: async () => ({ signals: {}, url: "https://headless.example/" }),
    catalogue: async () => ({ available: false, reason: "not_public" as const, count: 0, variants: null,
      priceMin: null, priceMax: null, newest: null, currency: null, index: [] }),
    storefrontCatalogue: async () => ({ available: true, reason: null, count, capped: true, variants: null,
      priceMin: 1, priceMax: 9, newest: null, currency: "USD", index: [] }),
    storefrontExport,
    watch: () => ({ stop: () => {} }),
    delays: [0],
  });

  // The bug this pair exists for: the export reached its 10,000-product ceiling
  // and the panel still counted it against 41,762, so the bar crawled to a
  // quarter full and then announced success. A denominator the walk cannot
  // reach is not a denominator.
  it("counts export progress against what the export can reach, not the store's size", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const storefrontExport = vi.fn(async (onProgress: (done: number) => void) => {
      onProgress(250);
      await gate;
      return { products: [{ handle: "a", title: "A", variants: [], images: [] }], truncated: true };
    });
    render(App, headless(41762, storefrontExport));

    await waitFor(() => expect(screen.getByRole("button", { name: /Export/ })).toBeTruthy());
    await fireEvent.click(screen.getByRole("button", { name: /Export/ }));

    expect(await screen.findByText("250 / 10,000")).toBeTruthy();
    release();
  });

  it("names a truncated export for what it holds and what the store has", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    const named = captureDownload();
    const storefrontExport = vi.fn(async () =>
      ({ products: [{ handle: "a", title: "A", variants: [], images: [] }], truncated: true }));
    render(App, headless(41762, storefrontExport));

    await waitFor(() => expect(screen.getByRole("button", { name: /Export/ })).toBeTruthy());
    await fireEvent.click(screen.getByRole("button", { name: /Export/ }));

    await waitFor(() => expect(named).toHaveLength(1));
    expect(named[0]).toMatch(/^headless\.example-products-first-1-of-41762-\d{4}-\d{2}-\d{2}\.csv$/);
    vi.restoreAllMocks();
  });

  // The /products.json walk hits the same ceiling and has to say so the same
  // way -- the two paths differ in how they read a store, never in how honest
  // the file they produce is.
  it("names a truncated /products.json export the same way", async () => {
    vi.spyOn(api, "postDetect").mockResolvedValue({
      is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
    });
    const named = captureDownload();
    // Every page comes back full, so the walk runs out of pages rather than
    // products -- 40 x 250 = 10,000 exported against a store of 12,000.
    const full = Array.from({ length: 250 }, (_, i) => ({ handle: `h${i}`, variants: [], images: [] }));
    const cataloguePage = vi.fn(async () => full);
    render(App, {
      runner: fakeRunner,
      autostart: true,
      delays: [0],
      catalogue: async () => ({ available: true, reason: null, count: 12000, capped: true, variants: 1,
        priceMin: 1, priceMax: 9, newest: null, currency: "USD", index: [] }),
      // The cap-buster runs on a capped digest; an unreadable sitemap leaves the
      // count this test set, which is the figure the name has to carry.
      storefrontCatalogue: async () => ({ available: false, reason: "unreadable" as const, count: null,
        variants: null, priceMin: null, priceMax: null, newest: null, currency: null, index: [] }),
      storefrontBestSellers: async () => [],
      cataloguePage,
      watch: () => ({ stop: () => {} }),
    });
    await screen.findByText("Products");

    await fireEvent.click(await screen.findByRole("button", { name: "Export catalogue CSV" }));

    await waitFor(() => expect(named).toHaveLength(1));
    expect(named[0]).toMatch(/^demo\.example-products-first-10000-of-12000-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(cataloguePage).toHaveBeenCalledTimes(40);
    vi.restoreAllMocks();
  });

  // .sp-panel is the design's shell: it carries the container query the wide
  // layout keys on, and the flex column that pins the footer to the bottom.
  it("wraps the panel in the design's shell", () => {
    const { container } = render(App, { props: { runner: fakeRunner, autostart: false } });

    expect(container.querySelector(".sp-panel > .sp-hd")).toBeTruthy();
    expect(container.querySelector(".sp-panel > .sp-body")).toBeTruthy();
    expect(container.querySelector(".sp-panel > .sp-ft")).toBeTruthy();
  });

  // A stand-in for lib/host_access.ts, whose real browser calls are covered in
  // test/host_access.test.ts.
  const fakeAccess = (initial: boolean) => {
    let granted = initial;
    let notify: (g: boolean) => void = () => {};
    const access = {
      has: vi.fn(async () => granted),
      request: vi.fn(async () => { granted = true; return true; }),
      remove: vi.fn(async () => { granted = false; return true; }),
      watch: vi.fn((cb: (g: boolean) => void) => { notify = cb; return { stop: () => {} }; }),
      blocksAutoScan: vi.fn(async () => false),
    };
    return { access, grantElsewhere: () => { granted = true; notify(true); } };
  };

  describe("auto-scan", () => {
    // Outside an extension there is no permissions API, and a switch that
    // cannot work is worse than none.
    it("offers no switch where access cannot be asked for", () => {
      render(App, { props: { runner: fakeRunner, autostart: false } });

      expect(screen.queryByRole("switch")).toBeNull();
    });

    it("offers the switch off, with what it means, until it is turned on", async () => {
      const { access } = fakeAccess(false);
      render(App, { props: { runner: fakeRunner, autostart: false, access } });

      const toggle = await screen.findByRole("switch", { name: "Scan automatically as I switch tabs" });
      expect(toggle.getAttribute("aria-checked")).toBe("false");
      expect(screen.getByText(/Needs access to all sites/)).toBeTruthy();

      await fireEvent.click(toggle);

      // Inside the click, not after something it awaited: the gesture ends there.
      expect(access.request).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
      expect(screen.queryByText(/Needs access to all sites/)).toBeNull();
    });

    it("hands the access back when turned off", async () => {
      const { access } = fakeAccess(true);
      render(App, { props: { runner: fakeRunner, autostart: false, access } });
      const toggle = await screen.findByRole("switch");
      await vi.waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));

      await fireEvent.click(toggle);

      expect(access.remove).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));
    });

    // The one-click fix next to "click the icon", and only once on screen: the
    // row above the footer steps aside while the state is offering it.
    it("offers the switch beside needs_permission, and scans once it is on", async () => {
      vi.spyOn(api, "postDetect").mockResolvedValue({ is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0 });
      const { access } = fakeAccess(false);
      let granted = false;
      const runner = async () => {
        if (!granted) throw new InjectionDeniedError("denied");
        return runnerFor("granted.example")();
      };
      const { container } = render(App, { props: { runner, autostart: true, delays: [0], access } });
      await screen.findByText("Open Stackpeek on this store.");
      await screen.findByText("Or scan without clicking:");

      const switches = screen.getAllByRole("switch");
      expect(switches).toHaveLength(1);
      expect(container.querySelector(".sp-state")!.contains(switches[0]!)).toBe(true);

      granted = true;
      await fireEvent.click(switches[0]!);

      expect(await screen.findByText("granted.example")).toBeTruthy();
    });

    // Chrome's site-access menu, Firefox's Permissions tab, or Chrome firing
    // onAdded for the grant the switch itself just made: the answer changed,
    // and needs_permission is now wrong. Exactly one scan, however many
    // routes report the same grant.
    it("scans once when access arrives from anywhere while needs_permission is up", async () => {
      const send = vi.spyOn(api, "postDetect").mockResolvedValue({ is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0 });
      const { access, grantElsewhere } = fakeAccess(false);
      let granted = false;
      const runner = async () => {
        if (!granted) throw new InjectionDeniedError("denied");
        return runnerFor("elsewhere.example")();
      };
      render(App, { props: { runner, autostart: true, delays: [0], access } });
      await screen.findByText("Open Stackpeek on this store.");

      granted = true;
      grantElsewhere();
      grantElsewhere();

      expect(await screen.findByText("elsewhere.example")).toBeTruthy();
      await new Promise((r) => setTimeout(r, 20));
      expect(sendsFor(send, "elsewhere.example")).toBe(1);
    });
  });

  describe("auto-scan offer", () => {
    const shopify = { is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0 };
    const fakeOffer = (pending: boolean) => ({ pending: vi.fn(async () => pending), close: vi.fn() });

    it("offers auto-scan once beside the first result, in place of the switch", async () => {
      vi.spyOn(api, "postDetect").mockResolvedValue(shopify);
      const { access } = fakeAccess(false);
      const offer = fakeOffer(true);
      render(App, { props: { runner: runnerFor("offer.example"), autostart: true, delays: [0], access, offer } });

      const accept = await screen.findByRole("button", { name: "Turn on" });
      expect(screen.queryByRole("switch")).toBeNull();

      await fireEvent.click(accept);

      // Inside the click, not after something it awaited: the gesture ends there.
      expect(access.request).toHaveBeenCalledOnce();
      expect(offer.close).toHaveBeenCalledOnce();
      expect(screen.queryByRole("button", { name: "Turn on" })).toBeNull();
      await vi.waitFor(() => expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true"));
    });

    it("closes for good on No thanks, and leaves the switch", async () => {
      vi.spyOn(api, "postDetect").mockResolvedValue(shopify);
      const { access } = fakeAccess(false);
      const offer = fakeOffer(true);
      render(App, { props: { runner: runnerFor("later.example"), autostart: true, delays: [0], access, offer } });

      await fireEvent.click(await screen.findByRole("button", { name: "No thanks" }));

      expect(access.request).not.toHaveBeenCalled();
      expect(offer.close).toHaveBeenCalledOnce();
      expect(screen.queryByRole("button", { name: "Turn on" })).toBeNull();
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    });

    it("stays away once answered, and while auto-scan is already on", async () => {
      vi.spyOn(api, "postDetect").mockResolvedValue(shopify);
      const answered = render(App, {
        props: { runner: runnerFor("answered.example"), autostart: true, delays: [0], access: fakeAccess(false).access, offer: fakeOffer(false) },
      });
      await screen.findByText("answered.example");
      expect(screen.queryByRole("button", { name: "Turn on" })).toBeNull();
      answered.unmount();

      render(App, {
        props: { runner: runnerFor("on.example"), autostart: true, delays: [0], access: fakeAccess(true).access, offer: fakeOffer(true) },
      });
      await screen.findByText("on.example");
      expect(screen.queryByRole("button", { name: "Turn on" })).toBeNull();
    });
  });

  const fakeShortcut = (initial: string, canToggle = false) => {
    let key = initial;
    let notify = () => {};
    const shortcut = {
      read: vi.fn(async () => key),
      canToggle,
      setEnabled: vi.fn(async (on: boolean) => { key = on ? "Alt+Shift+S" : ""; }),
      watch: vi.fn((cb: () => void) => { notify = cb; return { stop: () => {} }; }),
    };
    return { shortcut, rebind: (k: string) => { key = k; notify(); } };
  };

  describe("keyboard shortcut", () => {
    it("names the bound shortcut beside the toolbar instruction", async () => {
      const runner = async () => { throw new InjectionDeniedError("denied"); };
      render(App, { props: { runner, autostart: true, delays: [0], shortcut: fakeShortcut("Alt+Shift+S").shortcut } });

      expect(await screen.findByText("The shortcut Alt+Shift+S does the same.")).toBeTruthy();
    });

    it("shows the key below the auto-scan switch, with Chrome's shortcuts page a click away", async () => {
      const { access } = fakeAccess(false);
      const { shortcut, rebind } = fakeShortcut("Alt+Shift+S");
      const { container } = render(App, { props: { runner: fakeRunner, autostart: false, access, shortcut } });

      const link = await screen.findByRole("link", { name: "Change or turn off" });
      expect(link.getAttribute("href")).toBe("chrome://extensions/shortcuts");
      expect(screen.getByText("Alt+Shift+S").tagName).toBe("KBD");
      const prefs = container.querySelector(".prefs")!;
      expect([...prefs.children].map((el) => el.className.split(" ")[0])).toEqual(["auto", "row"]);

      // Back from the shortcuts page with the key removed.
      rebind("");
      expect(await screen.findByText("No keyboard shortcut")).toBeTruthy();
      expect(screen.getByRole("link", { name: "Set one" })).toBeTruthy();
    });

    it("turns the key off and on with a switch where the browser allows it", async () => {
      const { shortcut } = fakeShortcut("Alt+Shift+S", true);
      render(App, { props: { runner: fakeRunner, autostart: false, shortcut } });

      const toggle = await screen.findByRole("switch", { name: /Keyboard shortcut/ });
      await vi.waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));

      await fireEvent.click(toggle);
      expect(shortcut.setEnabled).toHaveBeenCalledWith(false);
      await vi.waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));
      expect(screen.queryByText("Alt+Shift+S")).toBeNull();

      await fireEvent.click(toggle);
      expect(shortcut.setEnabled).toHaveBeenLastCalledWith(true);
      await vi.waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
    });

    it("offers no row where there is no commands API", () => {
      render(App, { props: { runner: fakeRunner, autostart: false } });

      expect(screen.queryByText("Keyboard shortcut")).toBeNull();
    });
  });

  // Firefox lets the user withdraw the browsingActivity consent in about:addons
  // and keep the access to all sites, and the access alone would let an
  // automatic rescan read the tab and send its origin. In that state the tab is
  // treated as one without access: nothing sent, the click state shown, and a
  // click -- the toolbar icon or the shortcut, both arrive as "click" -- still
  // scans, because a click is consent for that page.
  describe("with the Firefox consent withdrawn but site access kept", () => {
    const setup = (host: string) => {
      const send = vi.spyOn(api, "postDetect").mockResolvedValue({
        is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0,
      });
      const { access } = fakeAccess(false);
      access.blocksAutoScan.mockResolvedValue(true);
      let fire!: (trigger?: "auto" | "click") => void;
      const watch = (onChange: (trigger?: "auto" | "click") => void) => { fire = onChange; return { stop: () => {} }; };
      const view = render(App, { props: { runner: runnerFor(host), autostart: true, delays: [0], watch, access } });
      return { send, access, view, fire: (t?: "auto" | "click") => fire(t) };
    };

    it("sends nothing on a tab switch or a load, and asks for a click", async () => {
      const { send, fire } = setup("consent.example");
      // Opening the panel is a click: that first scan is the user's.
      await screen.findByText("consent.example");
      await vi.waitFor(() => expect(screen.getByRole("button", { name: /rescan this page/i })).toBeTruthy());

      fire("auto");

      expect(await screen.findByText("Open Stackpeek on this store.")).toBeTruthy();
      await new Promise((r) => setTimeout(r, 20));
      expect(sendsFor(send, "consent.example")).toBe(1);
      expect(screen.queryByText("consent.example")).toBeNull();
    });

    it("still scans on a click on the icon or the shortcut", async () => {
      const { send, fire } = setup("clicked.example");
      await screen.findByText("clicked.example");
      fire("auto");
      await screen.findByText("Open Stackpeek on this store.");

      fire("click");

      expect(await screen.findByText("clicked.example")).toBeTruthy();
      expect(sendsFor(send, "clicked.example")).toBe(2);
    });
  });

  // handleTabChange awaits the consent check before it starts a run, so two
  // changes arriving together could both pass the "is a scan in flight?" test
  // and start two concurrent runs -- the race the queue exists to prevent.
  it("starts one run for two automatic changes that arrive together, and queues the other", async () => {
    const send = vi.spyOn(api, "postDetect").mockImplementation(
      (payload) => new Promise<DetectResponse>((resolve) => {
        if ((payload as { url?: string }).url !== "https://together.example/") return;
        setTimeout(() => resolve({ is_shopify: true, theme: null, apps: [], pixels: [], unknown_domain_count: 0 }), 300);
      }),
    );
    let fire!: () => void;
    const watch = (onChange: () => void) => { fire = onChange; return { stop: () => {} }; };
    render(App, { props: { runner: runnerFor("together.example"), autostart: false, delays: [0], watch } });

    fire(); fire();
    await vi.waitFor(() => expect(sendsFor(send, "together.example")).toBe(1));
    await new Promise((r) => setTimeout(r, 10));
    expect(sendsFor(send, "together.example")).toBe(1);

    await vi.waitFor(() => expect(sendsFor(send, "together.example")).toBe(2));
  });
});
