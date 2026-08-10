import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import AppList from "../entrypoints/sidepanel/components/AppList.svelte";

const app = (over: Record<string, unknown> = {}) => ({
  name: "Judge.me",
  category: "Reviews",
  category_slug: "reviews",
  app_store_url: "https://apps.shopify.com/judgeme",
  verified: true,
  ...over,
});

describe("AppList", () => {
  it("heads the section with the total count", () => {
    render(AppList, { apps: [app(), app({ name: "Klaviyo", category: "Email & SMS", category_slug: "email-sms" })] });

    expect(screen.getByText("Apps").classList.contains("sp-label")).toBe(true);
    expect(screen.getByText("2").classList.contains("sp-count")).toBe(true);
  });

  it("groups apps under their own category, carrying the server's slug", () => {
    const { container } = render(AppList, {
      apps: [
        app({ name: "Klaviyo", category: "Email & SMS", category_slug: "email-sms" }),
        app({ name: "Judge.me", category: "Reviews", category_slug: "reviews" }),
        app({ name: "Okendo", category: "Reviews", category_slug: "reviews" }),
      ],
    });

    const cats = [...container.querySelectorAll(".sp-cat")];
    expect(cats.map((c) => c.getAttribute("data-sp-cat"))).toEqual(["email-sms", "reviews"]);
    expect(cats[1]!.querySelectorAll(".sp-item")).toHaveLength(2);
  });

  // D2's guard. The reference component filters against a six-name whitelist;
  // ported literally, an app in any of the other 21 canonical categories would
  // silently vanish from the panel. A category the design never tinted must
  // still render its group and its swatch -- panel.css's
  // var(--sp-cat-tint, var(--sp-border-strong)) makes that free.
  it("renders a category the design never tinted", () => {
    const { container } = render(AppList, {
      apps: [app({ name: "Weglot", category: "Localization", category_slug: "localization" })],
    });

    const cat = container.querySelector('[data-sp-cat="localization"]')!;
    expect(cat).toBeTruthy();
    expect(cat.querySelector(".sp-cat__label")!.textContent).toBe("Localization");
    expect(screen.getByText("Weglot")).toBeTruthy();
  });

  // The server sorts by category position then name, so arrival order IS
  // display order. Re-sorting here would be a second, divergent implementation
  // of an ordering the homepage demo also has to honour.
  it("keeps the server's order rather than imposing its own", () => {
    const { container } = render(AppList, {
      apps: [
        app({ name: "Zeta", category: "Sales", category_slug: "sales" }),
        app({ name: "Alpha", category: "Analytics", category_slug: "analytics" }),
      ],
    });

    expect([...container.querySelectorAll(".sp-cat__label")].map((e) => e.textContent))
      .toEqual(["Sales", "Analytics"]);
  });

  it("links a verified app to its listing", () => {
    render(AppList, { apps: [app()] });

    const link = screen.getByRole("link", { name: "Judge.me" });
    expect(link.getAttribute("href")).toBe("https://apps.shopify.com/judgeme");
    expect(link.getAttribute("rel")).toBe("noreferrer");
  });

  it("does not link an app the catalogue has no listing url for", () => {
    render(AppList, { apps: [app({ app_store_url: "" })] });

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Judge.me").classList.contains("sp-item__name")).toBe(true);
  });

  // The regression this change exists to fix: gating the link on `verified`
  // meant that plenty of apps which do carry a listing URL had it hidden by
  // the panel anyway, simply because they hadn't been verified yet --
  // verification and having a URL are independent facts about a catalogue
  // row, and the old code conflated them.
  it("links an app with a url even when it is unverified", () => {
    render(AppList, { apps: [app({ verified: false })] });

    const link = screen.getByRole("link", { name: "Judge.me" });
    expect(link.getAttribute("href")).toBe("https://apps.shopify.com/judgeme");
  });

  // "unverified" is a comparative claim -- it means "matched on weaker evidence
  // than the others here" -- so it needs a stronger sibling to be true of
  // anything. With nothing verified it would sit on 8 of 8 and distinguish
  // nothing.
  it("shows no flag when nothing in the scan is verified", () => {
    const { container } = render(AppList, {
      apps: [app({ verified: false }), app({ name: "Loox", verified: false })],
    });

    expect(container.querySelector(".sp-flag")).toBeNull();
    expect(container.querySelector(".sp-foot-note")).toBeNull();
    expect(screen.queryByText(/lower-confidence fingerprint match/)).toBeNull();
  });

  it("flags the weak ones when the scan holds a mix", () => {
    render(AppList, {
      apps: [app({ name: "Judge.me", verified: true }), app({ name: "Loox", verified: false })],
    });

    expect(screen.getByText("unverified").classList.contains("sp-flag")).toBe(true);
    // The flag's own explanation is a title attribute, which never reaches a
    // keyboard or screen-reader user. The hidden sentence and the section
    // footnote are what carry the meaning without a pointer.
    expect(screen.getByText(/lower-confidence fingerprint match/)).toBeTruthy();
    expect(screen.getByText(/matched on a weaker signal/).classList.contains("sp-foot-note")).toBe(true);
  });

  it("omits the footnote when every app is verified", () => {
    const { container } = render(AppList, { apps: [app()] });

    expect(container.querySelector(".sp-foot-note")).toBeNull();
    expect(container.querySelector(".sp-flag")).toBeNull();
  });

  it("renders the section with a zero count when nothing was detected", () => {
    const { container } = render(AppList, { apps: [] });

    expect(screen.getByText("Apps")).toBeTruthy();
    expect(screen.getByText("0").classList.contains("sp-count")).toBe(true);
    expect(container.querySelectorAll(".sp-cat")).toHaveLength(0);
  });
});
