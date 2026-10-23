import { describe, it, expect } from "vitest";
import { marksUnverified } from "../lib/unverified";

// The rule both the panel and the Markdown report follow. "unverified" means
// "weaker than the others here", so it says something only when both kinds
// are present.
describe("marksUnverified", () => {
  it("marks when the scan holds both kinds", () => {
    expect(marksUnverified([{ verified: true }, { verified: false }])).toBe(true);
  });

  it("marks nothing when every app is unverified", () => {
    expect(marksUnverified([{ verified: false }, { verified: false }])).toBe(false);
  });

  // No marker could render, and the panel's footnote would explain nothing.
  it("marks nothing when every app is verified", () => {
    expect(marksUnverified([{ verified: true }, { verified: true }])).toBe(false);
  });

  it("does not count an absent or non-boolean field as a verification", () => {
    expect(marksUnverified([{ verified: "yes" }, {}])).toBe(false);
    expect(marksUnverified([{ verified: true }, { verified: null }])).toBe(true);
  });

  it("marks nothing in an empty scan", () => {
    expect(marksUnverified([])).toBe(false);
  });
});
