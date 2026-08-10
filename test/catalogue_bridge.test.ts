import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchCatalogueDigest, fetchCataloguePage, fetchCollectionPages } from "../lib/catalogue_bridge";

beforeEach(() => {
  globalThis.chrome = {
    tabs: { query: vi.fn(async () => [{ id: 7, url: "https://demo.example/" }]) },
    scripting: { executeScript: vi.fn(async () => [{ result: { available: true, count: 3 } }]) },
  } as unknown as typeof chrome;
});

afterEach(() => {
  // @ts-expect-error `chrome` only exists inside the extension.
  delete globalThis.chrome;
});

describe("fetchCatalogueDigest", () => {
  it("injects into the active tab and returns the digest", async () => {
    const d = await fetchCatalogueDigest();

    expect(d.count).toBe(3);
    const call = (chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.target).toEqual({ tabId: 7 });
    expect(call.world).toBe("MAIN");
  });

  // An unreadable catalogue is the "unavailable" state, not an error, and must
  // never take down the scan result already on screen.
  it("reports unavailable when the injection fails", async () => {
    (chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("denied"));

    expect((await fetchCatalogueDigest()).available).toBe(false);
  });

  it("reports unavailable when there is no active tab", async () => {
    (chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    expect((await fetchCatalogueDigest()).available).toBe(false);
  });
});

describe("fetchCataloguePage", () => {
  it("passes the page number through to the page", async () => {
    (chrome.scripting.executeScript as ReturnType<typeof vi.fn>)
      .mockResolvedValue([{ result: [{ handle: "a" }] }]);

    const page = await fetchCataloguePage(3);

    expect(page).toEqual([{ handle: "a" }]);
    expect((chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mock.calls[0]![0].args).toEqual([3]);
  });

  it("returns null when the injection fails", async () => {
    (chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("denied"));

    expect(await fetchCataloguePage(1)).toBeNull();
  });
});

describe("fetchCollectionPages", () => {
  it("returns both bodies", async () => {
    (chrome.scripting.executeScript as ReturnType<typeof vi.fn>)
      .mockResolvedValue([{ result: { bestSelling: "BS", alphabetical: "AZ" } }]);

    expect(await fetchCollectionPages()).toEqual({ bestSelling: "BS", alphabetical: "AZ" });
  });

  // Losing the collection page costs the ranking and never the summary.
  it("returns null when the injection fails", async () => {
    (chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("denied"));

    expect(await fetchCollectionPages()).toBeNull();
  });
});
