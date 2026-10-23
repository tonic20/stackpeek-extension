// The background entrypoint is a defineBackground() call, which WXT provides
// as a global at build time and which is not defined under Vitest. Stubbing it
// to capture the callback lets the branch be tested without a browser.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { browser } from "wxt/browser";
import { stubBrowser } from "./setup";
import { ACTION_CLICKED } from "../lib/action_click";

// The welcome page's listeners are runtime ones this file does not stub; they
// have their own tests in welcome.test.ts.
vi.mock("../lib/welcome", () => ({ registerWelcomePage: vi.fn() }));

// wxt/browser's types are generated from @types/chrome and don't know about
// sidebarAction (see entrypoints/background.ts) — cast to read it back.
const firefoxBrowser = browser as unknown as { sidebarAction: { open: ReturnType<typeof vi.fn> } };

type Handler = (tab: { id?: number }) => void;

// Records the order the click handler calls things in: the open() has to come
// first, inside the user gesture.
let calls: string[];

// What runtime.sendMessage does with no panel open to receive it.
const noReceiver = () => Promise.reject(new Error("Could not establish connection. Receiving end does not exist."));

async function loadBackground(
  isFirefox: boolean,
  sendMessage: (message: unknown) => Promise<unknown> = noReceiver,
): Promise<Handler> {
  vi.stubEnv("FIREFOX", isFirefox ? "true" : "");
  let handler: Handler | undefined;
  calls = [];
  (globalThis as Record<string, unknown>).defineBackground = (main: () => void) => main();
  stubBrowser({
    runtime: { id: "vitest", sendMessage: vi.fn((m: unknown) => { calls.push("sendMessage"); return sendMessage(m); }) },
    action: { onClicked: { addListener: (fn: Handler) => { handler = fn; } } },
    sidePanel: { open: vi.fn(() => { calls.push("open"); }) },
    sidebarAction: { open: vi.fn(() => { calls.push("open"); }) },
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
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
  });

  // The panel that is already open cannot see the click that just granted it
  // access, so it is told -- after the open, which needs the gesture.
  it.each([false, true])("tells an open panel about the click, after opening it (firefox: %s)", async (firefox) => {
    const onClicked = await loadBackground(firefox, async () => undefined);
    onClicked({ id: 7 });

    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: ACTION_CLICKED, tabId: 7 });
    expect(calls).toEqual(["open", "sendMessage"]);
  });

  // No panel open is the ordinary case -- this click is opening it, and it
  // scans on mount. The rejection must not surface as an unhandled one.
  it("swallows the send failing when no panel is open to hear it", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const onClicked = await loadBackground(false);

    expect(() => onClicked({ id: 7 })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));

    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(browser.sidePanel.open).toHaveBeenCalledWith({ tabId: 7 });
  });
});
