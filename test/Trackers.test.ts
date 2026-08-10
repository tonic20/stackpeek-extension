import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import Trackers from "../entrypoints/sidepanel/components/Trackers.svelte";

describe("Trackers", () => {
  it("heads the section with its own name and count", () => {
    render(Trackers, { items: [{ name: "Meta Pixel" }, { name: "TikTok Pixel" }] });

    expect(screen.getByText("Trackers").classList.contains("sp-label")).toBe(true);
    expect(screen.getByText("2").classList.contains("sp-count")).toBe(true);
    expect(screen.getByText("Meta Pixel").classList.contains("sp-badge")).toBe(true);
  });

  // A store with no tracking is a finding, not an absence, and the design says
  // so out loud. This is why Trackers renders when empty and Infrastructure
  // does not -- a difference the two components now state directly, rather than
  // encoding it as "was passed an emptyMessage".
  it("says so when it has nothing in it", () => {
    render(Trackers, { items: [] });

    expect(screen.getByText("Trackers")).toBeTruthy();
    expect(screen.getByText("None detected on this page.").classList.contains("sp-quiet")).toBe(true);
  });

  it("still renders the section when items are absent entirely", () => {
    const { container } = render(Trackers);

    expect(container.querySelector(".sp-sec")).toBeTruthy();
    expect(screen.getByText("None detected on this page.")).toBeTruthy();
  });

  it("notes the trackers still being identified", () => {
    render(Trackers, { items: [{ name: "Meta Pixel" }], unknownDomainCount: 3 });

    expect(screen.getByText("3 more trackers we're identifying").classList.contains("sp-quiet")).toBe(true);
  });

  it("keeps the note singular for one unidentified tracker", () => {
    render(Trackers, { items: [{ name: "Meta Pixel" }], unknownDomainCount: 1 });

    expect(screen.getByText("1 more tracker we're identifying")).toBeTruthy();
  });

  it("omits the note when nothing is left to identify", () => {
    const { container } = render(Trackers, { items: [{ name: "Meta Pixel" }] });

    expect(container.querySelector(".sp-quiet")).toBeNull();
  });

  it("labels its section for the landmark", () => {
    const { container } = render(Trackers, { items: [{ name: "Meta Pixel" }] });

    expect(container.querySelector(".sp-sec")!.getAttribute("aria-labelledby")).toBe("sp-trackers-label");
    expect(container.querySelector(".sp-label")!.id).toBe("sp-trackers-label");
  });
});
