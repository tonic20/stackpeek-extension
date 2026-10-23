import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ExportDeck from "../entrypoints/sidepanel/components/ExportDeck.svelte";

const scan = () => ({
  domain: "spotonfence.com",
  scannedAt: new Date("2026-08-23T09:00:00Z"),
  theme: { name: "Dawn", version: "15.3.0", price: null, theme_url: null, origin: "catalog" },
  apps: [{ name: "Judge.me", category: "Reviews", app_store_url: "", verified: true }],
  pixels: [],
  infrastructure: [],
  unknown_domain_count: 0,
});

describe("ExportDeck", () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it("offers copy for the readable format and a download for each machine format", () => {
    render(ExportDeck, { scan: scan() });

    expect(screen.getByRole("button", { name: "Copy as Markdown" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "CSV" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "JSON" })).toBeTruthy();
  });

  // The catalogue export button carries a download arrow. These do the same
  // thing to a different subject, so they carry the same mark -- a bare word
  // beside an iconned button reads as a different class of control.
  it("marks the two downloads with the same arrow the catalogue export uses", () => {
    render(ExportDeck, { scan: scan() });

    const arrow = "M8 2v8M4.5 7 8 10.5 11.5 7M2.5 13h11";
    for (const name of ["CSV", "JSON"]) {
      const svg = screen.getByRole("button", { name }).querySelector("svg path");
      expect(svg?.getAttribute("d")).toBe(arrow);
    }
  });

  // Copying is not downloading, and an arrow on it would say it was.
  it("leaves the copy button unmarked", () => {
    render(ExportDeck, { scan: scan() });

    expect(screen.getByRole("button", { name: "Copy as Markdown" }).querySelector("svg")).toBeNull();
  });

  it("puts the Markdown report on the clipboard", async () => {
    render(ExportDeck, { scan: scan() });

    await fireEvent.click(screen.getByRole("button", { name: "Copy as Markdown" }));

    const written = String((navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(written).toContain("# spotonfence.com");
    expect(written).toContain("## Apps");
  });

  it("confirms the copy, so a silent clipboard write does not look like nothing happened", async () => {
    render(ExportDeck, { scan: scan() });

    await fireEvent.click(screen.getByRole("button", { name: "Copy as Markdown" }));

    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  });

  // A denied or unfocused clipboard rejects. Losing the report silently is the
  // one outcome worse than not offering the button.
  it("falls back to downloading the Markdown when the clipboard refuses", async () => {
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("denied"));
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });

    render(ExportDeck, { scan: scan() });
    await fireEvent.click(screen.getByRole("button", { name: "Copy as Markdown" }));
    await vi.waitFor(() => expect(clicked).toHaveLength(1));

    expect(clicked[0]).toBe("spotonfence.com-stack-2026-08-23.md");
  });

  // The label change is not announced by every screen reader -- a focused
  // control's name changing is not a live-region update -- so the outcome is
  // said in a status region that was already in the page.
  it("announces the copy in a live region", async () => {
    render(ExportDeck, { scan: scan() });
    const region = screen.getByRole("status");
    expect(region.textContent).toBe("");

    await fireEvent.click(screen.getByRole("button", { name: "Copy as Markdown" }));

    await vi.waitFor(() => expect(region.textContent).toBe("Copied"));
  });

  // A file the user did not ask for, with the clipboard still holding whatever
  // was there before, reads as a broken button unless it is explained.
  it("says the report went to a file when the clipboard refused", async () => {
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("denied"));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const { container } = render(ExportDeck, { scan: scan() });
    await fireEvent.click(screen.getByRole("button", { name: "Copy as Markdown" }));

    await vi.waitFor(() => expect(screen.getByRole("status").textContent).toBe("Couldn't copy — saved as a file instead."));
    const hint = container.querySelector(".sp-hint")!;
    expect(hint.textContent).toBe("Couldn't copy — saved as a file instead.");
    // Already said by the region; read twice otherwise.
    expect(hint.getAttribute("aria-hidden")).toBe("true");
    // Not "Copied": nothing was.
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });

  it("drops the notice once a later copy works", async () => {
    const write = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
    write.mockRejectedValueOnce(new Error("denied"));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { container } = render(ExportDeck, { scan: scan() });
    const copy = screen.getByRole("button", { name: "Copy as Markdown" });

    await fireEvent.click(copy);
    await vi.waitFor(() => expect(container.querySelector(".sp-hint")).toBeTruthy());
    await fireEvent.click(copy);

    await vi.waitFor(() => expect(screen.getByRole("status").textContent).toBe("Copied"));
    expect(container.querySelector(".sp-hint")).toBeNull();
  });

  it("names the downloads after the store and the day it was scanned", async () => {
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });

    render(ExportDeck, { scan: scan() });
    await fireEvent.click(screen.getByRole("button", { name: "CSV" }));
    await fireEvent.click(screen.getByRole("button", { name: "JSON" }));

    expect(clicked).toEqual([
      "spotonfence.com-stack-2026-08-23.csv",
      "spotonfence.com-stack-2026-08-23.json",
    ]);
  });
});
