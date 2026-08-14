import { describe, it, expect, vi, afterEach } from "vitest";
import { downloadText, catalogueFilename } from "../lib/download";

afterEach(() => { vi.restoreAllMocks(); });

describe("catalogueFilename", () => {
  it("names the file after the store and the day", () => {
    expect(catalogueFilename("demo.example", new Date("2026-08-02T10:00:00Z")))
      .toBe("demo.example-products-2026-08-02.csv");
  });

  it("drops a leading www so the name matches what the header shows", () => {
    expect(catalogueFilename("www.demo.example", new Date("2026-08-02T10:00:00Z")))
      .toBe("demo.example-products-2026-08-02.csv");
  });

  // The panel's disclosure line stops being read the moment the download lands,
  // and the file itself carries no room for one: a note row would be a row
  // Shopify's importer tries to import. The name is the only place a truncated
  // export can say so, and it has to, because the row count cannot -- 10,000
  // Fashion Nova products came out as 75,530 variant rows, which is exactly what
  // made a working ceiling look like no ceiling at all.
  it("says what a truncated export holds and what the store has", () => {
    expect(catalogueFilename("www.fashionnova.com", new Date("2026-08-12T10:00:00Z"),
      { exported: 10000, total: 42098 }))
      .toBe("fashionnova.com-products-first-10000-of-42098-2026-08-12.csv");
  });

  // A count we never read is not a count. The file still says it is partial,
  // because that much we do know from the walk itself.
  it("omits the store total from a truncated name when the size was never read", () => {
    expect(catalogueFilename("demo.example", new Date("2026-08-12T10:00:00Z"),
      { exported: 10000, total: null }))
      .toBe("demo.example-products-first-10000-2026-08-12.csv");
  });

  // Nothing to disclose, so nothing in the name: the ordinary export keeps the
  // name it has always had.
  it("leaves a complete export's name alone", () => {
    expect(catalogueFilename("demo.example", new Date("2026-08-12T10:00:00Z"), null))
      .toBe("demo.example-products-2026-08-12.csv");
  });
});

describe("downloadText", () => {
  it("downloads via a blob url, needing no downloads permission", () => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.fn();
    vi.spyOn(document, "createElement").mockReturnValue({
      click, set href(_v: string) {}, set download(_v: string) {},
    } as unknown as HTMLAnchorElement);

    downloadText("a.csv", "x,y\n");

    expect(create).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    // Not revoking leaks the blob for the panel's lifetime, and the panel is
    // long-lived -- it outlives the tab it scanned.
    expect(revoke).toHaveBeenCalledWith("blob:x");
  });
});
