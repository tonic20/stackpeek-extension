import { describe, it, expect, vi, afterEach } from "vitest";
import { shortcut } from "../lib/shortcut";
import { stubBrowser } from "./setup";

afterEach(() => stubBrowser({}));

function stubCommands(key: string) {
  const store: Record<string, unknown> = {};
  const commands = {
    getAll: vi.fn(async () => [{ name: "other", shortcut: "Ctrl+Q" }, { name: "_execute_action", shortcut: key }]),
    update: vi.fn(async ({ shortcut: k }: { shortcut: string }) => { key = k; }),
    reset: vi.fn(async () => { key = "Alt+Shift+S"; }),
  };
  stubBrowser({
    commands,
    storage: { local: {
      get: async (k: string) => (k in store ? { [k]: store[k] } : {}),
      set: async (items: Record<string, unknown>) => { Object.assign(store, items); },
    } },
  });
  return commands;
}

describe("shortcut", () => {
  it("reads the toolbar action's binding", async () => {
    stubCommands("⌥⇧S");
    expect(await shortcut.read()).toBe("⌥⇧S");
  });

  it("reads empty when unbound, and null without a commands API", async () => {
    stubCommands("");
    expect(await shortcut.read()).toBe("");

    stubBrowser({});
    expect(await shortcut.read()).toBeNull();
  });

  // Firefox only in practice; the calls are the same either way.
  it("unbinds, then brings back the user's own key rather than the default", async () => {
    const commands = stubCommands("Ctrl+Shift+K");

    await shortcut.setEnabled(false);
    expect(await shortcut.read()).toBe("");

    await shortcut.setEnabled(true);
    expect(await shortcut.read()).toBe("Ctrl+Shift+K");
    expect(commands.reset).not.toHaveBeenCalled();
  });

  it("falls back to the manifest default when there is no key to restore", async () => {
    const commands = stubCommands("");

    await shortcut.setEnabled(true);

    expect(commands.reset).toHaveBeenCalledWith("_execute_action");
    expect(await shortcut.read()).toBe("Alt+Shift+S");
  });
});
