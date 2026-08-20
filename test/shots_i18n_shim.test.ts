// @vitest-environment node
import { describe, expect, it } from "vitest";
import { makeStorageLocal, selectHarnessLocale } from "../shots/i18n_shim";

const messages = {
  en: { label: { message: "English" } },
  pt_BR: { label: { message: "Português" } },
};
const tags = { en: "en-US", pt_BR: "pt-BR" };

describe("selectHarnessLocale", () => {
  it("defaults an absent query parameter to English", () => {
    expect(selectHarnessLocale(null, messages, tags)).toEqual({
      code: "en",
      messages: messages.en,
      tag: "en-US",
    });
  });

  it("selects an underscore locale without treating it as a path", () => {
    expect(selectHarnessLocale("pt_BR", messages, tags)).toEqual({
      code: "pt_BR",
      messages: messages.pt_BR,
      tag: "pt-BR",
    });
  });

  it("rejects path-shaped locale input", () => {
    expect(() => selectHarnessLocale("../en", messages, tags)).toThrow(/unsafe locale/);
  });

  it("rejects a locale absent from the compiled map", () => {
    expect(() => selectHarnessLocale("de", messages, tags)).toThrow(/not compiled/);
  });
});

describe("makeStorageLocal", () => {
  it("round-trips the install id through the browser shim", async () => {
    const local = makeStorageLocal();

    expect(await local.get("install_id")).toEqual({});
    await local.set({ install_id: "shot" });

    expect(await local.get("install_id")).toEqual({ install_id: "shot" });
  });
});
