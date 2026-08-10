// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The site links this same file. Eighteen selectors are defined in BOTH this
// file and stackpeek.css, and thirteen carry different rules -- .sp-theme is a
// vertical card here and a baseline row there. Scoping every component rule
// under .sp-panel makes this file win inside the panel by specificity (0,2,0
// beats 0,1,0) whatever the load order, and leak nowhere else.
//
// App.svelte's root element IS .sp-panel, so this is a no-op in the extension.
const CSS = readFileSync(resolve(__dirname, "../entrypoints/sidepanel/panel.css"), "utf8");

// Rules that must NOT be scoped, and why each one would break if it were:
//   :root / [data-sp-theme] / [data-sp-theme="…"] — the token blocks. theme.ts
//     sets data-sp-theme on document.documentElement, an ANCESTOR of .sp-panel,
//     so scoping these would break dark mode in the shipped extension while
//     every jsdom test still passed (jsdom computes no styles).
//   .sp-panel — the scope root itself.
//   html / body / #app — the side-panel window's own chrome.
//
// The [data-sp-theme(=|\]) branch is deliberately tight: it accepts only the
// bare attribute selector and the "=value" form, i.e. exactly
// `[data-sp-theme]` and `[data-sp-theme="dark"]`/`[data-sp-theme="light"]`. A
// looser `\[data-sp-theme` prefix match would also swallow an unrelated
// selector like `[data-sp-theme-density="compact"]` as if it were part of the
// token contract -- silently, since the guard would report it as allowed
// rather than as a leak. That is the exact failure mode this test exists to
// catch, so the pattern stops at the character that ends the real attribute
// name. Every other branch is held to the same standard: `:root`, `.sp-panel`,
// `html`, `body` and `#app` must each be followed by a character outside
// `[\w-]` (or end the selector) too, or a compound like `.sp-panel__note` --
// unscoped, and live in stackpeek.css -- would pass as "starts with .sp-panel".
const UNSCOPED_ALLOWED =
  /^(:root|\[data-sp-theme(=|\])|\.sp-panel|html|body|#app)(?![\w-])|^(\*|from|to|\d+%)/;

// Splits a selector list on top-level commas only, so `:where(a, button, input,
// summary):focus-visible` -- a single selector whose commas sit inside
// parentheses -- is not mistaken for four.
function splitTopLevel(selectorList: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of selectorList) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

function selectors(css: string): string[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  // Strip at-rule headers but keep their bodies, so rules inside @media are checked too.
  const flattened = withoutComments.replace(/@[\w-]+[^{]*\{/g, "");
  for (const m of flattened.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    for (const s of splitTopLevel(m[1]!)) {
      const sel = s.trim();
      if (sel) out.push(sel);
    }
  }
  return out;
}

describe("panel.css is safe for the site to link", () => {
  it("scopes every component rule under .sp-panel", () => {
    const unscoped = selectors(CSS)
      .filter((s) => !/^\.sp-panel(?![\w-])/.test(s))
      .filter((s) => !UNSCOPED_ALLOWED.test(s));

    expect(unscoped, "these rules would leak onto the marketing page").toEqual([]);
  });

  // The token block must stay at :root -- the side-panel window paints its own
  // background from --sp-bg, and a token block scoped to .sp-panel would leave
  // html/body unstyled.
  it("leaves the token blocks at :root", () => {
    expect(CSS).toMatch(/^:root,\s*$/m);
  });

  // .sp-scan and .sp-iconbtn take turns in the same header slot -- the scanning
  // status while rounds are in flight, the rescan button once the last one
  // settles -- and .sp-hd is a flex row sized by its tallest child. .sp-iconbtn
  // carries an explicit height because it is a touch target; .sp-scan shipped
  // with none, so the header sat at the text's 17px line box while scanning and
  // jumped to 26px the moment the button replaced it, jogging by 7.4px in front
  // of the user.
  //
  // Asserted as a relationship rather than as the literal 26px: the bug was the
  // two disagreeing, so resizing the button alone should fail this, and jsdom
  // computes no layout, which is why this reads the stylesheet instead.
  it("gives the scanning status the same slot height as the rescan button", () => {
    const heightOf = (selector: string, prop: string) => {
      const block = CSS.match(new RegExp(`\\.sp-panel \\${selector} \\{([^}]*)\\}`))?.[1];
      return block?.match(new RegExp(`(?:^|[\\s;])${prop}:\\s*([^;]+);`))?.[1]?.trim();
    };

    expect(heightOf(".sp-scan", "min-height")).toBe(heightOf(".sp-iconbtn", "height"));
  });
});
