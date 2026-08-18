import { describe, it, expect, beforeEach, vi } from "vitest";
import { stubBrowser } from "./setup";

// The grant check is firefox-only and folds at build time, so each case has to
// re-import the module under the env it is describing.
// "throw" is a sentinel for a permissions API that rejects, distinct from
// `undefined` (a response with no data_collection field at all).
async function loadInstallId(isFirefox: boolean, dataCollection: string[] | undefined | "throw") {
  vi.stubEnv("FIREFOX", isFirefox ? "true" : "");
  const store: Record<string, unknown> = {};
  const get = vi.fn(async (k: string) => ({ [k]: store[k] }));
  const set = vi.fn(async (obj: Record<string, unknown>) => Object.assign(store, obj));
  stubBrowser({
    storage: { local: { get, set } },
    permissions: {
      getAll: vi.fn(async () => {
        if (dataCollection === "throw") throw new Error("boom");
        return dataCollection === undefined ? {} : { data_collection: dataCollection };
      }),
    },
  });
  vi.resetModules();
  const mod = await import("../lib/install_id");
  return { getInstallId: mod.getInstallId, store, set, get };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  let n = 0;
  Object.defineProperty(globalThis, "crypto", {
    value: { randomUUID: () => `uuid-${++n}` },
    configurable: true,
    writable: true,
  });
});

describe("getInstallId on Firefox", () => {
  it("persists the id when the optional grant is held", async () => {
    const { getInstallId, store, set } = await loadInstallId(true, ["technicalAndInteraction"]);
    expect(await getInstallId()).toBe("uuid-1");
    expect(set).toHaveBeenCalledWith({ install_id: "uuid-1" });
    expect(store.install_id).toBe("uuid-1");
  });

  it("writes nothing to storage when the grant is declined", async () => {
    const { getInstallId, store, set, get } = await loadInstallId(true, []);
    expect(await getInstallId()).toBe("uuid-1");
    expect(set).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(store.install_id).toBeUndefined();
  });

  it("still returns an id when declined, because the API requires one", async () => {
    // detect_controller.rb rejects a blank install_id and throttles on it, so
    // the honest opt-out is an id that never leaves memory — not no id.
    const { getInstallId } = await loadInstallId(true, []);
    expect(await getInstallId()).toMatch(/^uuid-/);
  });

  it("keeps one id for the whole session when declined", async () => {
    const { getInstallId } = await loadInstallId(true, []);
    expect(await getInstallId()).toBe(await getInstallId());
  });

  it("does not reuse a previously persisted id after the grant is withdrawn", async () => {
    const { getInstallId, store, get } = await loadInstallId(true, []);
    store.install_id = "persisted-from-before";
    expect(await getInstallId()).not.toBe("persisted-from-before");
    expect(get).not.toHaveBeenCalled();
  });

  it("treats a permissions API that reports nothing as declined", async () => {
    const { getInstallId, set, get } = await loadInstallId(true, undefined);
    expect(await getInstallId()).toMatch(/^uuid-/);
    expect(set).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("treats a permissions API that throws as declined", async () => {
    // "An API that isn't there, or that threw, is not consent" — the `catch`
    // in mayPersist() had no coverage before this case. A future refactor
    // that re-throws or falls through to the persisted branch would ship
    // with nothing failing.
    const { getInstallId, set, get } = await loadInstallId(true, "throw");
    expect(await getInstallId()).toMatch(/^uuid-/);
    expect(set).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
});

describe("getInstallId on Chrome", () => {
  it("persists without consulting permissions at all", async () => {
    const { getInstallId, store, set } = await loadInstallId(false, []);
    expect(await getInstallId()).toBe("uuid-1");
    expect(set).toHaveBeenCalledWith({ install_id: "uuid-1" });
    expect(store.install_id).toBe("uuid-1");
  });
});
