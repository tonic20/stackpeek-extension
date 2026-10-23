import { describe, it, expect, afterEach, vi } from "vitest";
import { hostAccess, ALL_SITES } from "../lib/host_access";
import { stubBrowser } from "./setup";

type Listener = () => void;

function stubPermissions(granted: boolean) {
  const added: Listener[] = [];
  const removed: Listener[] = [];
  const permissions = {
    contains: vi.fn(async () => granted),
    request: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    onAdded: { addListener: (fn: Listener) => added.push(fn), removeListener: (fn: Listener) => added.splice(added.indexOf(fn), 1) },
    onRemoved: { addListener: (fn: Listener) => removed.push(fn), removeListener: (fn: Listener) => removed.splice(removed.indexOf(fn), 1) },
  };
  stubBrowser({ permissions });
  return { permissions, added, removed, set: (g: boolean) => { granted = g; } };
}

afterEach(() => {
  stubBrowser({});
  vi.unstubAllEnvs();
});

describe("hostAccess", () => {
  it("asks for both schemes of every site", async () => {
    const { permissions } = stubPermissions(true);

    expect(await hostAccess.has()).toBe(true);
    expect(permissions.contains).toHaveBeenCalledWith({ origins: ALL_SITES });
    expect(ALL_SITES).toEqual(["https://*/*", "http://*/*"]);
  });

  // No permissions API means no switch, rather than a switch that cannot work.
  it("says null where there is no permissions API", async () => {
    stubBrowser({});
    expect(await hostAccess.has()).toBeNull();
  });

  // The user gesture ends at the first await. The request has to have been
  // made by the time request() returns, not after something it awaits.
  it("makes the request synchronously, inside the caller's gesture", () => {
    const { permissions } = stubPermissions(false);

    void hostAccess.request();

    expect(permissions.request).toHaveBeenCalledWith({ origins: ALL_SITES });
  });

  it("treats a refused or failed request as not granted", async () => {
    const { permissions } = stubPermissions(false);
    permissions.request.mockRejectedValueOnce(new Error("not in a user gesture"));

    expect(await hostAccess.request()).toBe(false);
  });

  it("hands the access back", async () => {
    const { permissions } = stubPermissions(true);

    expect(await hostAccess.remove()).toBe(true);
    expect(permissions.remove).toHaveBeenCalledWith({ origins: ALL_SITES });
  });

  // Chrome's site-access menu and Firefox's Permissions tab change this
  // without the panel, and the switch has to follow.
  it("reports a grant or a revocation made anywhere", async () => {
    const stub = stubPermissions(false);
    const onChange = vi.fn();
    const watcher = hostAccess.watch(onChange);

    stub.set(true);
    stub.added.forEach((fn) => fn());
    await vi.waitFor(() => expect(onChange).toHaveBeenLastCalledWith(true));

    stub.set(false);
    stub.removed.forEach((fn) => fn());
    await vi.waitFor(() => expect(onChange).toHaveBeenLastCalledWith(false));

    watcher.stop();
    expect(stub.added).toHaveLength(0);
    expect(stub.removed).toHaveLength(0);
  });

  // With auto-scan on, the origins of the tabs the user switches to reach the
  // API as they browse: Firefox's browsingActivity. Asked for in the same
  // request as the origins, so one prompt covers both, and given back with
  // them.
  describe("on Firefox", () => {
    const WITH_CONSENT = { origins: ALL_SITES, data_collection: ["browsingActivity"] };

    it("asks for the browsingActivity consent along with the origins", () => {
      vi.stubEnv("FIREFOX", "true");
      const { permissions } = stubPermissions(false);

      void hostAccess.request();

      expect(permissions.request).toHaveBeenCalledWith(WITH_CONSENT);
    });

    it("hands both back when turned off", async () => {
      vi.stubEnv("FIREFOX", "true");
      const { permissions } = stubPermissions(true);

      await hostAccess.remove();

      expect(permissions.remove).toHaveBeenCalledWith(WITH_CONSENT);
    });

    // Revoking the consent in about:addons takes back what the switch asked
    // for, so the switch must read off even with the origins still granted.
    it("counts as on only with the consent as well as the origins", async () => {
      vi.stubEnv("FIREFOX", "true");
      const { permissions } = stubPermissions(true);

      await hostAccess.has();

      expect(permissions.contains).toHaveBeenCalledWith(WITH_CONSENT);
    });

    it("asks Chrome, which has no such consent, for the origins alone", () => {
      vi.stubEnv("FIREFOX", "");
      const { permissions } = stubPermissions(false);

      void hostAccess.request();

      expect(permissions.request).toHaveBeenCalledWith({ origins: ALL_SITES });
    });
  });

  // The gap: about:addons can withdraw the consent and leave the access, which
  // alone would let an automatic rescan read and send. Only that state blocks.
  describe("blocksAutoScan", () => {
    const stubFirefox = (sites: boolean, consent: boolean | "throws") => {
      vi.stubEnv("FIREFOX", "true");
      stubBrowser({
        permissions: {
          contains: vi.fn(async (p: { origins?: string[]; data_collection?: string[] }) => {
            if (p.data_collection) {
              if (consent === "throws") throw new Error("unsupported");
              return consent;
            }
            return sites;
          }),
        },
      });
    };

    it("blocks with site access kept and the consent withdrawn", async () => {
      stubFirefox(true, false);
      expect(await hostAccess.blocksAutoScan()).toBe(true);
    });

    it("lets auto-scan run with both granted", async () => {
      stubFirefox(true, true);
      expect(await hostAccess.blocksAutoScan()).toBe(false);
    });

    // Neither half: automatic rescans behave as they always have, on whatever
    // activeTab grant a click left behind.
    it("leaves the ordinary no-access case alone", async () => {
      stubFirefox(false, false);
      expect(await hostAccess.blocksAutoScan()).toBe(false);
    });

    it("treats a check that cannot be made as no consent", async () => {
      stubFirefox(true, "throws");
      expect(await hostAccess.blocksAutoScan()).toBe(true);
    });

    it("never blocks on Chrome, which has no such consent", async () => {
      vi.stubEnv("FIREFOX", "");
      stubPermissions(true);
      expect(await hostAccess.blocksAutoScan()).toBe(false);
    });
  });
});
