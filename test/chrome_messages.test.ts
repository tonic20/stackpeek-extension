import { describe, it, expect, vi } from "vitest";
import { substitute, makeGetMessage } from "../lib/chrome_messages";

describe("substitute", () => {
  it("replaces a single $n placeholder", () => {
    expect(substitute("hello $1", ["world"])).toBe("hello world");
  });

  it("replaces multiple placeholders, in order", () => {
    expect(substitute("$1 of $2", ["3", "10"])).toBe("3 of 10");
  });

  it("renders a missing substitution argument as empty", () => {
    expect(substitute("hello $1", [])).toBe("hello ");
  });

  // "$$1" is an escaped literal, not a placeholder -- the negative lookbehind
  // is what tells $1 (substitute) apart from $$1 (literal dollar-digit).
  it("leaves the $$ escape alone", () => {
    expect(substitute("cost is $$1", ["ignored"])).toBe("cost is $$1");
  });
});

describe("makeGetMessage", () => {
  const messages = {
    greeting: { message: "hello $1" },
  };

  it("looks up and substitutes a present key", () => {
    const getMessage = makeGetMessage(messages, () => "");
    expect(getMessage("greeting", ["world"])).toBe("hello world");
  });

  // test/setup.ts's onMissing: a missing key is a typo, so it must fail the
  // suite rather than ship a blank label unnoticed.
  it("calls onMissing for an absent key, and can throw", () => {
    const getMessage = makeGetMessage(messages, (name) => {
      throw new Error(`missing: ${name}`);
    });
    expect(() => getMessage("nope")).toThrow("missing: nope");
  });

  // shots/i18n_shim.ts's onMissing: matches real Chrome, which returns "" for
  // a message it does not have, so one label blanks rather than the whole
  // mount throwing during component initialization.
  it("returns onMissing's value for an absent key without substituting", () => {
    const onMissing = vi.fn(() => "");
    const getMessage = makeGetMessage(messages, onMissing);

    expect(getMessage("nope", ["ignored"])).toBe("");
    expect(onMissing).toHaveBeenCalledWith("nope");
  });
});
