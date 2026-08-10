import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ThemeToggle from "../entrypoints/sidepanel/components/ThemeToggle.svelte";

let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
  globalThis.chrome = {
    storage: { local: {
      get: vi.fn(async (k: string) => ({ [k]: store[k] })),
      set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(store, obj); }),
    } },
  } as unknown as typeof chrome;
});

afterEach(() => {
  document.documentElement.removeAttribute("data-sp-theme");
  // @ts-expect-error `chrome` only exists inside the extension.
  delete globalThis.chrome;
});

describe("ThemeToggle", () => {
  // The label, not the icon, is what says which direction the click goes. An
  // icon alone cannot distinguish "you are in dark mode" from "click for dark
  // mode", so the label is load-bearing rather than decorative.
  it("offers the other scheme, starting from the system default", () => {
    render(ThemeToggle);

    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeTruthy();
  });

  it("reads the preference main.ts already applied to the document", () => {
    document.documentElement.setAttribute("data-sp-theme", "dark");

    render(ThemeToggle);

    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeTruthy();
  });

  it("applies and persists the new scheme when pressed", async () => {
    render(ThemeToggle);

    await fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));

    expect(document.documentElement.getAttribute("data-sp-theme")).toBe("dark");
    await vi.waitFor(() => expect(store.theme).toBe("dark"));
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeTruthy();
  });

  it("toggles back", async () => {
    render(ThemeToggle);

    await fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    await fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));

    expect(document.documentElement.getAttribute("data-sp-theme")).toBe("light");
    await vi.waitFor(() => expect(store.theme).toBe("light"));
  });

  it("uses the panel's icon button, defining no styles of its own", () => {
    const { container } = render(ThemeToggle);

    expect(container.querySelector("button")!.classList.contains("sp-iconbtn")).toBe(true);
  });
});
