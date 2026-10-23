import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { postDetect, fetchConfig, RateLimitError, TimeoutError, NetworkError, OfflineError, ServerError, DETECT_TIMEOUT_MS, RATE_LIMIT_COOLDOWN_MS, retryAfterMs } from "../lib/api";

beforeEach(() => {
  vi.stubEnv("WXT_API_BASE", "http://test.local");
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("postDetect", () => {
  it("POSTs JSON to /api/v1/detect and returns parsed body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ is_shopify: true, apps: [] }),
    });
    const out = await postDetect({ install_id: "k" });
    expect(fetch).toHaveBeenCalledWith(
      "http://test.local/api/v1/detect",
      expect.objectContaining({ method: "POST" }),
    );
    expect(out.is_shopify).toBe(true);
  });

  it("throws RateLimitError on 429", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    await expect(postDetect({ install_id: "k" })).rejects.toBeInstanceOf(RateLimitError);
  });

  // No Retry-After today, so the wait is ours -- and it must be there, or the
  // panel has nothing to hold Retry back with.
  it("carries the default wait on a 429 that names none", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 429, headers: new Headers(), json: async () => ({}) });
    const error = await postDetect({ install_id: "k" }).catch((e) => e);

    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.retryAfterMs).toBe(RATE_LIMIT_COOLDOWN_MS);
  });

  it("honours a Retry-After the API does send", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false, status: 429, headers: new Headers({ "Retry-After": "12" }), json: async () => ({}),
    });
    const error = await postDetect({ install_id: "k" }).catch((e) => e);

    expect(error.retryAfterMs).toBe(12_000);
  });

  it("throws a ServerError when the detector answers with an error", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(postDetect({ install_id: "k" })).rejects.toBeInstanceOf(ServerError);
  });

  // A 200 whose body is not JSON is still the detector's fault, not the
  // connection's.
  it("throws a ServerError when the body is not JSON", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); },
    });
    await expect(postDetect({ install_id: "k" })).rejects.toBeInstanceOf(ServerError);
  });

  it("throws a NetworkError when the request never got an answer", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError("Failed to fetch"));
    const error = await postDetect({ install_id: "k" }).catch((e) => e);

    expect(error).toBeInstanceOf(NetworkError);
    expect(error).not.toBeInstanceOf(OfflineError);
  });

  // Only onLine === false is believed. true means some interface is up, which
  // says nothing about whether the detector is reachable.
  it("calls it offline only when the browser says so", async () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(postDetect({ install_id: "k" })).rejects.toBeInstanceOf(OfflineError);
    onLine.mockRestore();
  });
});

// A fetch that never answers, until the abort signal it was handed fires --
// which is exactly how a real fetch behaves against a black-holed server.
const hangingFetch = () =>
  vi.fn((_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));

describe("postDetect's time bound", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives up on a detector that never answers", async () => {
    vi.useFakeTimers();
    globalThis.fetch = hangingFetch() as unknown as typeof fetch;

    const pending = postDetect({ install_id: "k" });
    const settled = expect(pending).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(DETECT_TIMEOUT_MS);

    await settled;
  });

  it("does not give up early", async () => {
    vi.useFakeTimers();
    globalThis.fetch = hangingFetch() as unknown as typeof fetch;
    let outcome: unknown = "pending";
    postDetect({ install_id: "k" }).catch((e) => { outcome = e; });

    await vi.advanceTimersByTimeAsync(DETECT_TIMEOUT_MS - 1);

    expect(outcome).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBeInstanceOf(TimeoutError);
  });

  // Headers then silence is as hung as silence. The body read has to sit
  // inside the bound, or the timer is cleared the moment headers arrive.
  it("bounds the body read as well as the response", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(async (_url: string, init: RequestInit) => ({
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    })) as unknown as typeof fetch;

    const pending = postDetect({ install_id: "k" });
    const settled = expect(pending).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(DETECT_TIMEOUT_MS);

    await settled;
  });
});

describe("retryAfterMs", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");

  it("reads the seconds form", () => {
    expect(retryAfterMs("30", now)).toBe(30_000);
  });

  it("reads the HTTP-date form against the clock", () => {
    expect(retryAfterMs("Fri, 16 Oct 2026 12:00:45 GMT", now)).toBe(45_000);
  });

  // Absent or unreadable means "the API did not say", which the caller fills
  // with its own default rather than with a guess made here.
  it("has no opinion on a missing or unreadable header", () => {
    expect(retryAfterMs(null, now)).toBeNull();
    expect(retryAfterMs("soon", now)).toBeNull();
  });

  // A date in the past, or hours out because the local clock is wrong, must
  // neither re-enable Retry into a certain refusal nor leave it dead all day.
  it("keeps the wait between a second and ten minutes", () => {
    expect(retryAfterMs("Fri, 16 Oct 2026 11:00:00 GMT", now)).toBe(1_000);
    expect(retryAfterMs("86400", now)).toBe(600_000);
  });
});

describe("fetchConfig", () => {
  it("GETs /api/v1/config and returns parsed body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ window_globals: ["dataLayer", "fbq"] }),
    });
    const out = await fetchConfig();
    expect(fetch).toHaveBeenCalledWith(
      "http://test.local/api/v1/config",
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(out.window_globals).toEqual(["dataLayer", "fbq"]);
  });

  it("throws RateLimitError on 429", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    await expect(fetchConfig()).rejects.toBeInstanceOf(RateLimitError);
  });

  it("throws on other errors", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(fetchConfig()).rejects.toThrow();
  });
});
