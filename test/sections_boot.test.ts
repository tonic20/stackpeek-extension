import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// main.ts mounts the panel as a side effect of import, so it is read rather
// than run. What matters is an ordering property, and the source is where that
// property is visible -- the same reason design_system_sync.test.ts pins the
// theme ordering here rather than rendering anything.
//
// Without hydration before mount, every section renders from an empty record --
// so a user who collapsed Trackers sees it open, and then sees it snap shut
// once storage answers. That is worse than not remembering at all.
const SRC = readFileSync(resolve(__dirname, "../entrypoints/sidepanel/main.ts"), "utf8");

describe("panel boot", () => {
  // Two independent reads of the same store, so the section read is started
  // before the theme read is awaited and collected afterwards. Sequencing them
  // would add a round trip to the panel's cold open for nothing.
  it("starts the section read before awaiting the theme", () => {
    expect(SRC).toContain("loadSections()");
    expect(SRC.indexOf("loadSections()")).toBeLessThan(SRC.indexOf("applyTheme(await storedTheme())"));
  });

  // Matches the AWAIT, not the call: starting the read early and never
  // collecting it would mount against an empty record, which is the whole
  // regression this exists to catch.
  it("waits for the record before mounting", () => {
    expect(SRC).toContain("await sections;");
    expect(SRC.indexOf("await sections;")).toBeLessThan(SRC.indexOf("mount(App"));
  });
});
