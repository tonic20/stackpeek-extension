import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import Skeleton from "../entrypoints/sidepanel/components/Skeleton.svelte";

describe("Skeleton", () => {
  it("renders five section skeletons: Theme, Apps, Trackers, Infrastructure, Products", () => {
    const { container } = render(Skeleton);

    const sections = container.querySelectorAll(".sp-sec");
    expect(sections).toHaveLength(5);

    // Get the labels in order
    const labels = Array.from(sections).map(
      (sec) => sec.querySelector(".sp-label")?.textContent
    );

    expect(labels).toEqual(["Theme", "Apps", "Trackers", "Infrastructure", "Products"]);
  });

  it("does not include a Best sellers section skeleton", () => {
    const { container } = render(Skeleton);

    const labels = Array.from(container.querySelectorAll(".sp-label")).map(
      (el) => el.textContent
    );

    expect(labels).not.toContain("Best sellers");
  });
});
