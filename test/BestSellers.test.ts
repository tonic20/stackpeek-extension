import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import BestSellers from "../entrypoints/sidepanel/components/BestSellers.svelte";

const list = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ handle: `p${i}`, title: `Product ${i}`, price: `${i + 1}.00` }));

describe("BestSellers", () => {
  it("heads the section with the number of ranks it holds", () => {
    render(BestSellers, { products: list(25), currency: "USD" });

    expect(screen.getByText("Best sellers").classList.contains("sp-label")).toBe(true);
    expect(screen.getByText("25").classList.contains("sp-count")).toBe(true);
  });

  it("ranks the first five by default", () => {
    const { container } = render(BestSellers, { products: list(25), currency: "USD" });

    expect(container.querySelectorAll(".sp-bs li")).toHaveLength(5);
    expect(container.querySelector(".sp-rank")!.textContent).toBe("1");
    expect(screen.getByText("Product 0")).toBeTruthy();
  });

  it("expands to the full 25 and back", async () => {
    const { container } = render(BestSellers, { products: list(25), currency: "USD" });

    await fireEvent.click(screen.getByRole("button", { name: "Show 20 more" }));
    expect(container.querySelectorAll(".sp-bs li")).toHaveLength(25);

    // A disclosure that only opens is a disclosure that lied about being one.
    await fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(container.querySelectorAll(".sp-bs li")).toHaveLength(5);
  });

  it("carries aria-expanded on the disclosure", async () => {
    render(BestSellers, { products: list(25), currency: "USD" });

    const button = screen.getByRole("button", { name: "Show 20 more" });
    expect(button.getAttribute("aria-expanded")).toBe("false");

    await fireEvent.click(button);

    expect(screen.getByRole("button", { name: "Show fewer" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("offers no disclosure when everything already fits", () => {
    render(BestSellers, { products: list(4), currency: "USD" });

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("formats prices in the store's currency", () => {
    render(BestSellers, { products: list(2), currency: "EUR" });

    expect(screen.getByText(/€1\.00/)).toBeTruthy();
  });

  it("renders bare prices when the currency is unknown", () => {
    render(BestSellers, { products: list(2), currency: null });

    expect(screen.getByText("1.00")).toBeTruthy();
  });

  // The whole point of the feature's honesty: an unproven ranking is absent,
  // not empty.
  it("renders nothing at all when there is no ranking", () => {
    const { container } = render(BestSellers, { products: [], currency: "USD" });

    expect(container.querySelector(".sp-sec")).toBeNull();
  });
});
