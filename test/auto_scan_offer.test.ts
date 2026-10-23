import { describe, it, expect, vi, afterEach } from "vitest";
import { autoScanOffer } from "../lib/auto_scan_offer";
import { stubBrowser } from "./setup";

afterEach(() => stubBrowser({}));

describe("autoScanOffer", () => {
  it("is pending until closed", async () => {
    const store: Record<string, unknown> = {};
    stubBrowser({
      storage: { local: {
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (items: Record<string, unknown>) => { Object.assign(store, items); },
      } },
    });

    expect(await autoScanOffer.pending()).toBe(true);
    autoScanOffer.close();
    await vi.waitFor(async () => expect(await autoScanOffer.pending()).toBe(false));
  });

  it("is never pending where nothing could remember the answer", async () => {
    stubBrowser({});
    expect(await autoScanOffer.pending()).toBe(false);

    stubBrowser({ storage: { local: { get: async () => { throw new Error("denied"); }, set: async () => {} } } });
    expect(await autoScanOffer.pending()).toBe(false);
  });
});
