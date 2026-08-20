import { describe, it, expect, vi } from "vitest";
import { runRounds } from "../lib/detect_runner";
import { collectFromActiveTab } from "../lib/collect_bridge";
import { InjectionDeniedError } from "../lib/errors";
import { stubBrowser } from "./setup";

const ok = { is_shopify: true, apps: [], pixels: [], infrastructure: [], unknown_domain_count: 0 };
const noSleep = async () => {};

function signals(urls: string[]) {
  return { shopify: { shop: "demo.myshopify.com" }, script_urls: urls, window_globals: [], meta_tags: [] };
}

describe("runRounds", () => {
  // The panel needs to tell these apart, so the runner must not fold a refusal
  // into its no-signals path the way it does every other collect failure.
  it("propagates an injection refusal instead of reading it as no signals", async () => {
    const collect = vi.fn(async () => { throw new InjectionDeniedError("denied"); });
    const send = vi.fn(async () => ok);
    const onNoSignals = vi.fn();

    await expect(
      runRounds({ collect, send, installId: "k1", onUpdate: () => {}, onNoSignals, sleep: noSleep }),
    ).rejects.toBeInstanceOf(InjectionDeniedError);

    expect(onNoSignals).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  // Mid-scan, a good result already on screen is worth more than the error:
  // this mirrors how the runner already treats a failing send.
  it("keeps an existing result when a later round is refused", async () => {
    let round = 0;
    const collect = vi.fn(async () => {
      if (round++ > 0) throw new InjectionDeniedError("denied");
      return { signals: signals(["a"]), url: "https://demo.example/" };
    });
    const send = vi.fn(async () => ok);
    const onUpdate = vi.fn();

    await runRounds({ collect, send, installId: "k1", onUpdate, onNoSignals: () => {},
                      delays: [0, 0, 0], sleep: noSleep });

    expect(onUpdate).toHaveBeenCalled();
  });

  it("sends each round whose signals grew, and marks only the last final", async () => {
    const sets = [signals(["a"]), signals(["a", "b"]), signals(["a", "b", "c"]), signals(["a", "b", "c", "d"])];
    let i = 0;
    const collect = vi.fn(async () => ({ signals: sets[i++], url: "https://demo.example/" }));
    const send = vi.fn(async (_payload: Record<string, unknown>) => ok);

    await runRounds({ collect, send, installId: "k1", onUpdate: () => {}, onNoSignals: () => {}, sleep: noSleep });

    expect(send).toHaveBeenCalledTimes(4);
    expect(send.mock.calls.slice(0, 3).map((c) => (c[0] as any).final)).toEqual([false, false, false]);
    expect((send.mock.calls[3]![0] as any).final).toBe(true);
  });

  it("stops early and marks final when the signal set stops growing", async () => {
    const collect = vi.fn(async () => ({ signals: signals(["a"]), url: "https://demo.example/" }));
    const send = vi.fn(async (_payload: Record<string, unknown>) => ok);

    await runRounds({ collect, send, installId: "k1", onUpdate: () => {}, onNoSignals: () => {}, sleep: noSleep });

    // Round 1 sends non-final; round 2 is identical, so it settles and re-sends
    // as final. Without that exemption nothing would ever be marked final and
    // the scan would record no observation.
    expect(send).toHaveBeenCalledTimes(2);
    expect((send.mock.calls[0]![0] as any).final).toBe(false);
    expect((send.mock.calls[1]![0] as any).final).toBe(true);
    expect(collect).toHaveBeenCalledTimes(2);
  });

  it("reports every response through onUpdate", async () => {
    const collect = vi.fn(async () => ({ signals: signals(["a"]), url: "https://demo.example/" }));
    const send = vi.fn(async (_payload: Record<string, unknown>) => ok);
    const onUpdate = vi.fn();

    await runRounds({ collect, send, installId: "k1", onUpdate, onNoSignals: () => {}, sleep: noSleep });

    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it("signals cant-scan when the very first round yields nothing", async () => {
    const collect = vi.fn(async () => ({ signals: null, url: undefined }));
    const send = vi.fn(async (_payload: Record<string, unknown>) => ok);
    const onNoSignals = vi.fn();

    await runRounds({ collect, send, installId: "k1", onUpdate: () => {}, onNoSignals, sleep: noSleep });

    expect(onNoSignals).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("waits the configured gap between rounds", async () => {
    const sets = [signals(["a"]), signals(["a", "b"])];
    let i = 0;
    const collect = vi.fn(async () => ({ signals: sets[Math.min(i++, 1)], url: "https://demo.example/" }));
    const sleep = vi.fn(async (_ms: number) => {});

    await runRounds({ collect, send: async () => ok, installId: "k1", onUpdate: () => {},
      onNoSignals: () => {}, sleep, delays: [0, 1500, 4000] });

    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1500, 2500]);
  });

  it("still records exactly one final round when the very last round yields nothing", async () => {
    // Reproduces a mid-scan tab close/navigation landing on the final round:
    // collect() goes from growing signals straight to null on round 4. Without
    // re-sending the last known signals as final, nothing would ever be
    // marked final and the server would persist no observation at all.
    const sets: (ReturnType<typeof signals> | null)[] = [
      signals(["a"]), signals(["a", "b"]), signals(["a", "b", "c"]), null,
    ];
    let i = 0;
    const collect = vi.fn(async () => ({ signals: sets[i++], url: "https://demo.example/" }));
    const send = vi.fn(async (_payload: Record<string, unknown>) => ok);

    await runRounds({ collect, send, installId: "k1", onUpdate: () => {}, onNoSignals: () => {}, sleep: noSleep });

    const finals = send.mock.calls.map((c) => (c[0] as any).final);
    expect(finals).toEqual([false, false, false, true]);
  });

  it("signals cant-scan when the very first round's collect() throws", async () => {
    const collect = vi.fn(async () => { throw new Error("no active tab"); });
    const send = vi.fn(async (_payload: Record<string, unknown>) => ok);
    const onNoSignals = vi.fn();

    await runRounds({ collect, send, installId: "k1", onUpdate: () => {}, onNoSignals, sleep: noSleep });

    expect(onNoSignals).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("treats a mid-scan collect() failure like an empty round, not a fatal error", async () => {
    // A dropped tab (closed, discarded, navigated away) makes collect() reject
    // rather than resolve with null signals. Round 2 throws here; the scan
    // should carry on and still finalize once the signal set settles.
    const outcomes: (ReturnType<typeof signals> | "throw")[] = [
      signals(["a"]), "throw", signals(["a", "b"]), signals(["a", "b"]),
    ];
    let i = 0;
    const collect = vi.fn(async () => {
      const outcome = outcomes[i++];
      if (outcome === "throw") throw new Error("chrome.tabs.query rejected");
      return { signals: outcome, url: "https://demo.example/" };
    });
    const send = vi.fn(async (_payload: Record<string, unknown>) => ok);

    await runRounds({ collect, send, installId: "k1", onUpdate: () => {}, onNoSignals: () => {}, sleep: noSleep });

    const finals = send.mock.calls.map((c) => (c[0] as any).final);
    expect(finals).toEqual([false, false, true]);
  });

  it("propagates when the very first send fails, since there is nothing to fall back to", async () => {
    const collect = vi.fn(async () => ({ signals: signals(["a"]), url: "https://demo.example/" }));
    const send = vi.fn(async (_payload: Record<string, unknown>) => { throw new Error("network down"); });

    await expect(
      runRounds({ collect, send, installId: "k1", onUpdate: () => {}, onNoSignals: () => {}, sleep: noSleep }),
    ).rejects.toThrow("network down");
  });

  it("keeps the last good result and stops refining when a later send fails", async () => {
    const sets = [signals(["a"]), signals(["a", "b"]), signals(["a", "b", "c"])];
    let i = 0;
    const collect = vi.fn(async () => ({ signals: sets[i++], url: "https://demo.example/" }));
    let calls = 0;
    const send = vi.fn(async (_payload: Record<string, unknown>) => {
      calls++;
      if (calls === 2) throw new Error("429");
      return ok;
    });
    const onUpdate = vi.fn();

    await expect(
      runRounds({ collect, send, installId: "k1", onUpdate, onNoSignals: () => {}, sleep: noSleep }),
    ).resolves.toBeUndefined();

    // Round 1 rendered successfully; round 2's send fails and the scan stops
    // there rather than discarding round 1's already-visible result.
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(collect).toHaveBeenCalledTimes(2);
  });
});

// Every test above wires `collect` to a hand-written stub that already hands
// back whatever url string the test wrote, so none of them can prove the
// truncation collect_bridge.ts performs actually reaches send(). runRounds is
// a pure passthrough for `url` -- it never touches the value itself -- so the
// only way to pin the guarantee at the point the data actually leaves the
// extension is to run the real collectFromActiveTab as `collect` and inspect
// what lands in the payload runRounds hands to `send`.
describe("the url handed to send() is an origin, pinned at the exit", () => {
  it("carries only the origin of a tab url with a path and query, never the full url", async () => {
    stubBrowser({
      tabs: {
        query: vi.fn(async () => [
          { id: 7, url: "https://demo.example/products/foo?discount=SAVE10&cart_token=abc123" },
        ]),
      },
      scripting: {
        executeScript: vi.fn(async () => [
          { result: signals(["https://cdn.shopify.com/a.js"]) },
        ]),
      },
      storage: {
        local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
      },
    });
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("no network in this test")) as unknown as typeof fetch;

    const send = vi.fn(async (_payload: Record<string, unknown>) => ok);

    await runRounds({
      collect: collectFromActiveTab,
      send,
      installId: "k1",
      onUpdate: () => {},
      onNoSignals: () => {},
      delays: [0],
      sleep: noSleep,
    });

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]![0] as { url: string };
    expect(payload.url).toBe("https://demo.example");
    expect(payload.url).not.toContain("/products/foo");
    expect(payload.url).not.toContain("discount");
    expect(payload.url).not.toContain("cart_token");
  });

  // Sent per round rather than once per install: it costs nothing, and the
  // server's COALESCE means a round without it cannot blank a known value.
  it("sends the browser UI language with each round", async () => {
    stubBrowser({ i18n: { getUILanguage: () => "th" } });
    const send = vi.fn(async (_payload: Record<string, unknown>) => ok);
    const collect = vi.fn(async () => ({ signals: { script_urls: [] }, url: "https://s.example/" }));

    await runRounds({ collect, send, installId: "k1", onUpdate: () => {}, onNoSignals: () => {}, sleep: noSleep });

    expect(send).toHaveBeenCalled();
    for (const [body] of send.mock.calls) expect(body.language).toBe("th");
  });

  // Omitted, not sent as "" or null: the server treats an absent key as "not
  // reported" and would reject the empty string anyway, so sending one only
  // puts a junk value on the wire.
  it("omits the language entirely when the API cannot supply one", async () => {
    stubBrowser({});
    const send = vi.fn(async (_payload: Record<string, unknown>) => ok);
    const collect = vi.fn(async () => ({ signals: { script_urls: [] }, url: "https://s.example/" }));

    await runRounds({ collect, send, installId: "k1", onUpdate: () => {}, onNoSignals: () => {}, sleep: noSleep });

    for (const [body] of send.mock.calls) expect("language" in body).toBe(false);
  });
});
