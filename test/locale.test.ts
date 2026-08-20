import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatLocale } from "../lib/format";
import { applyDocumentLocale, canonicalFormatLocale } from "../lib/locale";

vi.mock("../lib/format", () => ({
  formatLocale: vi.fn(() => "en-US"),
}));

const mockedFormatLocale = vi.mocked(formatLocale);

describe("locale", () => {
  beforeEach(() => {
    mockedFormatLocale.mockReturnValue("en-US");
    document.documentElement.removeAttribute("lang");
  });

  it("canonicalizes the locale carried by the active messages", () => {
    mockedFormatLocale.mockReturnValue("pt-br");

    expect(canonicalFormatLocale()).toBe("pt-BR");
  });

  it("sets the side-panel document language", () => {
    expect(applyDocumentLocale()).toBe("en-US");
    expect(document.documentElement.lang).toBe("en-US");
  });

  it("fails with the malformed locale in the error", () => {
    mockedFormatLocale.mockReturnValue("not_a_locale");

    expect(() => canonicalFormatLocale()).toThrow(/not_a_locale/);
  });
});
