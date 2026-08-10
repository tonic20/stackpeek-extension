import { describe, it, expect } from "vitest";
import { WINDOW_GLOBALS } from "../lib/window_globals";

describe("WINDOW_GLOBALS", () => {
  it("is a non-empty list of probe names", () => {
    expect(Array.isArray(WINDOW_GLOBALS)).toBe(true);
    expect(WINDOW_GLOBALS.length).toBeGreaterThan(0);
  });
});
