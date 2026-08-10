import { mount } from "svelte";
import "./panel.css";
import App from "./App.svelte";
import { storedTheme, applyTheme } from "../../lib/theme";
import { loadSections } from "../../lib/sections.svelte";

// Before mount, not after. Mounting first would paint the system scheme and
// then repaint the chosen one -- storage is async, so there is no synchronous
// way to have the attribute set at import time (design D2).
//
// The section record has the same shape of problem and the same answer: a
// section hydrated after mount would render open and then snap shut. Unlike the
// theme it needs no pre-paint script in public/, because nothing paints a
// section before mount at all (remembered-sections design D5).
//
// The IIFE is not ceremony: WXT builds to chrome87, where top-level await is
// not available, and `wxt build` fails outright on it. Vitest transpiles to a
// newer target and runs the top-level form fine, so the whole suite passes
// against code that cannot ship -- which is how this got here. Do not unwrap it.
void (async () => {
  // Started here and collected below rather than folded into a Promise.all
  // with the theme read. The two are independent reads of the same store and
  // overlapping them saves a round trip on the panel's cold open, but
  // design_system_sync.test.ts pins the exact text of the theme line -- it is
  // the only guard that the scheme is applied before mount, and jsdom cannot
  // catch that regression any other way. Overlap without disturbing it.
  const sections = loadSections();

  applyTheme(await storedTheme());
  await sections;

  mount(App, { target: document.getElementById("app")! });
})();
