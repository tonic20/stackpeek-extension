import { describe, it, expect, beforeEach } from "vitest";
import { collectSignals } from "../lib/collector";

function setPage({
  scripts = [],
  links = [],
  metas = [],
  shopify = undefined,
  globals = {},
}: {
  scripts?: string[];
  links?: string[];
  metas?: string[];
  shopify?: { shop?: string; theme?: { name?: string; theme_store_id?: string | null } };
  globals?: Record<string, unknown>;
}) {
  document.head.innerHTML = "";
  scripts.forEach((src) => { const s = document.createElement("script"); s.src = src; document.head.appendChild(s); });
  // rel=stylesheet: these cases are exercising URL handling (dedup, query
  // stripping), not rel filtering, so the fixture needs a rel that collector.ts
  // treats as a resource -- a rel-less <link> is now excluded (see collector.ts).
  links.forEach((href) => { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.appendChild(l); });
  metas.forEach((name) => { const m = document.createElement("meta"); m.name = name; document.head.appendChild(m); });
  if (shopify === undefined) delete (window as any).Shopify; else (window as any).Shopify = shopify;
  Object.assign(window, globals);
}

describe("collectSignals", () => {
  beforeEach(() => { document.head.innerHTML = ""; delete (window as any).Shopify; });

  it("collects deduped full script/link urls", async () => {
    setPage({
      scripts: ["https://cdn.judge.me/a.js", "https://cdn.judge.me/b.js", "https://cdn.judge.me/a.js"],
      links: ["https://static.klaviyo.com/x.css"],
    });
    const out = await collectSignals([], 0);
    expect(out.script_urls).toContain("https://cdn.judge.me/a.js");
    expect(out.script_urls).toContain("https://cdn.judge.me/b.js");
    expect(out.script_urls).toContain("https://static.klaviyo.com/x.css");
    expect(out.script_urls.filter((u) => u === "https://cdn.judge.me/a.js")).toHaveLength(1);
  });

  it("reports only globals from the list that are present", async () => {
    setPage({ globals: { jdgm: {}, __PF__: {} } });
    const out = await collectSignals(["jdgm", "klaviyo", "__PF__"], 0);
    expect(out.window_globals.sort()).toEqual(["__PF__", "jdgm"]);
  });

  // 8and9.com's Shopify.theme carries a `sections` tree with a circular
  // reference (player -> parent -> back). Neither chrome.scripting nor
  // page.evaluate rejects it -- both structured-clone, which handles cycles --
  // so the cyclic object reached JSON.stringify in lib/api.ts and threw,
  // failing the whole detection for that store. It killed a corpus crawl 135
  // domains in. Capturing named fields rather than the object is the fix; this
  // pins it.
  it("survives a circular reference inside Shopify.theme", async () => {
    const sections: Record<string, unknown> = { player: {} };
    (sections.player as Record<string, unknown>).parent = sections;

    setPage({
      shopify: {
        shop: "cyclic.myshopify.com",
        theme: {
          name: "Impulse", theme_store_id: 857, schema_name: "Impulse",
          schema_version: "7.2.0", sections,
        },
      } as never,
    });
    const out = await collectSignals([], 0);

    // The payload is JSON.stringify'd on every path that consumes it, so this
    // assertion is the one that matters: it must not throw.
    expect(() => JSON.stringify(out)).not.toThrow();
    expect((out.shopify as { theme: Record<string, unknown> }).theme).toEqual({
      theme_store_id: 857, name: "Impulse",
      schema_name: "Impulse", schema_version: "7.2.0",
    });
  });

  // Everything DetectionService#theme_result reads, and nothing else. `sections`
  // alone runs to tens of kilobytes on a large theme and has never been read.
  it("captures only the four theme fields anything downstream reads", async () => {
    setPage({
      shopify: {
        shop: "s.myshopify.com",
        theme: {
          name: "Dawn", theme_store_id: 887, schema_name: "Dawn",
          schema_version: "15.0.0", id: 123, role: "main", handle: "dawn",
          style: { id: 1 }, sections: { a: 1 },
        },
      } as never,
    });
    const out = await collectSignals([], 0);

    expect(Object.keys((out.shopify as { theme: object }).theme).sort())
      .toEqual(["name", "schema_name", "schema_version", "theme_store_id"]);
  });

  it("extracts window.Shopify shop + theme", async () => {
    setPage({ shopify: { shop: "allbirds.myshopify.com", theme: { name: "Handover theme", theme_store_id: null } } });
    const out = await collectSignals([], 0);
    expect((out.shopify as { shop: string }).shop).toBe("allbirds.myshopify.com");
    expect((out.shopify as { theme: { theme_store_id: unknown } }).theme.theme_store_id).toBeNull();
  });

  it("shopify is null when window.Shopify absent", async () => {
    setPage({});
    expect((await collectSignals([], 0)).shopify).toBeNull();
  });

  it("collects shopify meta tags", async () => {
    setPage({ metas: ["shopify-checkout-api-token", "viewport"] });
    expect((await collectSignals([], 0)).meta_tags).toContain("shopify-checkout-api-token");
  });

  it("survives serialization/injection (self-contained, no module-scope refs)", async () => {
    setPage({ scripts: ["https://cdn.judge.me/a.js"], globals: { jdgm: {} } });
    // Chrome injects func.toString() into the page; only the function's own source travels.
    const reconstructed = new Function("return (" + collectSignals.toString() + ")")();
    const out = await reconstructed(["jdgm"], 0);
    expect(out.script_urls).toContain("https://cdn.judge.me/a.js");
    expect(out.window_globals).toEqual(["jdgm"]);
  });

  it("waits for window.Shopify when injected before the inline script runs", async () => {
    setPage({});
    Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
    const pending = collectSignals([], 1000);
    setTimeout(() => { (window as any).Shopify = { shop: "late.myshopify.com", theme: null }; }, 30);
    const out = await pending;
    expect((out.shopify as { shop: string }).shop).toBe("late.myshopify.com");
    Object.defineProperty(document, "readyState", { value: "complete", configurable: true });
  });

  it("gives up at the cap and reports no shopify rather than hanging", async () => {
    setPage({});
    Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
    const out = await collectSignals([], 60);
    expect(out.shopify).toBeNull();
    Object.defineProperty(document, "readyState", { value: "complete", configurable: true });
  });

  // jsdom's default test document lives at http://localhost:3000/, so that
  // origin stands in for "the page being scanned" in the cases below.
  describe("same-origin query/fragment stripping", () => {
    it("strips a same-origin URL's query string and fragment but keeps its path", async () => {
      setPage({
        scripts: ["http://localhost:3000/search?q=running+shoes&discount=SUMMER20#results"],
      });
      const out = await collectSignals([], 0);
      expect(out.script_urls).toContain("http://localhost:3000/search");
      expect(out.script_urls).not.toContain(
        "http://localhost:3000/search?q=running+shoes&discount=SUMMER20#results",
      );
    });

    it("leaves a third-party URL's path and query untouched", async () => {
      setPage({
        links: ["https://cdn.judge.me/widget.js?v=2&utm_source=storefront"],
      });
      const out = await collectSignals([], 0);
      expect(out.script_urls).toContain("https://cdn.judge.me/widget.js?v=2&utm_source=storefront");
    });

    it("leaves a cdn.shopify.com asset untouched even though it belongs to the store", async () => {
      setPage({
        scripts: ["https://cdn.shopify.com/s/files/1/0001/assets/theme.js?v=169#section"],
      });
      const out = await collectSignals([], 0);
      expect(out.script_urls).toContain("https://cdn.shopify.com/s/files/1/0001/assets/theme.js?v=169#section");
    });

    it("truncates a protocol-relative href that resolves to the same origin", async () => {
      setPage({
        links: ["//localhost:3000/collections/all?page=3"],
      });
      const out = await collectSignals([], 0);
      expect(out.script_urls).toContain("http://localhost:3000/collections/all");
      expect(out.script_urls.some((u) => u.includes("page=3"))).toBe(false);
    });

    it("does not throw on a data: URL and leaves it unchanged", async () => {
      setPage({
        scripts: ["data:text/javascript;base64,Y29uc29sZS5sb2coMSk="],
      });
      const out = await collectSignals([], 0);
      expect(out.script_urls).toContain("data:text/javascript;base64,Y29uc29sZS5sb2coMSk=");
    });

    it("does not throw on a blob: URL and leaves it unchanged", async () => {
      setPage({
        scripts: ["blob:http://localhost:3000/3f3e3f1a-0000-4000-8000-000000000000"],
      });
      const out = await collectSignals([], 0);
      expect(out.script_urls).toContain("blob:http://localhost:3000/3f3e3f1a-0000-4000-8000-000000000000");
    });

    it("dedupes many same-origin links that differ only by query string into one path", async () => {
      setPage({
        links: [
          "http://localhost:3000/collections/all?page=1",
          "http://localhost:3000/collections/all?page=2",
          "http://localhost:3000/collections/all?page=3",
        ],
      });
      const out = await collectSignals([], 0);
      const matches = out.script_urls.filter((u) => u === "http://localhost:3000/collections/all");
      expect(matches).toHaveLength(1);
    });
  });

  describe("navigation/SEO metadata links are excluded", () => {
    function addLink(rel: string, href: string) {
      const l = document.createElement("link");
      l.setAttribute("rel", rel);
      l.href = href;
      document.head.appendChild(l);
    }

    it("does not collect a same-origin rel=canonical link", async () => {
      addLink("canonical", "http://localhost:3000/products/blue-shirt");
      const out = await collectSignals([], 0);
      expect(out.script_urls).not.toContain("http://localhost:3000/products/blue-shirt");
    });

    it("does not collect a cross-origin rel=canonical link", async () => {
      addLink("canonical", "https://other-store.example/products/blue-shirt");
      const out = await collectSignals([], 0);
      expect(out.script_urls).not.toContain("https://other-store.example/products/blue-shirt");
    });

    it("does not collect rel=next, prev, shortlink, or amphtml links, case-insensitively", async () => {
      addLink("Next", "http://localhost:3000/collections/sale?page=2");
      addLink("PREV", "http://localhost:3000/collections/sale?page=1");
      addLink("shortlink", "http://localhost:3000/?p=123");
      addLink("AMPHTML", "http://localhost:3000/products/blue-shirt/amp");
      const out = await collectSignals([], 0);
      expect(out.script_urls).toEqual([]);
    });

    it("collects a rel='alternate stylesheet' link -- a real stylesheet, not a bare alternate", async () => {
      addLink("alternate stylesheet", "https://cdn.example.com/alt-theme.css");
      const out = await collectSignals([], 0);
      expect(out.script_urls).toContain("https://cdn.example.com/alt-theme.css");
    });

    it("handles mixed-case, multi-token rel the same way", async () => {
      addLink("ALTERNATE STYLESHEET", "https://cdn.example.com/alt-theme-2.css");
      addLink("Alternate", "http://localhost:3000/fr/products/blue-shirt");
      const out = await collectSignals([], 0);
      expect(out.script_urls).toContain("https://cdn.example.com/alt-theme-2.css");
      expect(out.script_urls).not.toContain("http://localhost:3000/fr/products/blue-shirt");
    });

    it("still collects a plain rel=stylesheet link on the store's own origin, query stripped", async () => {
      addLink("stylesheet", "http://localhost:3000/assets/theme.css?v=42");
      const out = await collectSignals([], 0);
      expect(out.script_urls).toContain("http://localhost:3000/assets/theme.css");
    });
  });

  // A <link> with no rel is never a resource -- see the reasoning inline at
  // collector.ts. addLink() above always sets a rel attribute, which is
  // exactly why the schema.org bug went uncaught; these need a link with
  // none at all.
  describe("rel-less links are not resources", () => {
    function addAttrLink(attrs: Record<string, string>, href: string) {
      const l = document.createElement("link");
      Object.entries(attrs).forEach(([name, value]) => l.setAttribute(name, value));
      l.href = href;
      document.head.appendChild(l);
    }

    it("does not collect a microdata itemprop link with no rel", async () => {
      addAttrLink({ itemprop: "availability" }, "http://schema.org/InStock");
      const out = await collectSignals([], 0);
      expect(out.script_urls).not.toContain("http://schema.org/InStock");
    });

    it("does not collect a bare link[href] with no other attributes", async () => {
      addAttrLink({}, "https://example.com/nothing");
      const out = await collectSignals([], 0);
      expect(out.script_urls).not.toContain("https://example.com/nothing");
    });

    it("still collects a rel=stylesheet link on a third-party host", async () => {
      addAttrLink({ rel: "stylesheet" }, "https://cdn.example.com/vendor.css");
      const out = await collectSignals([], 0);
      expect(out.script_urls).toContain("https://cdn.example.com/vendor.css");
    });

    // preconnect hints are how v.shopify.com and cdn.shopifycloud.com were
    // observed in production, and both are live fingerprints -- this rel
    // must keep working.
    it("still collects a rel=preconnect link", async () => {
      addAttrLink({ rel: "preconnect" }, "https://cdn.example/");
      const out = await collectSignals([], 0);
      expect(out.script_urls).toContain("https://cdn.example/");
    });
  });
});
