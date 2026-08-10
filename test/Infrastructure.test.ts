import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import Infrastructure from "../entrypoints/sidepanel/components/Infrastructure.svelte";

describe("Infrastructure", () => {
  it("heads the section with its own name and count", () => {
    render(Infrastructure, { items: [{ name: "Shopify Payments" }, { name: "Adobe Fonts" }] });

    expect(screen.getByText("Infrastructure").classList.contains("sp-label")).toBe(true);
    expect(screen.getByText("2").classList.contains("sp-count")).toBe(true);
    expect(screen.getByText("Shopify Payments").classList.contains("sp-badge")).toBe(true);
  });

  // Unlike Trackers, an empty array renders no section. "No infrastructure
  // detected" is a gap in what we can see, not a finding about the store.
  // Today's behaviour, and App.test.ts pins it too.
  it("renders nothing when it is empty", () => {
    const { container } = render(Infrastructure, { items: [] });

    expect(container.querySelector(".sp-sec")).toBeNull();
  });

  it("renders nothing when items are absent entirely", () => {
    const { container } = render(Infrastructure);

    expect(container.querySelector(".sp-sec")).toBeNull();
  });

  // Both sections mount at once, so their labels cannot share an id.
  it("labels its section for the landmark", () => {
    const { container } = render(Infrastructure, { items: [{ name: "Shopify Payments" }] });

    expect(container.querySelector(".sp-sec")!.getAttribute("aria-labelledby")).toBe("sp-infrastructure-label");
    expect(container.querySelector(".sp-label")!.id).toBe("sp-infrastructure-label");
  });
});
