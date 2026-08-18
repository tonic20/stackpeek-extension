// The background entrypoint is a defineBackground() call, which WXT provides
// as a global at build time and which is not defined under Vitest. Stubbing it
// to capture the callback lets the branch be tested without a browser.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { browser } from "wxt/browser";
import { stubBrowser } from "./setup";

// wxt/browser's types are generated from @types/chrome and don't know about
// sidebarAction (see entrypoints/background.ts) — cast to read it back.
const firefoxBrowser = browser as unknown as { sidebarAction: { open: ReturnType<typeof vi.fn> } };

type Handler = (tab: { id?: number }) => void;

async function loadBackground(isFirefox: boolean): Promise<Handler> {
  vi.stubEnv("FIREFOX", isFirefox ? "true" : "");
  let handler: Handler | undefined;
  (globalThis as Record<string, unknown>).defineBackground = (main: () => void) => main();
  stubBrowser({
    action: { onClicked: { addListener: (fn: Handler) => { handler = fn; } } },
    sidePanel: { open: vi.fn() },
    sidebarAction: { open: vi.fn() },
  });
  vi.resetModules();
  await import("../entrypoints/background");
  if (!handler) throw new Error("background registered no action.onClicked listener");
  return handler;
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("the background entrypoint", () => {
  it("opens Chrome's side panel for the clicked tab", async () => {
    const onClicked = await loadBackground(false);
    onClicked({ id: 7 });
    expect(browser.sidePanel.open).toHaveBeenCalledWith({ tabId: 7 });
    expect(firefoxBrowser.sidebarAction.open).not.toHaveBeenCalled();
  });

  it("opens Firefox's sidebar, which takes no tab argument", async () => {
    const onClicked = await loadBackground(true);
    onClicked({ id: 7 });
    expect(firefoxBrowser.sidebarAction.open).toHaveBeenCalledWith();
    expect(browser.sidePanel.open).not.toHaveBeenCalled();
  });

  it("does nothing for a tab with no id", async () => {
    const onClicked = await loadBackground(false);
    onClicked({});
    expect(browser.sidePanel.open).not.toHaveBeenCalled();
  });
});
