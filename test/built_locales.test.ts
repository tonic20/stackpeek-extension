// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertBuiltLocaleCodes,
  sourceLocaleCodes,
} from "../scripts/assert-built-locales.mjs";

const roots: string[] = [];

function fixture(sourceCodes: string[], builtCodes: string[]) {
  const root = mkdtempSync(join(tmpdir(), "stackpeek-built-locales-"));
  roots.push(root);
  const locales = join(root, "locales");
  const build = join(root, "build");
  mkdirSync(locales);
  mkdirSync(join(build, "_locales"), { recursive: true });
  for (const code of sourceCodes) {
    writeFileSync(join(locales, `${code}.yml`), "formatLocale: en-US\n");
  }
  for (const code of builtCodes) {
    mkdirSync(join(build, "_locales", code));
    writeFileSync(join(build, "_locales", code, "messages.json"), "{}");
  }
  return { locales, build };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

describe("built locales", () => {
  it("reads source locale codes in sorted order, including underscores", () => {
    const { locales } = fixture(["pt_BR", "en", "de"], []);

    expect(sourceLocaleCodes(locales)).toEqual(["de", "en", "pt_BR"]);
  });

  it("accepts a build with exactly the source locale set", () => {
    const { locales, build } = fixture(["en", "pt_BR"], ["pt_BR", "en"]);

    expect(assertBuiltLocaleCodes(locales, build)).toEqual(["en", "pt_BR"]);
  });

  it("reports missing built locales", () => {
    const { locales, build } = fixture(["de", "en"], ["en"]);

    expect(() => assertBuiltLocaleCodes(locales, build)).toThrow(/missing: de/);
  });

  it("reports extra built locales", () => {
    const { locales, build } = fixture(["en"], ["en", "fr"]);

    expect(() => assertBuiltLocaleCodes(locales, build)).toThrow(/extra: fr/);
  });
});
