// @vitest-environment node
//
// This used to import wxt.config.ts directly and call its manifest(env)
// function, because the release-safety guard lived there. It has since moved
// to scripts/assert-release-safe.mjs (see the comment on assertReleaseSafe
// there for why: manifest(env) is evaluated by every WXT command, including
// `wxt prepare`, which runs as this package's `postinstall` and broke plain
// `npm install`). Importing that script directly, rather than shelling out to
// it, keeps these cases fast and hermetic.
import { describe, it, expect, afterEach } from "vitest";
import { assertReleaseSafe } from "../scripts/assert-release-safe.mjs";

const ORIGINAL_API_BASE = process.env.WXT_API_BASE;
const ORIGINAL_ALLOW_LOCALHOST = process.env.WXT_ALLOW_LOCALHOST;

function setEnv(key: "WXT_API_BASE" | "WXT_ALLOW_LOCALHOST", value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  setEnv("WXT_API_BASE", ORIGINAL_API_BASE);
  setEnv("WXT_ALLOW_LOCALHOST", ORIGINAL_ALLOW_LOCALHOST);
});

describe("scripts/assert-release-safe.mjs", () => {
  it("throws on no WXT_API_BASE", () => {
    setEnv("WXT_API_BASE", undefined);
    setEnv("WXT_ALLOW_LOCALHOST", undefined);
    expect(() => assertReleaseSafe()).toThrow(/WXT_API_BASE/);
  });

  it("throws on WXT_API_BASE pointed at localhost", () => {
    setEnv("WXT_API_BASE", "http://localhost:3070");
    setEnv("WXT_ALLOW_LOCALHOST", undefined);
    expect(() => assertReleaseSafe()).toThrow(/localhost/);
  });

  it("passes with a real https API base", () => {
    setEnv("WXT_API_BASE", "https://api.stackpeek.app");
    setEnv("WXT_ALLOW_LOCALHOST", undefined);
    expect(() => assertReleaseSafe()).not.toThrow();
  });

  it("passes with no WXT_API_BASE when WXT_ALLOW_LOCALHOST is set", () => {
    setEnv("WXT_API_BASE", undefined);
    setEnv("WXT_ALLOW_LOCALHOST", "1");
    expect(() => assertReleaseSafe()).not.toThrow();
  });
});
