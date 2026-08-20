import { describe, expect, it } from "vitest";
import { pluralCategory } from "../lib/plural";

describe("pluralCategory", () => {
  it.each([
    [1, "en-US", "one"],
    [2, "en-US", "other"],
    [1, "ru-RU", "one"],
    [2, "ru-RU", "few"],
    [5, "ru-RU", "many"],
    [11, "ru-RU", "many"],
    [21, "ru-RU", "one"],
  ] as const)("selects %s in %s as %s", (count, locale, expected) => {
    expect(pluralCategory(count, locale)).toBe(expected);
  });

  it.each([
    [0, "cy"],
    [2, "cy"],
  ] as const)("maps the unsupported category for %s in %s to other", (count, locale) => {
    expect(pluralCategory(count, locale)).toBe("other");
  });
});
