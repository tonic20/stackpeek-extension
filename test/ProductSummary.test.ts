import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ProductSummary from "../entrypoints/sidepanel/components/ProductSummary.svelte";

const digest = (over: Record<string, unknown> = {}) => ({
  available: true, reason: null, count: 1240, variants: 4180, priceMin: 18, priceMax: 240,
  newest: new Date(Date.now() - 2 * 86400_000).toISOString(), currency: "USD",
  index: [], ...over,
});

const base = { state: "idle" as const, progress: null, filename: null, onexport: () => {}, onretryread: () => {} };

describe("ProductSummary", () => {
  it("heads the section with the product count", () => {
    render(ProductSummary, { ...base, digest: digest() });

    expect(screen.getByText("Products").classList.contains("sp-label")).toBe(true);
    expect(screen.getByText("1,240").classList.contains("sp-count")).toBe(true);
  });

  it("shows the price range, variant total and newest date", () => {
    render(ProductSummary, { ...base, digest: digest() });

    expect(screen.getByText("$18.00 – $240.00")).toBeTruthy();
    expect(screen.getByText("4,180")).toBeTruthy();
    expect(screen.getByText("2d ago")).toBeTruthy();
  });

  // /products.json carries no currency. A "$" on a euro store is a quiet,
  // plausible fabrication, so an unknown currency renders bare numbers.
  it("renders bare numbers when the currency is unknown", () => {
    render(ProductSummary, { ...base, digest: digest({ currency: null }) });

    expect(screen.getByText("18.00 – 240.00")).toBeTruthy();
  });

  it("formats a non-dollar currency with its own symbol", () => {
    render(ProductSummary, { ...base, digest: digest({ currency: "EUR" }) });

    expect(screen.getByText(/€18\.00/)).toBeTruthy();
  });

  // A section that renders idle reports "0 products" for the whole fetch,
  // beside a live export button. That is a wrong answer, not a pending one.
  it("shows no count and no zeros while the catalogue is loading", () => {
    const { container } = render(ProductSummary, { ...base, digest: null });

    expect(screen.getByText("Products")).toBeTruthy();
    expect(container.querySelector(".sp-count")!.textContent).toBe("");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /export/i })).toBeDisabled();
  });

  // The catalogue read is an indeterminate wait, exactly like the header's
  // scan, so it carries the same spinner rather than a second vocabulary for
  // the same idea. Reusing .sp-spinner also inherits its reduced-motion rule.
  it("spins while the catalogue is being read", () => {
    const { container } = render(ProductSummary, { ...base, digest: null });

    const note = container.querySelector(".sp-foot-note")!;
    expect(note.textContent).toContain("Reading the catalogue…");
    expect(note.querySelector(".sp-spinner")).toBeTruthy();
  });

  // The spinner is the wait, not the section. Left running once the digest
  // settles it would report work that is finished -- the failure mode a
  // spinner exists to rule out.
  it("stops spinning once the digest settles", () => {
    const { container } = render(ProductSummary, { ...base, digest: digest() });

    expect(container.querySelector(".sp-spinner")).toBeNull();
  });

  // An unavailable catalogue is a settled answer, not a pending one.
  it("does not spin when the catalogue is not public", () => {
    const { container } = render(ProductSummary, { ...base, digest: digest({ available: false }) });

    expect(container.querySelector(".sp-spinner")).toBeNull();
  });

  // 404, blocked fetch and password-protected stores all land here. Nothing
  // about asking again makes a disabled feed appear, so no Retry.
  it("states plainly when the catalogue is not public, and offers no retry", () => {
    const { container } = render(ProductSummary, { ...base, digest: digest({ available: false }) });

    expect(screen.getByText("Catalogue not public on this store.")).toBeTruthy();
    expect(container.querySelector(".sp-btn")).toBeNull();
    expect(container.querySelector(".sp-facts")).toBeNull();
  });

  // .sp-btn--quiet and .sp-badge are near-identical -- transparent fill,
  // --sp-border-strong hairline, centred text -- and Products sits directly
  // above Trackers, so the old quiet control read as a fourth badge sitting
  // alone. The export variant separates by shape and fill, never by accent.
  it("offers the export as its own filled variant, never the accent", () => {
    render(ProductSummary, { ...base, digest: digest() });

    const button = screen.getByRole("button", { name: "Export catalogue CSV" });
    expect(button.classList.contains("sp-btn--export")).toBe(true);
    expect(button.classList.contains("sp-btn--quiet")).toBe(false);
    expect(button.classList.contains("sp-btn--primary")).toBe(false);
  });

  // The retry is a recovery affordance, not the primary path, so it keeps the
  // quiet treatment -- it must NOT inherit the export variant.
  it("keeps the retry quiet", () => {
    render(ProductSummary, { ...base, digest: digest(), state: "error" });

    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry.classList.contains("sp-btn--quiet")).toBe(true);
    expect(retry.classList.contains("sp-btn--export")).toBe(false);
  });

  // The homepage's borderless rows read better than three table rules inside a
  // section that is already bounded. .sp-facts is a NEW class, not a rename of
  // .sp-metric: .sp-metrics is defined in BOTH stylesheets with different
  // children (.sp-metric__k vs the site's .sp-metrics__k) and different display,
  // and the site's is live on the store-intelligence section.
  it("lays the digest out as borderless fact rows", () => {
    const { container } = render(ProductSummary, { ...base, digest: digest() });

    expect(container.querySelector(".sp-facts")).toBeTruthy();
    expect(container.querySelectorAll(".sp-fact").length).toBe(3);
    expect(container.querySelector(".sp-metrics")).toBeNull();
    expect(container.querySelector(".sp-metric")).toBeNull();
  });

  it("counts products in the idle meta line, not CSV rows", () => {
    render(ProductSummary, { ...base, digest: digest() });

    expect(screen.getByText("1,240 products · Shopify import format")).toBeTruthy();
  });

  it("calls back when the export is pressed", async () => {
    const onexport = vi.fn();
    render(ProductSummary, { ...base, digest: digest(), onexport });

    await fireEvent.click(screen.getByRole("button", { name: "Export catalogue CSV" }));

    expect(onexport).toHaveBeenCalledOnce();
  });

  it("reports progress against a track while fetching", () => {
    const { container } = render(ProductSummary, {
      ...base, digest: digest(), state: "fetching", progress: { done: 1000, total: 1240 },
    });

    expect(screen.getByText("1,000 / 1,240")).toBeTruthy();
    expect(container.querySelector(".sp-track")).toBeTruthy();
    expect((container.querySelector(".sp-fill") as HTMLElement).style.width).toBe("80.6452%");
    expect(screen.getByRole("button", { name: /export/i })).toBeDisabled();
  });

  it("announces progress and completion to a screen reader", () => {
    const { container } = render(ProductSummary, {
      ...base, digest: digest(), state: "fetching", progress: { done: 10, total: 20 },
    });

    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy();
  });

  it("names the file on completion, with no celebration", () => {
    render(ProductSummary, {
      ...base, digest: digest(), state: "done", filename: "demo.example-products-2026-08-02.csv",
    });

    expect(screen.getByText("demo.example-products-2026-08-02.csv")).toBeTruthy();
    expect(screen.getByRole("button", { name: /export/i })).not.toBeDisabled();
  });

  // A fetch that fails mid-export IS worth retrying, unlike an absent feed.
  it("offers a retry when the export itself failed", () => {
    render(ProductSummary, { ...base, digest: digest(), state: "error" });

    expect(screen.getByText("Couldn't read the catalogue.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  // Guards against the export-error Retry and the unreadable-catalogue Retry
  // ever getting wired to the same callback -- they must re-attempt different
  // things (an export vs a read) even though they share a label and a class.
  it("retries the export, not the read, when the export itself failed", () => {
    const onexport = vi.fn();
    const onretryread = vi.fn();
    render(ProductSummary, { ...base, onexport, onretryread, digest: digest(), state: "error" });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(onexport).toHaveBeenCalledOnce();
    expect(onretryread).not.toHaveBeenCalled();
  });

  it("says the catalogue is not public only when the store said so", () => {
    render(ProductSummary, { ...base, digest: digest({ available: false, reason: "not_public" }) });
    expect(screen.getByText("Catalogue not public on this store.")).toBeTruthy();
  });

  // onexport is wrong here: runExport bails on `!digest?.available`, which is
  // exactly true in this state, so wiring this button to it made Retry a
  // silent no-op. It must call the read retry instead, and never the export.
  it("says the read failed, and offers a retry, when it could not be read", () => {
    const onexport = vi.fn();
    const onretryread = vi.fn();
    render(ProductSummary, { ...base, onexport, onretryread, digest: digest({ available: false, reason: "unreadable" }) });
    expect(screen.getByText("Couldn't read the catalogue.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(onretryread).toHaveBeenCalledOnce();
    expect(onexport).not.toHaveBeenCalled();
  });

  // A readable catalogue whose SIZE could not be read: the Storefront API
  // answered, the sitemap did not. Four things have to hold at once -- no "0"
  // in the count slot, no "0 products" in the meta line, no claim of a cap
  // that was never measured, and an Export button that still works, because
  // the catalogue is readable and only its size is unknown.
  it("shows no count at all when the catalogue's size could not be read", () => {
    const { container } = render(ProductSummary, { ...base, digest: digest({ count: null }) });

    expect(container.querySelector(".sp-count")!.textContent).toBe("");
    expect(screen.queryByText(/0 products/)).toBeNull();
    expect(screen.queryByText(/products ·/)).toBeNull();
    expect(screen.getByText("Shopify import format")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export catalogue CSV" })).not.toBeDisabled();
  });

  // With no total there is no denominator, so the note counts what has been
  // exported and the determinate track -- which is itself a claim about how
  // much is left -- is omitted rather than drawn against an invented total.
  it("reports a bare tally, and no track, when the export has no known total", () => {
    const { container } = render(ProductSummary, {
      ...base, digest: digest({ count: null }), state: "fetching", progress: { done: 500, total: null },
    });

    expect(screen.getByText("500 exported")).toBeTruthy();
    expect(container.querySelector(".sp-track")).toBeNull();
  });

  it("states the export limit when the catalogue exceeds it", () => {
    render(ProductSummary, { ...base, digest: digest({ count: 41762, capped: true }) });
    expect(screen.getByText(/first 10,000/)).toBeTruthy();
  });

  it("says nothing about a limit that does not bite", () => {
    render(ProductSummary, { ...base, digest: digest({ count: 240, capped: false }) });
    expect(screen.queryByText(/first 10,000/)).toBeNull();
  });
});
