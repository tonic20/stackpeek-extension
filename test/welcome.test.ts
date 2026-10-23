// The welcome page the extension opens once after install (lib/welcome.ts).
// registerWelcomePage reads FIREFOX and WXT_WELCOME_BASE at import, so each
// case stubs the env first and imports a fresh copy.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { stubBrowser } from "./setup";
import { welcomeUrl } from "../lib/welcome";

describe("welcomeUrl", () => {
  const base = "https://stackpeek.app";

  it("carries the pin state, browser, id and the name the browser shows", () => {
    const url = new URL(
      welcomeUrl({ base, pinned: false, browser: "chrome", id: "abc", name: "Détecteur - Stackpeek" }),
    );
    expect(url.origin + url.pathname).toBe("https://stackpeek.app/welcome");
    expect(url.searchParams.get("pinned")).toBe("0");
    expect(url.searchParams.get("browser")).toBe("chrome");
    expect(url.searchParams.get("id")).toBe("abc");
    expect(url.searchParams.get("name")).toBe("Détecteur - Stackpeek");
  });

  it("writes pinned=1 when the icon is on the toolbar", () => {
    expect(new URL(welcomeUrl({ base, pinned: true, browser: "chrome" })).searchParams.get("pinned")).toBe("1");
  });

  it("leaves out what is not known", () => {
    const q = new URL(welcomeUrl({ base, browser: "firefox" })).searchParams;
    expect(q.has("pinned")).toBe(false);
    expect(q.has("id")).toBe(false);
    expect(q.has("name")).toBe(false);
    expect(q.get("browser")).toBe("firefox");
  });

  it("encodes the ampersand in the English name", () => {
    const href = welcomeUrl({ base, browser: "chrome", name: "Shopify Theme Detector & Apps - Stackpeek" });
    expect(href).not.toContain("& ");
    expect(new URL(href).searchParams.get("name")).toBe("Shopify Theme Detector & Apps - Stackpeek");
  });
});

type InstalledListener = (details: { reason: string }) => void;
type Port = {
  sender?: { origin?: string };
  postMessage: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  onDisconnect: { addListener: (fn: () => void) => void };
};
type ConnectListener = (port: Port) => void;

async function load(o: {
  firefox?: boolean;
  base?: string;
  getUserSettings?: () => Promise<{ isOnToolbar?: boolean }>;
  withChangeEvent?: boolean;
}) {
  vi.stubEnv("FIREFOX", o.firefox ? "true" : "");
  if (o.base !== undefined) vi.stubEnv("WXT_WELCOME_BASE", o.base);
  let onInstalled: InstalledListener | undefined;
  let onConnect: ConnectListener | undefined;
  let onChange: ((change: { isOnToolbar?: boolean }) => void) | undefined;
  const removeListener = vi.fn();
  const create = vi.fn(async (_props: { url: string }) => ({}));
  stubBrowser({
    runtime: {
      id: "abcdefghijklmnopabcdefghijklmnop",
      onInstalled: { addListener: (fn: InstalledListener) => { onInstalled = fn; } },
      onConnectExternal: { addListener: (fn: ConnectListener) => { onConnect = fn; } },
    },
    action: {
      getUserSettings: o.getUserSettings ?? (async () => ({ isOnToolbar: false })),
      ...(o.withChangeEvent === false
        ? {}
        : { onUserSettingsChanged: { addListener: (fn: typeof onChange) => { onChange = fn; }, removeListener } }),
    },
    tabs: { create },
  });
  vi.resetModules();
  const { registerWelcomePage } = await import("../lib/welcome");
  registerWelcomePage();
  return {
    create,
    opened: () => new URL(create.mock.calls[0]![0].url),
    removeListener,
    install: async (reason: string) => {
      onInstalled?.({ reason });
      await flush();
    },
    get onConnect() { return onConnect; },
    get onChange() { return onChange; },
  };
}

