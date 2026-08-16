import { describe, it, expect, afterEach, vi } from "vitest";
import { formatLocale, number, money, daysAgo } from "../lib/format";

afterEach(() => {
  vi.useRealTimers();
});

describe("format", () => {
  it("takes its locale from the message file, not the browser UI language", () => {
    expect(formatLocale()).toBe("en-US");
  });

  it("groups numbers", () => {
    expect(number(1240)).toBe("1,240");
    expect(number(0)).toBe("0");
  });

  it("renders money in the store's currency", () => {
    expect(money(18, "USD")).toBe("$18.00");
    expect(money(1, "EUR")).toMatch(/€1\.00/);
  });

  // The feed carries no currency, so an unknown one renders bare numbers rather
  // than a guessed symbol (product-catalogue design D8).
  it("renders bare numbers when the currency is unknown", () => {
    expect(money(18, null)).toBe("18.00");
  });

  it("falls back to bare numbers on a currency code Intl rejects", () => {
    expect(money(18, "not-a-currency")).toBe("18.00");
  });

  it("has nothing to say about an absent or unparseable date", () => {
    expect(daysAgo(null)).toBeNull();
    expect(daysAgo("not a date")).toBeNull();
  });

  // The exact strings the panel showed before this module existed. "5d ago"
  // rather than "5 days ago" is what style: "narrow" buys; anything else is a
  // visible change to an English user, which this whole change must not be.
  it("counts days back in the panel's existing compact form", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00Z"));

    expect(daysAgo("2026-08-13T12:00:00Z")).toBe("2d ago");
    expect(daysAgo("2026-08-14T12:00:00Z")).toBe("1d ago");
    expect(daysAgo("2025-08-15T12:00:00Z")).toBe("365d ago");
  });

  // At and above 1000 days RelativeTimeFormat formats the number through
  // NumberFormat and groups it, unlike the "${days}d ago" string this module
  // replaced. That is a deliberate, documented divergence (lib/format.ts:36-44),
  // not an oversight -- pin it so it stays deliberate.
  it("groups the day count at and above 1000 days, unlike the string it replaced", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00Z"));

    const daysAgoDate = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();

    expect(daysAgo(daysAgoDate(999))).toBe("999d ago");
    expect(daysAgo(daysAgoDate(1000))).toBe("1,000d ago");
    expect(daysAgo(daysAgoDate(1240))).toBe("1,240d ago");
  });

  // Same day is not a relative-time case -- Intl would render "0d ago" -- so it
  // is a message key instead.
  it("says today for the same day, and for a future date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00Z"));

    expect(daysAgo("2026-08-15T09:00:00Z")).toBe("today");
    expect(daysAgo("2026-08-16T12:00:00Z")).toBe("today");
  });
});
