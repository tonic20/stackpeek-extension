import { describe, it, expect } from "vitest";
import { toReportCsv, toReportJson, toReportMarkdown } from "../lib/report";

// The shape /api/v1/detect actually returns, narrowed to what the panel renders.
// Field names verified against the section components and test/App.test.ts.
const scan = (over: Record<string, unknown> = {}) => ({
  domain: "spotonfence.com",
  scannedAt: new Date("2026-08-23T09:00:00Z"),
  theme: { name: "Dawn", version: "15.3.0", price: null, theme_url: "https://themes.shopify.com/dawn", origin: "catalog" },
  apps: [{ name: "Judge.me", category: "Reviews", app_store_url: "https://apps.shopify.com/judgeme", verified: true }],
  pixels: [{ name: "Meta Pixel", category: "Pixel" }],
  infrastructure: [{ name: "Cloudflare", category: "CDN" }],
  unknown_domain_count: 0,
  ...over,
});

const rows = (csv: string) => csv.trim().split("\n");

describe("toReportCsv", () => {
  it("emits one row per finding, tagged by kind", () => {
    const out = rows(toReportCsv(scan()));

    expect(out[0]).toBe("store,scanned_at,kind,name,category,verified,url");
    expect(out.slice(1).map((r) => r.split(",")[2])).toEqual([
      "theme", "app", "tracker", "infrastructure",
    ]);
  });

  it("quotes a name containing a comma, a quote or a newline", () => {
    const csv = toReportCsv(scan({
      apps: [{ name: 'Bold "Product" Options, Inc.\nUpsell', category: "Upsell", app_store_url: "", verified: true }],
      pixels: [], infrastructure: [], theme: null,
    }));

    expect(csv.trim().split("\n").length).toBe(3); // header + a row broken over two lines
    expect(csv).toContain('"Bold ""Product"" Options, Inc.\nUpsell"');
  });

  // The listing promises weak matches are marked rather than dropped. A file
  // that loses the marking turns a hedged claim into a confident one.
  it("carries the unverified marking through to the file", () => {
    const csv = toReportCsv(scan({
      apps: [
        { name: "Judge.me", category: "Reviews", app_store_url: "", verified: true },
        { name: "Maybe Klaviyo", category: "Email", app_store_url: "", verified: false },
      ],
      pixels: [], infrastructure: [], theme: null,
    }));
    const verified = csv.trim().split("\n").slice(1).map((r) => r.split(",")[5]);

    expect(verified).toEqual(["yes", "no"]);
  });

  // The panel's rule is presentation, the column is data: a file whose
  // `verified` meant different things in different scans could not be
  // compared with another.
  it("keeps the raw verified field even when the panel would hide every marker", () => {
    const csv = toReportCsv(scan({
      apps: [
        { name: "Judge.me", category: "Reviews", app_store_url: "", verified: false },
        { name: "Klaviyo", category: "Email", app_store_url: "", verified: false },
      ],
      pixels: [], infrastructure: [], theme: null,
    }));

    expect(csv.trim().split("\n").slice(1).map((r) => r.split(",")[5])).toEqual(["no", "no"]);
  });

  // Only apps carry a confidence, so a blank is the honest cell for the rest --
  // "no" would read as "we checked and it is not verified".
  it("leaves verified blank for findings that have no confidence", () => {
    const csv = toReportCsv(scan({ apps: [], pixels: [], infrastructure: [] }));

    expect(csv.trim().split("\n")[1]?.split(",")[5]).toBe("");
  });
});