function port(origin: string | undefined): Port & { disconnected: () => void } {
  let onDisconnect: (() => void) | undefined;
  return {
    sender: { origin },
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onDisconnect: { addListener: (fn) => { onDisconnect = fn; } },
    disconnected: () => onDisconnect?.(),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("opening the welcome page", () => {
  it("opens it once on a fresh install, with the pin state, id and name", async () => {
    const bg = await load({});
    await bg.install("install");
    expect(bg.create).toHaveBeenCalledTimes(1);
    const url = bg.opened();
    expect(url.origin + url.pathname).toBe("https://stackpeek.app/welcome");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      pinned: "0",
      browser: "chrome",
      id: "abcdefghijklmnopabcdefghijklmnop",
      name: "Shopify Theme Detector & Apps - Stackpeek",
    });
  });

  it("opens nothing on an update or a browser update", async () => {
    const bg = await load({});
    await bg.install("update");
    await bg.install("chrome_update");
    expect(bg.create).not.toHaveBeenCalled();
  });

  it("leaves the pin state out when the browser cannot tell", async () => {
    const bg = await load({ getUserSettings: async () => { throw new Error("not here"); } });
    await bg.install("install");
    expect(bg.opened().searchParams.has("pinned")).toBe(false);
  });

  it("names Firefox and sends no id there, which nothing could connect with", async () => {
    const bg = await load({ firefox: true, getUserSettings: async () => ({ isOnToolbar: true }) });
    await bg.install("install");
    const q = bg.opened().searchParams;
    expect(q.get("browser")).toBe("firefox");
    expect(q.get("pinned")).toBe("1");
    expect(q.has("id")).toBe(false);
  });

  it("opens nothing when the base is emptied", async () => {
    const bg = await load({ base: "" });
    await bg.install("install");
    expect(bg.create).not.toHaveBeenCalled();
    expect(bg.onConnect).toBeUndefined();
  });

  it("opens the page on the configured base", async () => {
    const bg = await load({ base: "http://localhost:3071" });
    await bg.install("install");
    expect(bg.opened().origin).toBe("http://localhost:3071");
  });
});

describe("the welcome page's port", () => {
  it("answers the welcome page with the pin state", async () => {
    const bg = await load({ getUserSettings: async () => ({ isOnToolbar: true }) });
    const p = port("https://stackpeek.app");
    bg.onConnect!(p);
    await flush();
    expect(p.postMessage).toHaveBeenCalledWith({ pinned: true });
    expect(p.disconnect).not.toHaveBeenCalled();
  });

  it("refuses any other origin", async () => {
    const bg = await load({});
    for (const origin of ["https://evil.example", "https://stackpeek.app.evil.example", undefined]) {
      const p = port(origin);
      bg.onConnect!(p);
      await flush();
      expect(p.disconnect).toHaveBeenCalled();
      expect(p.postMessage).not.toHaveBeenCalled();
    }
  });

  it("forwards each pin and unpin, and stops when the page goes", async () => {
    const bg = await load({});
    const p = port("https://stackpeek.app");
    bg.onConnect!(p);
    await flush();
    bg.onChange!({ isOnToolbar: true });
    bg.onChange!({});
    bg.onChange!({ isOnToolbar: false });
    expect(p.postMessage.mock.calls.map((c) => c[0])).toEqual([
      { pinned: false },
      { pinned: true },
      { pinned: false },
    ]);
    p.disconnected();
    expect(bg.removeListener).toHaveBeenCalledWith(bg.onChange);
  });

  it("still answers once where the change event does not exist", async () => {
    const bg = await load({ withChangeEvent: false });
    const p = port("https://stackpeek.app");
    bg.onConnect!(p);
    await flush();
    expect(p.postMessage).toHaveBeenCalledWith({ pinned: false });
  });

  it("survives a page that closed before the answer", async () => {
    const bg = await load({});
    const p = port("https://stackpeek.app");
    p.postMessage.mockImplementation(() => { throw new Error("Attempting to use a disconnected port object"); });
    bg.onConnect!(p);
    await flush();
    expect(() => bg.onChange!({ isOnToolbar: true })).not.toThrow();
  });

  it("is not registered on Firefox", async () => {
    const bg = await load({ firefox: true });
    expect(bg.onConnect).toBeUndefined();
  });
});
