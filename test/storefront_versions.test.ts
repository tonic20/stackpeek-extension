import { describe, expect, it, vi, beforeEach } from "vitest";

const store: Record<string, unknown> = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  (globalThis as any).chrome = {
    storage: { local: {
      get: async (k: string) => (k in store ? { [k]: store[k] } : {}),
      set: async (v: Record<string, unknown>) => { Object.assign(store, v); },
    } },
  };
  vi.resetModules();
});

describe("resolveStorefrontVersions", () => {
  it("falls back to the bundled list when the config call fails", async () => {
    vi.doMock("../lib/api", () => ({ fetchConfig: async () => { throw new Error("offline"); } }));
    const { resolveStorefrontVersions, BUNDLED_STOREFRONT_VERSIONS } = await import("../lib/storefront_versions");
    expect(await resolveStorefrontVersions()).toEqual([...BUNDLED_STOREFRONT_VERSIONS]);
  });

  // Unlike window_globals this REPLACES rather than unions: a retired version is
  // worse than useless, so the server must be able to remove one.
  it("prefers the server list when it is present", async () => {
    vi.doMock("../lib/api", () => ({ fetchConfig: async () => ({ window_globals: [], storefront_api_versions: ["2027-01"] }) }));
    const { resolveStorefrontVersions } = await import("../lib/storefront_versions");
    expect(await resolveStorefrontVersions()).toEqual(["2027-01"]);
  });

  it("ignores a malformed server list", async () => {
    vi.doMock("../lib/api", () => ({ fetchConfig: async () => ({ window_globals: [], storefront_api_versions: "nope" }) }));
    const { resolveStorefrontVersions, BUNDLED_STOREFRONT_VERSIONS } = await import("../lib/storefront_versions");
    expect(await resolveStorefrontVersions()).toEqual([...BUNDLED_STOREFRONT_VERSIONS]);
  });
});
