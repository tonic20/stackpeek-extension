import { i18n } from "#i18n";

// The findings report: what the panel detected, in a shape another tool can
// read. Separate from lib/csv.ts, which exports the store's product catalogue
// in Shopify's import format -- a different subject with a fixed header the
// importer dictates. These two must not be merged: one is the store's data,
// the other is our reading of it.
//
// JSON and CSV stay in English whatever the panel's language. They are machine
// input, and a spreadsheet whose column names change with the reader's browser
// cannot be shared. This is the same rule CSV_HEADER in lib/csv.ts and
// catalogueFilename in lib/download.ts already follow, and for the same reason.

export interface ScanReport {
  domain: string;
  scannedAt: Date;
  theme: Record<string, unknown> | null;
  apps: Record<string, unknown>[];
  pixels: Record<string, unknown>[];
  infrastructure?: Record<string, unknown>[];
  unknown_domain_count?: number;
}

export const REPORT_CSV_HEADER = [
  "store", "scanned_at", "kind", "name", "category", "verified", "url",
] as const;

export type FindingKind = "theme" | "app" | "tracker" | "infrastructure";

export interface Finding {
  kind: FindingKind;
  name: string;
  category: string;
  /** null where the distinction does not apply -- only apps carry a match confidence. */
  verified: boolean | null;
  url: string;
}

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

// One flat list, in the order the panel stacks its sections, so a reader of the
// file and a reader of the screen see the same thing in the same order.
export function findingsOf(scan: ScanReport): Finding[] {
  const out: Finding[] = [];

  // A theme is reported whenever the scan settled on one, including the cases
  // where the answer is "cannot be read from the page": origin carries custom
  // and headless, and dropping those rows would turn a stated limit into a
  // silent gap. Only a scan with no theme object at all contributes nothing.
  if (scan.theme) {
    out.push({
      kind: "theme",
      name: str(scan.theme.name),
      category: str(scan.theme.origin),
      verified: null,
      url: str(scan.theme.theme_url),
    });
  }

  for (const app of scan.apps ?? []) {
    out.push({
      kind: "app",
      name: str(app.name),
      category: str(app.category),
      verified: app.verified === true,
      url: str(app.app_store_url),
    });
  }

  for (const pixel of scan.pixels ?? []) {
    out.push({ kind: "tracker", name: str(pixel.name), category: str(pixel.category), verified: null, url: "" });
  }

  for (const item of scan.infrastructure ?? []) {
    out.push({ kind: "infrastructure", name: str(item.name), category: str(item.category), verified: null, url: "" });
  }

  return out;
}

// Same rule as escape() in lib/csv.ts: RFC 4180, quote only when the cell
// needs it. An app name is vendor-supplied and reaches here verbatim, so a
// comma or a stray quote in one must not shift every later column.
function escape(value: unknown): string {
  const s = str(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toReportCsv(scan: ScanReport): string {
  const at = scan.scannedAt.toISOString();
  const rows = [
    REPORT_CSV_HEADER.join(","),
    ...findingsOf(scan).map((f) =>
      [
        scan.domain,
        at,
        f.kind,
        f.name,
        f.category,
        f.verified === null ? "" : f.verified ? "yes" : "no",
        f.url,
      ].map(escape).join(","),
    ),
  ];
  return rows.join("\n") + "\n";
}

// Nested rather than flat: the CSV is for a spreadsheet, this is for a script,
// and a script wants the theme as one object rather than a row it has to find.
// Key order matches the panel's section order for the same reason findingsOf
// is ordered -- a diff between two scans reads top to bottom.
export function toReportJson(scan: ScanReport): string {
  const theme = scan.theme
    ? {
        name: (scan.theme.name ?? null) as string | null,
        version: (scan.theme.version ?? null) as string | null,
        price: (scan.theme.price ?? null) as string | null,
        origin: (scan.theme.origin ?? null) as string | null,
        url: (scan.theme.theme_url ?? null) as string | null,
      }
    : null;

  return JSON.stringify(
    {
      store: scan.domain,
      scanned_at: scan.scannedAt.toISOString(),
      theme,
      apps: (scan.apps ?? []).map((a) => ({
        name: (a.name ?? null) as string | null,
        category: (a.category ?? null) as string | null,
        verified: a.verified === true,
        url: (a.app_store_url ?? null) as string | null,
      })),
      trackers: (scan.pixels ?? []).map((p) => ({
        name: (p.name ?? null) as string | null,
        category: (p.category ?? null) as string | null,
      })),
      infrastructure: (scan.infrastructure ?? []).map((i) => ({
        name: (i.name ?? null) as string | null,
        category: (i.category ?? null) as string | null,
      })),
      unknown_domain_count: scan.unknown_domain_count ?? 0,
    },
    null,
    2,
  );
}

// The human artefact, so unlike the CSV and the JSON it follows the panel's
// language -- someone pasting this into a ticket is writing for the same
// readers the panel was rendered for. Headings are the panel's own, so a
// pasted report and the screen it came from name their sections identically.
//
// Lists rather than tables: a Markdown table survives GitHub and Notion but
// degrades to noise in Slack and in plain-text mail, and nothing here needs
// columns to be read.
export function toReportMarkdown(scan: ScanReport): string {
  const out: string[] = [`# ${scan.domain}`, "", i18n.t("report.scanned", [scan.scannedAt.toISOString().slice(0, 10)])];

  const section = (heading: string, lines: string[]) => {
    // An empty heading reads as a section that failed rather than one that
    // found nothing, which is the opposite of what the scan established.
    if (!lines.length) return;
    out.push("", `## ${heading}`, "", ...lines);
  };

  if (scan.theme) {
    const name = str(scan.theme.name);
    const version = str(scan.theme.version);
    section(i18n.t("theme.heading"), [
      [name, version].filter(Boolean).join(" ") || str(scan.theme.origin),
    ]);
  }

  section(
    i18n.t("apps.heading"),
    (scan.apps ?? []).map((a) => {
      const flag = a.verified === true ? "" : ` (${i18n.t("apps.unverified")})`;
      return `- ${str(a.name)}${a.category ? ` — ${str(a.category)}` : ""}${flag}`;
    }),
  );

  section(i18n.t("trackers.heading"), (scan.pixels ?? []).map((p) => `- ${str(p.name)}`));
  section(i18n.t("infrastructure.heading"), (scan.infrastructure ?? []).map((i) => `- ${str(i.name)}`));

  return out.join("\n") + "\n";
}
