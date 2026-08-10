import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import TerminalState from "../entrypoints/sidepanel/components/TerminalState.svelte";

describe("TerminalState", () => {
  it("renders the not-a-store state with a quiet rescan", () => {
    const { container } = render(TerminalState, { status: "not_shopify", onretry: () => {} });

    expect(screen.getByText("no match").classList.contains("sp-state__code")).toBe(true);
    expect(screen.getByText("Not a Shopify store.").classList.contains("sp-state__title")).toBe(true);
    const button = screen.getByRole("button", { name: "Scan again" });
    expect(button.classList.contains("sp-btn--quiet")).toBe(true);
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  // Nothing about the page will change by asking again, so there is no action
  // to offer -- and for the same reason the header hides its rescan button in
  // this state.
  it("offers no action on an unscannable page", () => {
    render(TerminalState, { status: "cant_scan", onretry: () => {} });

    expect(screen.getByText("unreadable page")).toBeTruthy();
    expect(screen.getByText("Can't scan this page.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the network state as an alert with a primary retry", () => {
    const { container } = render(TerminalState, { status: "error", onretry: () => {} });

    expect(screen.getByText("network")).toBeTruthy();
    expect(screen.getByText("Couldn't reach the detector.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" }).classList.contains("sp-btn--primary")).toBe(true);
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
  });

  it("renders rate limiting as its own state, with its own code chip", () => {
    const { container } = render(TerminalState, { status: "rate_limited", onretry: () => {} });

    expect(screen.getByText("429")).toBeTruthy();
    expect(screen.getByText("Please slow down and try again.")).toBeTruthy();
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
  });

  // RateLimitError carries no retry-after value -- the API sends no
  // Retry-After header we read -- so the bundle's "retry after" row is omitted
  // rather than filled with a guess.
  it("shows no retry-after row it cannot fill", () => {
    const { container } = render(TerminalState, { status: "rate_limited", onretry: () => {} });

    expect(container.querySelector(".sp-state__list")).toBeNull();
    expect(screen.queryByText(/retry after/i)).toBeNull();
  });

  // No action button, for the same reason cant_scan has none: pressing it could
  // not work. activeTab is granted by chrome.action.onClicked and by nothing
  // else, so a button inside our own page cannot grant it -- a Retry here would
  // fail exactly as reliably as it was pressed.
  it("directs the user to the toolbar when the browser refused access", () => {
    const { container } = render(TerminalState, { status: "needs_permission", onretry: () => {} });

    expect(screen.getByText("permission").classList.contains("sp-state__code")).toBe(true);
    expect(screen.getByText("Open Stackpeek on this store.")).toBeTruthy();
    expect(screen.getByText(/toolbar/i)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it("calls back when the action is pressed", async () => {
    const onretry = vi.fn();
    render(TerminalState, { status: "error", onretry });

    await fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(onretry).toHaveBeenCalledOnce();
  });
});
