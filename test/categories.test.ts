import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMessagesText, generateChromeMessages } from "@wxt-dev/i18n/build";
import { categoryLabel, CATEGORY_SLUGS } from "../lib/categories";

const LOCALES_DIR = resolve(__dirname, "../locales");

const messagesOf = (file: string) =>
  generateChromeMessages(
    parseMessagesText(readFileSync(resolve(LOCALES_DIR, file), "utf8"), "YAML"),
  );

// The slug -> message-name transform lib/categories.ts encodes by hand. Spelled
// out again here rather than imported so the test fails if the map is edited to
// point a slug at some other category's label -- importing the map would make
// this assertion true by construction.
const messageName = (slug: string) =>
  "categories_" + slug.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());

describe("category labels", () => {
  it("localizes a known category", () => {
    // English messages are what test/setup.ts loads, so this is the real label.
    expect(categoryLabel("email-sms", "Email & SMS")).toBe("Email & SMS");
    expect(categoryLabel("store-design", "Store Design")).toBe("Store Design");
  });

  // The taxonomy is editable at runtime (the MCP server creates, renames and
  // merges categories), so the panel WILL meet a slug this build predates. It
  // has to keep the server's English name rather than blank the heading -- and
  // it must not reach i18n.t() with an unknown key, which throws under
  // test/setup.ts's onMissing.
  it("falls back to the server's name for an unknown category", () => {
    expect(categoryLabel("quantum-fulfilment", "Quantum Fulfilment")).toBe("Quantum Fulfilment");
  });

  it("never returns an empty heading", () => {
    for (const slug of [...CATEGORY_SLUGS, "not-a-real-category"]) {
      expect(categoryLabel(slug, "Fallback").trim(), slug).not.toBe("");
    }
  });

  // What this catches: a slug added to lib/categories.ts without the matching
  // key in the locale files. That combination throws at render time under
  // setup.ts and renders a blank heading in a real browser, and neither the
  // key-parity check in locales.test.ts nor svelte-check can see it -- parity
  // only proves the locales agree with each other, not that they cover the map.
  for (const file of readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".yml")).sort()) {
    it(`${file} defines a label for every mapped category`, () => {
      const messages = messagesOf(file);
      const missing = CATEGORY_SLUGS.filter((slug) => !messages[messageName(slug)]?.message?.trim());
      expect(missing).toEqual([]);
    });
  }

  // And the reverse: a label left in the locale files for a category the map no
  // longer routes to is dead weight the panel can never render.
  it("maps every category label the default locale defines", () => {
    const defined = Object.keys(messagesOf("en.yml"))
      .filter((key) => key.startsWith("categories_"))
      .sort();
    expect(CATEGORY_SLUGS.map(messageName).sort()).toEqual(defined);
  });
});

// Same drift guard as the categories above, for the theme-origin enum. Key
// parity in locales.test.ts only proves the locale files agree with each other;
// it cannot know which keys ThemeCard's map actually reaches for.
describe("theme origin labels", () => {
  const ORIGINS = ["catalog", "forked", "custom", "headless"];

  for (const file of readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".yml")).sort()) {
    it(`${file} defines every theme origin`, () => {
      const messages = messagesOf(file);
      const missing = ORIGINS.filter((o) => !messages[`theme_origin_${o}`]?.message?.trim());
      expect(missing).toEqual([]);
    });
  }
});
