import { describe, it, expect, afterEach, vi } from "vitest";
import { collectCatalogueDigest, collectCataloguePage, collectCollectionPages } from "../lib/catalogue";
import { collectSignals } from "../lib/collector";

// chrome.scripting.executeScript({func}) serialises the function's OWN SOURCE
// via toString() and nothing else. Imports, module-scope constants and any other
// outer binding are simply absent in the page, and referencing one is a
// ReferenceError at runtime.
//
// Every other test in this repo imports these functions normally, where module
// scope is right there -- so none of them can see this class of bug. Injecting a
// module-scope reference shipped once already: collectCatalogueDigest read a
// module-level PAGE_SIZE, threw in the page, was swallowed by its own catch, and
// reported every store's catalogue as "not public".
//
// `new Function` reproduces injection exactly: the returned function's scope
// chain is global only.
function asInjected<T extends (...args: never[]) => unknown>(fn: T): T {
  return new Function(`return (${fn.toString()})`)() as T;
}

afterEach(() => {
  // @ts-expect-error test-local global
  delete globalThis.fetch;
  delete (globalThis as any).Shopify;
});

describe("functions injected into the page are self-contained", () => {
  it("collectCatalogueDigest runs with only its own source", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true, json: async () => ({ products: [{ handle: "a", title: "A", variants: [{ price: "1.00" }] }] }),
    } as unknown as Response)) as unknown as typeof fetch;

    const digest = await asInjected(collectCatalogueDigest)(25 as never);

    expect(digest).toMatchObject({ available: true, count: 1 });
  });

  it("collectCataloguePage runs with only its own source", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true, json: async () => ({ products: [{ handle: "a" }] }),
    } as unknown as Response)) as unknown as typeof fetch;

    expect(await asInjected(collectCataloguePage)(1 as never)).toEqual([{ handle: "a" }]);
  });

  it("collectCollectionPages runs with only its own source", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, text: async () => "x" } as unknown as Response)) as unknown as typeof fetch;

    expect(await asInjected(collectCollectionPages)()).toEqual({ bestSelling: "x", alphabetical: "x" });
  });

  // The existing precedent, and the reason the constraint is known at all:
  // collector.ts declares its one helper inside the injected function.
  it("collectSignals runs with only its own source", async () => {
    const signals = await asInjected(collectSignals)([] as never, 0 as never);

    expect(signals).toHaveProperty("script_urls");
  });
});
