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
