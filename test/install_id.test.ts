import { describe, it, expect, beforeEach, vi } from "vitest";
import { getInstallId } from "../lib/install_id";

beforeEach(() => {
  const store: Record<string, unknown> = {};
  globalThis.chrome = {
    storage: { local: {
      get: vi.fn(async (k: string) => ({ [k]: store[k] })),
      set: vi.fn(async (obj: Record<string, unknown>) => Object.assign(store, obj)),
    } },
  } as unknown as typeof chrome;
  // Direct assignment (`globalThis.crypto = ...`) throws under jsdom/Node's
  // strict-mode ESM here: crypto is a getter-only accessor with no setter.
  // Object.defineProperty replaces it the same way (crypto's descriptor is
  // configurable), preserving the brief's stubbing intent.
  Object.defineProperty(globalThis, "crypto", {
    value: { randomUUID: () => "uuid-fixed" },
    configurable: true,
    writable: true,
  });
});

describe("getInstallId", () => {
  it("generates and persists on first call", async () => {
    expect(await getInstallId()).toBe("uuid-fixed");
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ install_id: "uuid-fixed" });
  });

  it("returns the stored value on subsequent calls", async () => {
    await getInstallId();
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockClear();
    expect(await getInstallId()).toBe("uuid-fixed");
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});