describe("toReportJson", () => {
  it("keeps the sections the panel shows, and the fields each renders", () => {
    const out = JSON.parse(toReportJson(scan()));

    expect(Object.keys(out)).toEqual([
      "store", "scanned_at", "theme", "apps", "trackers", "infrastructure", "unknown_domain_count",
    ]);
    expect(out.theme).toEqual({
      name: "Dawn", version: "15.3.0", price: null, origin: "catalog",
      url: "https://themes.shopify.com/dawn",
    });
    expect(out.apps).toEqual([
      { name: "Judge.me", category: "Reviews", verified: true, url: "https://apps.shopify.com/judgeme" },
    ]);
  });

  // The panel counts hosts it could not attribute so the gap stays visible.
  // A file that drops the count reads as a complete answer.
  it("carries the unattributed-host count", () => {
    expect(JSON.parse(toReportJson(scan({ unknown_domain_count: 7 }))).unknown_domain_count).toBe(7);
  });

  it("reports a theme that could not be read rather than omitting it", () => {
    const out = JSON.parse(toReportJson(scan({
      theme: { name: null, version: null, price: null, theme_url: null, origin: "headless" },
    })));

    expect(out.theme.origin).toBe("headless");
  });
});

describe("toReportMarkdown", () => {
  it("titles the report with the store and names each section the way the panel does", () => {
    const md = toReportMarkdown(scan());

    expect(md.split("\n")[0]).toBe("# spotonfence.com");
    expect(md).toContain("## Theme");
    expect(md).toContain("## Apps");
    expect(md).toContain("## Trackers");
    expect(md).toContain("## Infrastructure");
  });

  it("marks an unverified app the way the panel marks it", () => {
    const md = toReportMarkdown(scan({
      apps: [
        { name: "Judge.me", category: "Reviews", verified: true },
        { name: "Maybe Klaviyo", category: "Email", verified: false },
      ],
    }));

    expect(md).toContain("- Judge.me — Reviews");
    expect(md).toContain("- Maybe Klaviyo — Email (unverified)");
  });

  // The panel hides the marker when every app is unverified -- a flag on
  // everything distinguishes nothing (lib/unverified.ts). The report used to
  // print it after every app regardless, so the pasted copy flagged apps the
  // screen it came from had not.
  it("marks nothing when every app is unverified, as the panel does", () => {
    const md = toReportMarkdown(scan({
      apps: [
        { name: "Judge.me", category: "Reviews", verified: false },
        { name: "Klaviyo", category: "Email", verified: false },
      ],
    }));

    expect(md).not.toContain("unverified");
    expect(md).toContain("- Judge.me — Reviews\n");
  });

  // The group headings in the panel are looked up by slug and translated; the
  // server's English name is only the fallback for a slug this build lacks.
  it("labels categories the way the panel's group headings do", () => {
    const md = toReportMarkdown(scan({
      apps: [
        { name: "Klaviyo", category: "Email", category_slug: "email-sms", verified: true },
        { name: "Newcomer", category: "Brand New Category", category_slug: "brand-new", verified: true },
      ],
    }));

    expect(md).toContain("- Klaviyo — Email & SMS");
    expect(md).toContain("- Newcomer — Brand New Category");
  });

  // ThemeCard's names, not the API's origin enum.
  it.each([
    [{ name: null, version: null, origin: "headless" }, "Headless storefront"],
    [{ name: null, version: null, origin: "custom" }, "Custom theme"],
    [{ name: "Handover", version: "2.0", origin: "custom" }, "Handover"],
    [{ name: "Dawn", version: "15.1.0", origin: "forked" }, "Dawn 15.1.0 (customized)"],
    [{ name: "Dawn", version: "15.3.0", origin: "catalog" }, "Dawn 15.3.0"],
  ])("names the theme as the panel does: %o", (theme, line) => {
    const md = toReportMarkdown(scan({ theme }));

    expect(md).toContain(`## Theme\n\n${line}\n`);
  });

  // A heading with nothing under it reads as a section that failed, not one
  // that found nothing. The panel hides empty sections; so does the file.
  it("omits a section the scan found nothing for", () => {
    const md = toReportMarkdown(scan({ infrastructure: [], pixels: [] }));

    expect(md).not.toContain("## Infrastructure");
    expect(md).not.toContain("## Trackers");
  });
});
