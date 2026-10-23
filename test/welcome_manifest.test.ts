// @vitest-environment node
//
// Node, not jsdom: importing wxt.config pulls in esbuild, as in
// design_system_sync.test.ts. These read wxt.config.ts and lib/welcome.ts
// only, so they run in the public mirror too.
import { describe, it, expect } from "vitest";
import config from "../wxt.config";
import { WELCOME_BASE } from "../lib/welcome";

const manifestOption = (config as { manifest?: unknown }).manifest;
const forBrowser = (browser: string) =>
  (manifestOption as (env: object) => Record<string, any>)({
    mode: "production", command: "build", browser, manifestVersion: 3,
  });

// The welcome page connects back for the live pin state (lib/welcome.ts). The
// manifest's origin and the page's address are written in two files, since
// wxt.config.ts cannot import a module that reads import.meta.env; this is
// what holds them together.
describe("externally_connectable", () => {
  it("lets the welcome page's origin, and only it, connect in Chrome", () => {
    expect(forBrowser("chrome").externally_connectable).toEqual({
      matches: [`${new URL(WELCOME_BASE).origin}/*`],
    });
    expect(WELCOME_BASE).toBe("https://stackpeek.app");
  });

  it("is absent from Firefox, which does not support it", () => {
    expect(forBrowser("firefox").externally_connectable).toBeUndefined();
  });

  it("adds no permission", () => {
    expect(forBrowser("chrome").permissions).toEqual(["activeTab", "scripting", "sidePanel", "storage"]);
  });
});
