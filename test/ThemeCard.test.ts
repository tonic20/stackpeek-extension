import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/svelte";
import ThemeCard from "../entrypoints/sidepanel/components/ThemeCard.svelte";
import { stubBrowser } from "./setup";

afterEach(() => {
  stubBrowser({});
});

describe("ThemeCard", () => {
  it("renders a catalog theme with its price and origin chip", () => {
    const { container } = render(ThemeCard, { theme: { name: "Dawn", origin: "catalog", price: "Free" } });

    expect(screen.getByText("Dawn")).toBeTruthy();
    expect(screen.getByText("Free")).toBeTruthy();
    expect(screen.getByText("catalog")).toBeTruthy();
    // A catalog theme is the design's one accent-carrying element: the plain
    // and dashed variants are the deliberate non-answers, and neither applies.
    const card = container.querySelector(".sp-theme")!;
    expect(card.classList.contains("sp-theme--plain")).toBe(false);
    expect(card.classList.contains("sp-theme--dashed")).toBe(false);
  });

  it("links a catalog theme's name to its listing", () => {
    render(ThemeCard, {
      theme: { name: "Dawn", origin: "catalog", theme_url: "https://themes.shopify.com/themes/dawn" },
    });

    const link = screen.getByRole("link", { name: "Dawn" });
    expect(link.getAttribute("href")).toBe("https://themes.shopify.com/themes/dawn");
    expect(link.classList.contains("sp-theme__name")).toBe(true);
  });

  // Opened through the extension API rather than by the anchor, so the panel
  // knows the tab's id and can stop itself rescanning a page the user never
  // asked it to look at (lib/held_tabs.ts).
  it("opens a theme listing itself, so the panel can hold its results", () => {
    const create = vi.fn(async () => ({ id: 42 }));
    stubBrowser({ tabs: { create } });
    render(ThemeCard, {
      theme: { name: "Dawn", origin: "catalog", theme_url: "https://themes.shopify.com/themes/dawn" },
    });

    screen.getByRole("link", { name: "Dawn" }).click();

    expect(create).toHaveBeenCalledWith({ url: "https://themes.shopify.com/themes/dawn", active: true });
  });

  // An uncatalogued theme has no listing. It must render as text rather than as
  // a dead link -- this is the whole reason theme_url is optional.
  it("renders a catalog theme's name as text when it has no listing", () => {
    render(ThemeCard, { theme: { name: "Dawn", origin: "catalog" } });

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Dawn").classList.contains("sp-theme__name")).toBe(true);
  });

  it("renders a forked theme with its schema version and a customized marker", () => {
    render(ThemeCard, { theme: { name: "Dawn", origin: "forked", version: "15.1.0", price: "Free" } });

    expect(screen.getByText("Dawn")).toBeTruthy();
    expect(screen.getByText("15.1.0").classList.contains("sp-theme__version")).toBe(true);
    expect(screen.getByText("customized").classList.contains("sp-theme__mod")).toBe(true);
  });

  it("keeps a custom theme's own name and gives it the plain variant", () => {
    const { container } = render(ThemeCard, { theme: { name: "Handover theme", origin: "custom" } });

    expect(screen.getByText("Handover theme")).toBeTruthy();
    expect(screen.getByText("custom")).toBeTruthy();
    expect(container.querySelector(".sp-theme--plain")).toBeTruthy();
    // No version is claimed for a theme we could not identify.
    expect(container.querySelector(".sp-theme__version")).toBeNull();
    expect(screen.queryByText("customized")).toBeNull();
  });

  it("names an unnamed custom theme rather than rendering an empty heading", () => {
    render(ThemeCard, { theme: { origin: "custom" } });

    expect(screen.getByText("Custom theme")).toBeTruthy();
  });

  it("renders a headless storefront with the dashed variant", () => {
    const { container } = render(ThemeCard, { theme: { origin: "headless" } });

    expect(screen.getByText("Headless storefront")).toBeTruthy();
    expect(screen.getByText(/decoupled from Shopify's theme layer/)).toBeTruthy();
    expect(container.querySelector(".sp-theme--dashed")).toBeTruthy();
  });

  it("never links a custom or headless theme, even if a url leaks in", () => {
    render(ThemeCard, { theme: { name: "Handover theme", origin: "custom", theme_url: "https://example.test/x" } });

    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders nothing without a theme", () => {
    const { container } = render(ThemeCard, { theme: undefined });

    expect(container.querySelector(".sp-theme")).toBeNull();
    expect(container.querySelector(".sp-sec")).toBeNull();
  });

  // The corner slot used to print theme.origin verbatim, which left "catalog"
  // in English in all fourteen translations. These assert the label is a
  // message, and that an origin the map does not know keeps the raw value
  // rather than blanking the slot or throwing on an unknown i18n key.
  describe("origin label", () => {
    it("renders the origin as a localized message", () => {
      render(ThemeCard, { theme: { name: "Dawn", origin: "catalog", version: "15.1.0" } });
      expect(screen.getByText("catalog")).toBeInTheDocument();
    });

    it("keeps an unrecognized origin rather than blanking the slot", () => {
      render(ThemeCard, { theme: { name: "Dawn", origin: "marketplace" as never } });
      expect(screen.getByText("marketplace")).toBeInTheDocument();
    });

    it("renders no origin when the service sends none", () => {
      const { container } = render(ThemeCard, { theme: { name: "Dawn" } });
      expect(container.querySelector(".sp-count")?.textContent).toBe("");
    });
  });
});
